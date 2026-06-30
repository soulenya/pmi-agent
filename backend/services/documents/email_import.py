"""
Gmail thread → Knowledge Base import helper.

Ingests a single Gmail *thread* (all of its messages, rendered to Markdown) into
the Knowledge Base as one document, and optionally ingests each file attachment
as its own document. Everything is tagged with ``source_type="email"`` and the
Gmail ``thread_id`` so it is traceable and de-duplicated like any other KB doc.

Email-derived content is kept in a dedicated "Email" category (see
``EMAIL_CATEGORY_NAME``) so casual correspondence never lands in the regulated
document set.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

import services.google_service as gs
from models.db.document import Document
from services.documents.ingestion import DocumentIngestionService, DuplicateDocumentError
from services.embeddings.service import EmbeddingService

# Default category for email-derived KB content (kept separate from regulated docs).
EMAIL_CATEGORY_NAME = "Email"


def _safe_filename(text: str, fallback: str = "email-thread") -> str:
    """Turn a subject line into a filesystem-safe stem."""
    cleaned = re.sub(r"[^\w\- ]+", "", text or "").strip()
    cleaned = re.sub(r"\s+", "-", cleaned)
    return (cleaned or fallback)[:80]


def _thread_to_markdown(thread: dict) -> str:
    """Render a Gmail thread (from ``gmail_get_thread``) to Markdown for ingestion."""
    subject = thread.get("subject") or "(no subject)"
    lines: list[str] = [f"# {subject}", ""]
    for idx, m in enumerate(thread.get("messages", []), start=1):
        lines.append(f"## Message {idx}")
        lines.append(f"**From:** {m.get('from', '')}")
        lines.append(f"**To:** {m.get('to', '')}")
        lines.append(f"**Date:** {m.get('date', '')}")
        if m.get("subject"):
            lines.append(f"**Subject:** {m.get('subject')}")
        attachments = m.get("attachments") or []
        if attachments:
            names = ", ".join(a.get("filename", "") for a in attachments)
            lines.append(f"**Attachments:** {names}")
        lines.append("")
        lines.append((m.get("body") or "").strip())
        lines.append("")
        lines.append("---")
        lines.append("")
    return "\n".join(lines)


async def import_gmail_thread(
    *,
    db: AsyncSession,
    embedding_svc: EmbeddingService,
    thread_id: str,
    title: str | None,
    category_id: UUID | None,
    is_regulated: bool,
    created_by_id: UUID,
    include_attachments: bool = True,
    force: bool = False,
) -> dict:
    """Ingest a Gmail thread (and optionally its attachments) into the KB.

    Returns ``{"document": Document, "attachments": [{filename, status, ...}]}``.
    Raises ``DuplicateDocumentError`` if the thread body is already in the KB
    (unless ``force``) and ``ValueError`` if the thread has no readable content.
    Per-attachment failures/duplicates are reported in the result, not raised.
    The caller owns the transaction (commit/rollback).
    """
    thread = gs.gmail_get_thread(thread_id)
    subject = thread.get("subject") or "(no subject)"
    markdown = _thread_to_markdown(thread)
    if not markdown.strip():
        raise ValueError("This email thread has no readable content to import.")

    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)

    doc = await svc.ingest(
        filename=_safe_filename(subject) + ".md",
        raw_bytes=markdown.encode("utf-8"),
        title=title or f"Email: {subject}",
        category_id=category_id,
        is_regulated=is_regulated,
        created_by_id=created_by_id,
        allow_duplicate=force,
    )

    now = datetime.now(timezone.utc)
    messages = thread.get("messages", [])
    doc.source_type = "email"
    doc.source_id = thread_id
    doc.source_name = subject
    doc.author = (messages[0].get("from") if messages else None) or None
    doc.last_synced_at = now
    doc.last_checked_at = now

    attachments_result: list[dict] = []
    if include_attachments:
        for m in messages:
            if not m.get("attachments"):
                continue
            for f in gs.gmail_get_attachments(m["id"]):
                fname = f.get("filename") or "attachment"
                data = f.get("data") or b""
                if not data:
                    continue
                try:
                    async with db.begin_nested():
                        a_doc = await svc.ingest(
                            filename=fname,
                            raw_bytes=data,
                            title=fname,
                            category_id=category_id,
                            is_regulated=is_regulated,
                            created_by_id=created_by_id,
                            allow_duplicate=force,
                        )
                        a_doc.source_type = "email"
                        a_doc.source_id = f"{thread_id}:{f.get('attachment_id', '')}"
                        a_doc.source_name = subject
                    attachments_result.append(
                        {"filename": fname, "status": "imported", "id": str(a_doc.id)}
                    )
                except DuplicateDocumentError:
                    attachments_result.append({"filename": fname, "status": "skipped_duplicate"})
                except ValueError:
                    attachments_result.append({"filename": fname, "status": "unsupported"})
                except Exception as exc:  # noqa: BLE001 — report, don't abort the import
                    attachments_result.append(
                        {"filename": fname, "status": "failed", "error": str(exc)}
                    )

    return {"document": doc, "attachments": attachments_result}
