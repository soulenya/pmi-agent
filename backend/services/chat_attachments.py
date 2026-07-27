"""
Chat reference-file attachments.

These are files a user attaches to a *conversation* for reference or editing —
deliberately separate from the Knowledge Base. Unlike KB documents they are NOT
chunked or embedded; instead the extracted plain text is stored on the row and
injected into the model's context for that conversation, and the original bytes
are kept Fernet-encrypted on disk so the user can re-download them.

Storage layout: STORAGE_ROOT/chat-attachments/{attachment_id}{ext}.enc
"""

from __future__ import annotations

import logging
import mimetypes
import uuid
from pathlib import Path

from cryptography.fernet import Fernet

from config import settings
from services.documents.ingestion import SUPPORTED_MIME_TYPES, _extract_text

logger = logging.getLogger(__name__)

# ── Limits ────────────────────────────────────────────────────────────────────

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024   # 25 MB per file
MAX_STORED_TEXT_CHARS = 1_000_000          # cap text persisted per attachment

# Context-injection caps (keep the prompt from blowing up on large files).
PER_FILE_CONTEXT_CHARS = 50_000
TOTAL_CONTEXT_CHARS = 150_000

# Map common extensions → mime type for files whose browser-supplied
# content_type is missing or generic (e.g. application/octet-stream).
_EXT_MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

# Images are read with vision (Document Extraction task), falling back to
# Drive OCR — the extracted text is stored exactly like any other attachment.
IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
ATTACHMENT_MIME_TYPES = SUPPORTED_MIME_TYPES | IMAGE_MIME_TYPES

_SUFFIX = ".enc"


class UnsupportedAttachmentError(Exception):
    """Raised when a file's type is not a supported reference format."""


# ── Storage helpers ───────────────────────────────────────────────────────────

def _storage_dir() -> Path:
    root = Path(settings.storage_root).expanduser().resolve() / "chat-attachments"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _stored_filename(attachment_id: uuid.UUID, extension: str) -> str:
    return f"{attachment_id}{extension}{_SUFFIX}"


def _encrypt_and_store(attachment_id: uuid.UUID, raw: bytes, extension: str) -> str:
    """Encrypt *raw* with Fernet and write it under the chat-attachments dir.

    Returns the file name (relative to the chat-attachments dir).
    """
    fernet = Fernet(settings.fernet_key)
    encrypted = fernet.encrypt(raw)
    name = _stored_filename(attachment_id, extension)
    (_storage_dir() / name).write_bytes(encrypted)
    return name


def decrypt_attachment(stored_name: str) -> bytes:
    """Read and decrypt a stored attachment by its relative file name."""
    fernet = Fernet(settings.fernet_key)
    return fernet.decrypt((_storage_dir() / stored_name).read_bytes())


def delete_stored_attachment(stored_name: str | None) -> None:
    if not stored_name:
        return
    path = _storage_dir() / stored_name
    if path.exists():
        path.unlink()


# ── Mime resolution ───────────────────────────────────────────────────────────

def resolve_mime_type(file_name: str, content_type: str | None) -> str:
    """Resolve a supported mime type from the upload, falling back to extension."""
    if content_type == "image/jpg":
        content_type = "image/jpeg"
    if content_type and content_type in ATTACHMENT_MIME_TYPES:
        return content_type
    ext = Path(file_name).suffix.lower()
    if ext in _EXT_MIME:
        return _EXT_MIME[ext]
    guessed, _ = mimetypes.guess_type(file_name)
    if guessed and guessed in ATTACHMENT_MIME_TYPES:
        return guessed
    raise UnsupportedAttachmentError(
        "Unsupported file type. Attach a PDF, Word (.docx), text, Markdown, CSV, "
        "or image (PNG/JPEG/GIF/WEBP) file."
    )


# ── Public API ────────────────────────────────────────────────────────────────

def extract_text(raw: bytes, mime_type: str) -> str:
    """Extract plain text from *raw*, capped to MAX_STORED_TEXT_CHARS."""
    text = _extract_text(raw, mime_type) or ""
    if len(text) > MAX_STORED_TEXT_CHARS:
        text = text[:MAX_STORED_TEXT_CHARS] + "\n\n[... file truncated ...]"
    return text


