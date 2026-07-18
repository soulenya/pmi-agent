"""Workroom sharing — mirror room definitions between teammates via Drive.

True real-time shared rooms need a server, which this local-first app doesn't
have. The practical version (same pattern as the KB manifest / templates
folder): each shared room writes a small JSON **manifest** to a "Little Gerry
Workrooms" folder on the shared Drive. A teammate's Gerry lists that folder,
joins a manifest (creating a local mirror room with the same goal and pins),
and can pull the latest definition anytime. Journals, conversations, and
standing tasks stay per-person by design.

Conflict model: last writer wins — pushing overwrites the manifest, pulling
overwrites local title/goal and ADDS missing pins (never deletes local ones).
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.workroom import WORKROOM_ITEM_KINDS, Workroom, WorkroomItem
from services.workroom_context import add_journal_entry, pin_workroom_item

logger = logging.getLogger(__name__)

SHARE_FOLDER_NAME = "Little Gerry Workrooms"
SETTING_FOLDER_ID = "workrooms.share_folder_id"
MANIFEST_SCHEMA = 1
_MAX_MANIFEST_BYTES = 256 * 1024  # sanity cap when reading


class ShareError(Exception):
    """User-facing sharing failure (Google not connected, bad manifest, …)."""


def _require_google() -> None:
    from services.google_service import get_credentials

    if not get_credentials():
        raise ShareError(
            "Google Workspace is not connected — connect it in Settings to share rooms."
        )


async def _run(fn):
    return await asyncio.get_event_loop().run_in_executor(None, fn)


async def _get_share_folder_id(db: AsyncSession) -> str:
    """Resolve the share folder: setting override → find/create on Drive."""
    from models.db.settings import SystemSetting
    from services import google_service as gs

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == SETTING_FOLDER_ID))
    ).scalar_one_or_none()
    if row is not None and row.value:
        return str(row.value)

    # Prefer creating inside the first shared drive so teammates see it
    # automatically; fall back to My Drive.
    parent = None
    try:
        drives = await _run(lambda: gs.drive_list_shared_drives(5))
        if drives:
            parent = drives[0]["id"]
    except Exception:  # noqa: BLE001 — no shared-drive access is fine
        parent = None
    folder = await _run(lambda: gs.drive_find_or_create_folder(SHARE_FOLDER_NAME, parent))
    if not folder.get("id"):
        raise ShareError("Couldn't find or create the shared Workrooms folder on Drive.")
    db.add(SystemSetting(key=SETTING_FOLDER_ID, value=folder["id"]))
    await db.flush()
    return folder["id"]


def _manifest_filename(title: str) -> str:
    import re

    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "room"
    return f"workroom-{slug}.json"


async def _build_manifest(db: AsyncSession, room: Workroom) -> dict:
    items = list(
        (
            await db.execute(
                select(WorkroomItem)
                .where(WorkroomItem.workroom_id == room.id)
                .order_by(WorkroomItem.created_at)
            )
        ).scalars()
    )
    return {
        "app": "little-gerry-workroom",
        "schema": MANIFEST_SCHEMA,
        "title": room.title,
        "goal": room.goal,
        "items": [
            {"kind": i.kind, "ref_id": i.ref_id, "label": i.label} for i in items
        ],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _parse_manifest(raw: bytes) -> dict:
    if len(raw) > _MAX_MANIFEST_BYTES:
        raise ShareError("Manifest file is unexpectedly large — refusing to parse.")
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ShareError(f"Manifest is not valid JSON: {exc}") from exc
    if not isinstance(data, dict) or data.get("app") != "little-gerry-workroom":
        raise ShareError("That file is not a Little Gerry workroom manifest.")
    if not str(data.get("title", "")).strip():
        raise ShareError("Manifest has no room title.")
    return data


def _clean_items(data: dict) -> list[dict]:
    out = []
    for it in data.get("items") or []:
        if not isinstance(it, dict):
            continue
        kind = str(it.get("kind", "")).strip().lower()
        label = str(it.get("label", "")).strip()[:300]
        if kind not in WORKROOM_ITEM_KINDS or not label:
            continue
        out.append({"kind": kind, "label": label, "ref_id": str(it.get("ref_id", "")).strip()[:500]})
    return out


# ── public API ────────────────────────────────────────────────────────────


async def push_room(db: AsyncSession, room: Workroom) -> dict:
    """Write/update the room's manifest on the shared Drive."""
    from services import google_service as gs

    _require_google()
    manifest = await _build_manifest(db, room)
    raw = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")

    result = None
    if room.share_file_id:
        try:
            result = await _run(
                lambda: gs.drive_update_bytes(room.share_file_id, raw, "application/json")
            )
        except Exception:  # noqa: BLE001 — manifest deleted/moved → recreate below
            logger.info("Workroom share: update failed for %s, recreating", room.share_file_id)
            result = None
    if result is None:
        folder_id = await _get_share_folder_id(db)
        name = _manifest_filename(room.title)
        result = await _run(
            lambda: gs.drive_upload_bytes(raw, name, "application/json", folder_id)
        )
        room.share_file_id = result["id"]
    await add_journal_entry(db, room, "Shared the room definition to Drive")
    await db.flush()
    return {"file_id": room.share_file_id, "url": result.get("url", "")}


