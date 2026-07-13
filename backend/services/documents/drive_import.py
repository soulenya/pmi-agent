"""
Shared Google Drive → Knowledge Base import helper.

Both the Drive-browser import endpoint and the KB-manifest import endpoint use
``import_drive_file`` so they fetch, ingest, and source-link a Drive file
identically (and benefit from the same duplicate detection and update tracking).
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

import services.google_service as gs
from models.db.document import Document
from services.documents.ingestion import DocumentIngestionService
from services.documents.sync import parse_drive_time
from services.embeddings.service import EmbeddingService

# Extension to give Google-native exports / plain-text payloads so ingestion's
# parser picks the right path (mirrors the Drive-browser import mapping).
_NATIVE_EXT = {
    "application/vnd.google-apps.document": ".txt",
    "application/vnd.google-apps.spreadsheet": ".csv",
    "application/vnd.google-apps.presentation": ".txt",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "text/markdown": ".md",
    "application/json": ".json",
}


async def import_drive_file(
    *,
    db: AsyncSession,
    embedding_svc: EmbeddingService,
    file_id: str,
    title: str | None,
    category_id: UUID | None,
    is_regulated: bool,
    created_by_id: UUID,
    force: bool = False,
) -> Document:
    """Fetch a Drive file, ingest it, and record source linkage for update tracking.

    Raises ValueError on unreadable/empty content and
    ``DuplicateDocumentError`` on a byte-identical existing document (unless
    ``force`` is True). The caller owns the transaction (commit/rollback).
    """
    drive_file_data = gs.drive_get_content(file_id, max_chars=None)

    content = drive_file_data.get("content", "")
    name = drive_file_data.get("name", "drive_file.txt")
    mime = drive_file_data.get("type", "text/plain")
    drive_raw_bytes = drive_file_data.get("raw_bytes")
    drive_extension = drive_file_data.get("extension", "")

    if drive_raw_bytes:
        filename = Path(name).stem + drive_extension
        raw_bytes = drive_raw_bytes
    else:
        if not content.strip():
            raise ValueError(
                f"Could not extract text from '{name}' ({mime}). "
                "Supported: Google Docs/Sheets/Slides, PDFs, Word documents, and plain text."
            )
        ext = _NATIVE_EXT.get(mime, ".txt")
        filename = Path(name).stem + ext
        raw_bytes = content.encode("utf-8")

    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    doc = await svc.ingest(
        filename=filename,
        raw_bytes=raw_bytes,
        title=(title or name),
        category_id=category_id,
        is_regulated=is_regulated,
        created_by_id=created_by_id,
        allow_duplicate=force,
    )

    now = datetime.now(timezone.utc)
    doc.source_type = "google_drive"
    doc.source_id = file_id
    doc.source_name = name
    doc.source_modified_at = parse_drive_time(drive_file_data.get("modified", ""))
    doc.last_synced_at = now
    doc.last_checked_at = now
    doc.sync_status = "current"
    doc.sync_detail = None
    return doc