async def _vision_or_ocr(db, raw: bytes, mime_type: str, file_name: str) -> str:
    """Vision transcription first; Drive OCR as fallback. Returns "" if both fail."""
    from services.document_extraction import vision_extract_text

    text = await vision_extract_text(
        db, raw=raw, file_name=file_name, mime_type=mime_type,
        source_kind="chat_attachment", source_ref=file_name,
    )
    if text.strip():
        return text
    try:
        import asyncio

        from services import google_service as gs

        if gs.get_credentials():
            return await asyncio.get_event_loop().run_in_executor(
                None, lambda: gs.drive_ocr_extract_text(raw, file_name, mime_type)
            )
    except Exception as exc:  # noqa: BLE001 — fallback of a fallback; log and move on
        logger.info("Drive OCR fallback failed for %s: %s", file_name, exc)
    return ""


async def extract_text_smart(db, raw: bytes, mime_type: str, file_name: str) -> str:
    """
    Extract text like extract_text, but images and scanned (image-only) PDFs
    are read with vision → Drive OCR. Raises RuntimeError when an image yields
    no text at all — an unreadable image attachment helps nobody.
    """
    from services.document_extraction import SCANNED_PDF_MIN_CHARS

    if mime_type in IMAGE_MIME_TYPES:
        text = await _vision_or_ocr(db, raw, mime_type, file_name)
        if not text.strip():
            raise RuntimeError(
                "Could not read any text from this image. Vision extraction needs "
                "a vision-capable model (Settings → AI Models → Document "
                "Extraction), and Drive OCR needs Google connected."
            )
    else:
        text = _extract_text(raw, mime_type) or ""
        if mime_type == "application/pdf" and len(text.strip()) < SCANNED_PDF_MIN_CHARS:
            fallback = await _vision_or_ocr(db, raw, mime_type, file_name)
            if fallback.strip():
                text = fallback
    if len(text) > MAX_STORED_TEXT_CHARS:
        text = text[:MAX_STORED_TEXT_CHARS] + "\n\n[... file truncated ...]"
    return text


def store_attachment_bytes(attachment_id: uuid.UUID, raw: bytes, file_name: str) -> str:
    """Encrypt + persist the original bytes. Returns the stored file name."""
    extension = Path(file_name).suffix.lower()
    return _encrypt_and_store(attachment_id, raw, extension)


async def build_attachments_context(db, conversation_id: uuid.UUID) -> str:
    """Build a system-prompt block holding the text of every reference file
    attached to *conversation_id*. Returns "" when there are none."""
    from repositories.conversation_repo import ConversationAttachmentRepository

    repo = ConversationAttachmentRepository(db)
    attachments = await repo.list_for_conversation(conversation_id)
    if not attachments:
        return ""

    parts: list[str] = [
        "\n\n# ATTACHED REFERENCE FILES",
        "The user has attached the following file(s) to this conversation for "
        "reference and editing. They are working materials — NOT part of the "
        "Knowledge Base. Use their contents when relevant; quote or edit them as "
        "the user asks. Do not claim you cannot see a file that is listed here.",
    ]
    budget = TOTAL_CONTEXT_CHARS
    for att in attachments:
        text = (att.extracted_text or "").strip()
        if not text:
            body = "(no extractable text)"
        else:
            body = text[:PER_FILE_CONTEXT_CHARS]
            if len(text) > PER_FILE_CONTEXT_CHARS:
                body += "\n[... file truncated ...]"
        if budget <= 0:
            parts.append(
                f"\n--- FILE: {att.file_name} ---\n"
                "[omitted — total attachment context limit reached]"
            )
            continue
        if len(body) > budget:
            body = body[:budget] + "\n[... truncated to fit context ...]"
        budget -= len(body)
        parts.append(f"\n--- FILE: {att.file_name} ---\n{body}\n--- END {att.file_name} ---")

    return "\n".join(parts)