async def list_shared_manifests(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """All workroom manifests in the share folder, marked joined/not."""
    from services import google_service as gs

    _require_google()
    folder_id = await _get_share_folder_id(db)
    children = await _run(lambda: gs.drive_list_folder(folder_id))

    joined_ids = {
        r.share_file_id
        for r in (
            await db.execute(
                select(Workroom).where(
                    Workroom.user_id == user_id, Workroom.share_file_id.isnot(None)
                )
            )
        ).scalars()
    }

    out: list[dict] = []
    for f in children:
        if f.get("type") == "folder" or not f["name"].lower().endswith(".json"):
            continue
        entry = {
            "file_id": f["id"],
            "file_name": f["name"],
            "modified": f.get("modified", ""),
            "url": f.get("url", ""),
            "joined": f["id"] in joined_ids,
            "title": f["name"],
            "goal": "",
        }
        try:
            blob = await _run(lambda fid=f["id"]: gs.drive_download_bytes(fid))
            data = _parse_manifest(blob.get("content") or b"")
            entry["title"] = str(data.get("title", f["name"]))[:200]
            entry["goal"] = str(data.get("goal", ""))[:500]
            entry["item_count"] = len(_clean_items(data))
        except ShareError:
            continue  # not one of ours — skip silently
        except Exception:  # noqa: BLE001 — unreadable file → skip
            logger.info("Workroom share: couldn't read manifest %s", f["id"])
            continue
        out.append(entry)
    return out


async def join_shared(db: AsyncSession, user_id: uuid.UUID, file_id: str) -> Workroom:
    """Create a local mirror room from a Drive manifest."""
    from repositories.conversation_repo import ConversationRepository
    from services import google_service as gs

    _require_google()
    existing = (
        await db.execute(
            select(Workroom).where(
                Workroom.user_id == user_id, Workroom.share_file_id == file_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ShareError(f'Already joined — the room "{existing.title}" mirrors this manifest.')

    blob = await _run(lambda: gs.drive_download_bytes(file_id))
    data = _parse_manifest(blob.get("content") or b"")

    title = str(data.get("title", "Shared room")).strip()[:200]
    conv = await ConversationRepository(db).create(user_id=user_id, title=f"Workroom: {title}")
    room = Workroom(
        user_id=user_id,
        title=title,
        goal=str(data.get("goal", "")).strip(),
        conversation_id=conv.id,
        share_file_id=file_id,
    )
    db.add(room)
    await db.flush()
    for it in _clean_items(data):
        await pin_workroom_item(db, room, it["kind"], it["label"], it["ref_id"])
    await add_journal_entry(db, room, "Joined this shared room from the Drive manifest")
    await db.flush()
    return room


async def pull_room(db: AsyncSession, room: Workroom) -> dict:
    """Refresh a linked room from its manifest (adds pins, never deletes)."""
    from services import google_service as gs

    _require_google()
    if not room.share_file_id:
        raise ShareError("This room is not linked to a shared manifest — share it first.")
    try:
        blob = await _run(lambda: gs.drive_download_bytes(room.share_file_id))
    except Exception as exc:  # noqa: BLE001
        raise ShareError(
            "Couldn't read the shared manifest — it may have been deleted from Drive."
        ) from exc
    data = _parse_manifest(blob.get("content") or b"")

    room.title = str(data.get("title", room.title)).strip()[:200] or room.title
    room.goal = str(data.get("goal", room.goal)).strip()
    added = 0
    for it in _clean_items(data):
        _, created = await pin_workroom_item(db, room, it["kind"], it["label"], it["ref_id"])
        if created:
            added += 1
    if added:
        await add_journal_entry(
            db, room, f"Pulled the shared definition — {added} new pinned item(s)"
        )
    await db.flush()
    return {"added_items": added, "title": room.title}
