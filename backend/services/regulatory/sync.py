"""
Regulatory file source-update detection (Google Drive selective sync).

Mirrors the Knowledge Base sync (``services.documents.sync``) but for the
Regulatory file explorer (``regulatory_nodes``).  Because Regulatory is a
*regulated* section, changes are NEVER applied in bulk: ``check_updates``
only *detects and flags* Drive-side changes (modified / renamed / deleted),
and the user must explicitly approve each file via ``apply_update`` (re-import)
or ``dismiss_update`` (acknowledge without re-importing).

Public API:
    parse_drive_time(s)                  -> datetime | None
    check_updates(db)                    -> dict   (scan + flag + notify)
    apply_update(db, node_id)            -> RegulatoryNode (re-download from Drive)
    dismiss_update(db, node_id)          -> RegulatoryNode (acknowledge, re-baseline)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import services.google_service as gs
from config import settings
from models.db.enums import NotificationType
from models.db.regulatory import RegulatoryNode
from repositories.conversation_repo import NotificationRepository

logger = logging.getLogger(__name__)

# File bytes live under the same local store the router uses.
REG_STORE = Path(settings.storage_root).expanduser().parent / "regulatory"

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


def parse_drive_time(value: str | None) -> datetime | None:
    """Parse an RFC3339 Drive timestamp (e.g. '2026-06-08T14:39:00.000Z')."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _store_path(stored_filename: str) -> Path:
    """Resolve a stored filename to a path inside REG_STORE (traversal-safe)."""
    p = (REG_STORE / stored_filename).resolve()
    if not str(p).startswith(str(REG_STORE.resolve())):
        raise ValueError("Invalid stored file path.")
    return p


def _evaluate(node: RegulatoryNode, meta: dict | None) -> tuple[str, str | None]:
    """Return (sync_status, sync_detail) for a node given fresh Drive metadata."""
    if meta is None or meta.get("trashed"):
        return "deleted", "The source file was removed or trashed in Google Drive."

    current_name = meta.get("name") or ""
    current_mod = parse_drive_time(meta.get("modified"))

    renamed = bool(node.source_name and current_name and current_name != node.source_name)
    modified = bool(
        current_mod
        and node.source_modified_at
        and current_mod > node.source_modified_at
    )

    if modified and renamed:
        return "modified", (
            f'The source file was updated and renamed to "{current_name}" in Google Drive.'
        )
    if modified:
        return "modified", "The source file was updated in Google Drive."
    if renamed:
        return "renamed", f'The source file was renamed to "{current_name}" in Google Drive.'
    return "current", None


async def _linked_nodes(db: AsyncSession) -> list[RegulatoryNode]:
    stmt = select(RegulatoryNode).where(
        RegulatoryNode.node_type == "file",
        RegulatoryNode.source_type == "google_drive",
        RegulatoryNode.source_file_id.isnot(None),
    )
    result = await db.execute(stmt)
    return list(result.scalars())


async def check_updates(db: AsyncSession) -> dict:
    """
    Scan every Drive-linked regulatory file, flag changes, and notify owners.

    Returns a summary dict: {checked, changed, errors, items:[...]}.
    Never applies changes — only flags them. Commits the transaction itself.
    """
    nodes = await _linked_nodes(db)
    notif_repo = NotificationRepository(db)
    now = datetime.now(timezone.utc)

    items: list[dict] = []
    changed = 0
    errors = 0

    if not gs.get_credentials():
        logger.info("Regulatory update check skipped: Google account not connected.")
        return {
            "checked": 0,
            "changed": 0,
            "errors": 0,
            "items": [],
            "skipped": "not_connected",
        }

    for node in nodes:
        try:
            meta = gs.drive_get_metadata(node.source_file_id)  # type: ignore[arg-type]
        except Exception as exc:  # transient API/network failure
            errors += 1
            logger.warning("Regulatory update check failed for node %s: %s", node.id, exc)
            continue

        prev_status = node.sync_status
        new_status, detail = _evaluate(node, meta)
        node.last_checked_at = now

        if new_status == "current":
            node.sync_status = "current"
            node.sync_detail = None
            continue

        node.sync_status = new_status
        node.sync_detail = detail
        changed += 1
        items.append(
            {
                "id": str(node.id),
                "name": node.name,
                "sync_status": new_status,
                "detail": detail,
            }
        )

        # Notify only on a fresh transition into a flagged state (natural dedup).
        if prev_status in (None, "current") and node.created_by is not None:
            await notif_repo.create(
                user_id=node.created_by,
                type=NotificationType.SYSTEM_ALERT.value,
                title=f"Regulatory file update available: {node.name}",
                message=detail,
                entity_type="regulatory_node",
                entity_id=node.id,
            )

    await db.commit()
    return {"checked": len(nodes), "changed": changed, "errors": errors, "items": items}


