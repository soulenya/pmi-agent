"""
Document source-update detection (Google Drive sync).

Provides cheap, metadata-only polling of Google Drive source files linked to
Knowledge Base documents.  When a linked file is modified, renamed, or deleted
in Drive, the corresponding document is *flagged* (sync_status) and a
``refresh_document`` approval is raised for the owner — so it sits in the
Approvals tab (and on Today) until they decide. Changes are never auto-applied:
approving re-imports, rejecting keeps the stored copy (important for regulated
content).

Public API:
    parse_drive_time(s)                      -> datetime | None
    check_document_updates(db)               -> dict   (scan + flag + raise approval)
    apply_document_update(db, emb, doc_id)   -> Document (re-import from Drive)
    dismiss_document_update(db, doc_id)      -> Document (acknowledge, re-baseline)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import services.google_service as gs
from models.db.approval import ApprovalIntent
from models.db.document import Document
from models.db.enums import ApprovalStatus, IntentType
from models.db.notification import Notification
from repositories.conversation_repo import ApprovalRepository

logger = logging.getLogger(__name__)

REFRESH_INTENT = IntentType.REFRESH_DOCUMENT.value


def parse_drive_time(value: str | None) -> datetime | None:
    """Parse an RFC3339 Drive timestamp (e.g. '2026-06-08T14:39:00.000Z')."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _evaluate(doc: Document, meta: dict | None) -> tuple[str, str | None]:
    """Return (sync_status, sync_detail) for a document given fresh Drive meta."""
    if meta is None or meta.get("trashed"):
        return "deleted", "The source file was removed or trashed in Google Drive."

    current_name = meta.get("name") or ""
    current_mod = parse_drive_time(meta.get("modified"))

    renamed = bool(doc.source_name and current_name and current_name != doc.source_name)
    modified = bool(
        current_mod
        and doc.source_modified_at
        and current_mod > doc.source_modified_at
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


async def _linked_documents(db: AsyncSession, owner_id=None) -> list[Document]:
    stmt = select(Document).where(
        Document.deleted_at.is_(None),
        Document.source_type == "google_drive",
        Document.source_id.isnot(None),
    )
    if owner_id is not None:
        stmt = stmt.where(Document.created_by == owner_id)
    result = await db.execute(stmt)
    return list(result.scalars())


async def _pending_refresh_intent(db: AsyncSession, doc_id: UUID) -> ApprovalIntent | None:
    """The open approval for this document, if one is already waiting."""
    return (
        await db.execute(
            select(ApprovalIntent)
            .where(
                ApprovalIntent.intent_type == REFRESH_INTENT,
                ApprovalIntent.status == ApprovalStatus.PENDING,
                ApprovalIntent.intent_payload["document_id"].astext == str(doc_id),
            )
            .order_by(ApprovalIntent.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def raise_refresh_approval(
    db: AsyncSession, doc: Document, meta: dict | None, detail: str | None
) -> ApprovalIntent | None:
    """Put the change in front of the owner as an approval. One per document.

    Returns the new intent, or None when there is nobody to ask or one is
    already waiting.
    """
    if doc.created_by is None:
        return None
    if await _pending_refresh_intent(db, doc.id) is not None:
        return None
    current_name = (meta or {}).get("name") or doc.source_name or doc.title
    verb = {
        "modified": "was updated",
        "renamed": "was renamed",
        "deleted": "was removed",
    }.get(doc.sync_status or "", "changed")
    return await ApprovalRepository(db).create(
        user_id=doc.created_by,
        intent_type=REFRESH_INTENT,
        intent_title=f"Update {doc.title} from Google Drive",
        intent_description=detail or f"The source file {verb} in Google Drive.",
        intent_payload={
            "document_id": str(doc.id),
            "document_title": doc.title,
            "sync_status": doc.sync_status,
            "detail": detail,
            "source_name": current_name,
            "source_id": doc.source_id,
            "source_url": (meta or {}).get("url") or "",
            "modified_by": (meta or {}).get("modified_by") or "",
            "source_modified": (meta or {}).get("modified") or "",
        },
        risk_level="low",
    )


async def settle_refresh_approvals(
    db: AsyncSession, doc_id: UUID, *, approved: bool, resolved_by: UUID | None = None
) -> int:
    """The document was dealt with — close any approval still open for it.

    Apply and Dismiss on the Documents page, and Approve/Reject on the card,
    must leave the same state behind; whichever happened first, the other
    surface stops offering the choice. Does not commit.
    """
    intents = list(
        (
            await db.execute(
                select(ApprovalIntent).where(
                    ApprovalIntent.intent_type == REFRESH_INTENT,
                    ApprovalIntent.status == ApprovalStatus.PENDING,
                    ApprovalIntent.intent_payload["document_id"].astext == str(doc_id),
                )
            )
        ).scalars()
    )
    if not intents:
        return 0
    now = datetime.now(timezone.utc)
    for intent in intents:
        intent.status = ApprovalStatus.APPROVED if approved else ApprovalStatus.REJECTED
        intent.resolved_by = resolved_by or intent.user_id
        intent.resolved_at = now
    await db.execute(
        update(Notification)
        .where(
            Notification.is_read.is_(False),
            Notification.entity_type == "approval_intent",
            Notification.entity_id.in_([i.id for i in intents]),
        )
        .values(is_read=True, read_at=now)
    )
    return len(intents)


async def check_document_updates(db: AsyncSession, owner_id=None) -> dict:
    """
    Scan Drive-linked documents, flag changes, and raise an approval for each.

    *owner_id* narrows the scan to one person's documents, which is what the hub
    needs: only their own Google grant can read the files they linked.

    Returns a summary dict: {checked, changed, errors, items:[...]}.
    Commits the transaction itself.
    """
    docs = await _linked_documents(db, owner_id)
    now = datetime.now(timezone.utc)

    items: list[dict] = []
    changed = 0
    errors = 0

    if not gs.get_credentials():
        logger.info("Drive update check skipped: Google account not connected.")
        return {"checked": 0, "changed": 0, "errors": 0, "items": [], "skipped": "not_connected"}

    for doc in docs:
        try:
            meta = gs.drive_get_metadata(doc.source_id)  # type: ignore[arg-type]
        except Exception as exc:  # transient API/network failure
            errors += 1
            logger.warning("Update check failed for document %s: %s", doc.id, exc)
            continue

        prev_status = doc.sync_status
        new_status, detail = _evaluate(doc, meta)
        doc.last_checked_at = now

        if new_status == "current":
            doc.sync_status = "current"
            doc.sync_detail = None
            continue

        doc.sync_status = new_status
        doc.sync_detail = detail
        changed += 1

        # An approval is raised once per flagged document: on the transition
        # into a flagged state, or when a flagged document somehow has none
        # waiting (predates this, or was cleared out as expired).
        intent = None
        if prev_status in (None, "current") or await _pending_refresh_intent(db, doc.id) is None:
            intent = await raise_refresh_approval(db, doc, meta, detail)

        items.append(
            {
                "id": str(doc.id),
                "title": doc.title,
                "sync_status": new_status,
                "detail": detail,
                "user_id": str(doc.created_by) if doc.created_by else None,
                "notify": intent is not None,
                "approval_id": str(intent.id) if intent is not None else None,
            }
        )

    await db.commit()
    return {"checked": len(docs), "changed": changed, "errors": errors, "items": items}


async def apply_document_update(
    db: AsyncSession, embedding_svc, doc_id: UUID, *, resolved_by: UUID | None = None
) -> Document:
    """
    Re-fetch a Drive-linked document's current content and re-ingest it,
    updating the stored file, chunks, and sync baseline. Sets sync_status back
    to 'current' and closes the document's open approval. Commits.

    Raises LookupError if not found, ValueError if not Drive-linked or content
    could not be extracted.
    """
    from services.documents.ingestion import DocumentIngestionService

    stmt = select(Document).where(Document.id == doc_id, Document.deleted_at.is_(None))
    doc = (await db.execute(stmt)).scalar_one_or_none()
    if doc is None:
        raise LookupError(f"Document {doc_id} not found")
    if doc.source_type != "google_drive" or not doc.source_id:
        raise ValueError("Document is not linked to a Google Drive source.")
    if not gs.get_credentials():
        raise ValueError("Google account not connected.")

    file_id = doc.source_id
    meta = gs.drive_get_metadata(file_id)
    if meta is None or meta.get("trashed"):
        raise ValueError("The source file no longer exists in Google Drive.")

    data = gs.drive_get_content(file_id, max_chars=None)
    content = (data.get("content") or "").strip()
    name = data.get("name") or doc.source_name or "drive_file.txt"
    mime = data.get("type", "text/plain")
    if not content:
        raise ValueError(f"Could not extract text from '{name}' ({mime}).")

    ext_map = {
        "application/vnd.google-apps.document": ".txt",
        "application/vnd.google-apps.spreadsheet": ".csv",
        "application/vnd.google-apps.presentation": ".txt",
        "text/plain": ".txt",
        "text/csv": ".csv",
        "text/markdown": ".md",
        "application/json": ".json",
    }
    ext = ext_map.get(mime, ".txt")
    filename = Path(name).stem + ext
    raw_bytes = content.encode("utf-8")

    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    doc = await svc.replace_content(doc_id, filename, raw_bytes)

    now = datetime.now(timezone.utc)
    doc.source_name = name
    doc.source_modified_at = parse_drive_time(meta.get("modified"))
    doc.last_synced_at = now
    doc.last_checked_at = now
    doc.sync_status = "current"
    doc.sync_detail = None
    await settle_refresh_approvals(db, doc.id, approved=True, resolved_by=resolved_by)

    await db.commit()
    await db.refresh(doc)
    return doc


async def dismiss_document_update(
    db: AsyncSession, doc_id: UUID, *, resolved_by: UUID | None = None
) -> Document:
    """
    Acknowledge a flagged change without re-importing: clear the flag,
    re-baseline against the current Drive metadata so it is not re-flagged on
    the next check, and close the document's open approval. Commits.

    Raises LookupError if not found.
    """
    stmt = select(Document).where(Document.id == doc_id, Document.deleted_at.is_(None))
    doc = (await db.execute(stmt)).scalar_one_or_none()
    if doc is None:
        raise LookupError(f"Document {doc_id} not found")

    now = datetime.now(timezone.utc)
    doc.last_checked_at = now

    if doc.source_type == "google_drive" and doc.source_id and gs.get_credentials():
        try:
            meta = gs.drive_get_metadata(doc.source_id)
        except Exception:
            meta = None
        if meta is not None and not meta.get("trashed"):
            doc.source_name = meta.get("name") or doc.source_name
            doc.source_modified_at = parse_drive_time(meta.get("modified")) or doc.source_modified_at

    doc.sync_status = "current"
    doc.sync_detail = None
    await settle_refresh_approvals(db, doc.id, approved=False, resolved_by=resolved_by)

    await db.commit()
    await db.refresh(doc)
    return doc