async def apply_update(db: AsyncSession, node_id: uuid.UUID) -> RegulatoryNode:
    """
    Re-download a Drive-linked regulatory file's current bytes, overwrite the
    stored file, and re-baseline the sync metadata. Sets sync_status back to
    'current'. Commits the transaction.

    Raises LookupError if not found, ValueError if not Drive-linked / missing.
    """
    node = await db.get(RegulatoryNode, node_id)
    if node is None or node.node_type != "file":
        raise LookupError(f"Regulatory file {node_id} not found")
    if node.source_type != "google_drive" or not node.source_file_id:
        raise ValueError("This file is not linked to a Google Drive source.")
    if not gs.get_credentials():
        raise ValueError("Google account not connected.")

    file_id = node.source_file_id
    meta = gs.drive_get_metadata(file_id)
    if meta is None or meta.get("trashed"):
        raise ValueError("The source file no longer exists in Google Drive.")

    dl = gs.drive_download_bytes(file_id)
    raw: bytes = dl.get("content") or b""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("File exceeds the 50 MB limit.")

    # Overwrite the existing stored bytes in place (keep the same stored_filename
    # so tree position, ids, and links are preserved).
    if node.stored_filename:
        _store_path(node.stored_filename).write_bytes(raw)
    else:
        ext = (dl.get("extension") or "").lower()
        stored = f"{uuid.uuid4().hex}{ext}"
        _store_path(stored).write_bytes(raw)
        node.stored_filename = stored
        node.extension = ext

    now = datetime.now(timezone.utc)
    node.size_bytes = len(raw)
    node.mime_type = dl.get("mime_type") or node.mime_type
    node.source_url = dl.get("url") or node.source_url
    node.source_name = dl.get("name") or node.source_name
    node.source_modified_at = parse_drive_time(dl.get("modified")) or node.source_modified_at
    node.last_synced_at = now
    node.last_checked_at = now
    node.sync_status = "current"
    node.sync_detail = None
    node.updated_at = now

    await db.flush()
    await db.commit()
    await db.refresh(node)
    return node


async def dismiss_update(db: AsyncSession, node_id: uuid.UUID) -> RegulatoryNode:
    """
    Acknowledge a flagged change without re-importing: clear the flag and
    re-baseline against the current Drive metadata so it is not re-flagged on
    the next check. Commits the transaction.

    Raises LookupError if not found.
    """
    node = await db.get(RegulatoryNode, node_id)
    if node is None or node.node_type != "file":
        raise LookupError(f"Regulatory file {node_id} not found")

    now = datetime.now(timezone.utc)
    node.last_checked_at = now

    if node.source_type == "google_drive" and node.source_file_id and gs.get_credentials():
        try:
            meta = gs.drive_get_metadata(node.source_file_id)
        except Exception:
            meta = None
        if meta is not None and not meta.get("trashed"):
            node.source_name = meta.get("name") or node.source_name
            node.source_modified_at = (
                parse_drive_time(meta.get("modified")) or node.source_modified_at
            )

    node.sync_status = "current"
    node.sync_detail = None

    await db.flush()
    await db.commit()
    await db.refresh(node)
    return node
