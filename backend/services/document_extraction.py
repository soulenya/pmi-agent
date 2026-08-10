"""Vision document extraction — send PDFs/images to Claude as native content blocks.

Reads scanned PDFs and images (certificates, invoices, forms, contracts) without
a separate OCR pipeline. Uses the LLM router's ``document_extraction`` task and
the Anthropic content-block format; ``ensure_vision_capable`` guarantees the
resolved provider can actually see the document (no silent degradation).

Every run is persisted to ``document_extractions`` for audit and reuse.
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from models.db.document_extraction import DocumentExtraction

logger = logging.getLogger(__name__)

# Anthropic caps PDF requests around 100 pages / ~32 MB — stay under both and
# split long PDFs into parts.
MAX_PART_PAGES = 90
MAX_VISION_BYTES = 28 * 1024 * 1024

IMAGE_MEDIA_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
SUPPORTED_MEDIA_TYPES = IMAGE_MEDIA_TYPES | {"application/pdf"}

# A PDF whose local text layer yields fewer characters than this is treated as
# a scan (image-only) by the vision fallbacks.
SCANNED_PDF_MIN_CHARS = 200

_TRANSCRIBE_PROMPT = (
    "Transcribe ALL legible text from this document, preserving reading order and "
    "structure (headings, tables as rows). If any region is illegible or cut off, "
    "write [illegible] there — never guess at unreadable content. "
    "Do not skip figures. For every chart, diagram, timeline or image, add a "
    "[FIGURE] block giving its caption and the information it carries, reading the "
    "values off the drawing itself — for a Gantt or timeline that means each row's "
    "label and the start and end it spans, read against the axis; for a plotted "
    "chart, the series and their values; for a photograph or diagram, what it "
    "shows. Where an axis is too coarse to read a value exactly, say so rather "
    "than inventing precision. Return only the transcription, no commentary."
)


def resolve_media_type(file_name: str, mime_type: str | None) -> str:
    """Resolve and validate the media type; raises ValueError when unsupported."""
    mt = (mime_type or "").lower().strip()
    if mt in ("image/jpg",):
        mt = "image/jpeg"
    if not mt or mt == "application/octet-stream":
        guessed, _ = mimetypes.guess_type(file_name)
        mt = (guessed or "").lower()
    if mt not in SUPPORTED_MEDIA_TYPES:
        raise ValueError(
            f"Unsupported file type for vision extraction: {mt or 'unknown'} "
            "(supported: PDF, PNG, JPEG, GIF, WEBP)"
        )
    return mt


def _content_block(raw: bytes, media_type: str) -> dict:
    data = base64.standard_b64encode(raw).decode()
    if media_type == "application/pdf":
        return {"type": "document", "source": {"type": "base64", "media_type": media_type, "data": data}}
    return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}}


def _split_pdf(raw: bytes) -> tuple[list[bytes], int]:
    """Split a PDF into ≤MAX_PART_PAGES-page parts. Returns (parts, total_pages)."""
    import fitz

    doc = fitz.open(stream=raw, filetype="pdf")
    total = doc.page_count
    if total <= MAX_PART_PAGES and len(raw) <= MAX_VISION_BYTES:
        doc.close()
        return [raw], total
    parts: list[bytes] = []
    for start in range(0, total, MAX_PART_PAGES):
        part = fitz.open()
        part.insert_pdf(doc, from_page=start, to_page=min(start + MAX_PART_PAGES, total) - 1)
        parts.append(part.tobytes())
        part.close()
    doc.close()
    return parts, total


def parse_json_response(text: str) -> dict | None:
    """Defensively parse a JSON object from a model response (fences tolerated)."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                return None
    return None


async def vision_extract_text(
    db: AsyncSession,
    *,
    raw: bytes,
    file_name: str,
    mime_type: str | None = None,
    user_id: uuid.UUID | None = None,
    source_kind: str = "fallback",
    source_ref: str = "",
) -> str:
    """
    Transcription-only vision run for fallback paths (scanned PDFs, images).

    Returns the transcribed text, or "" when vision is unavailable (no
    vision-capable model configured), the type is unsupported, or the run
    failed — callers decide their own next fallback. Attempted runs are
    recorded in document_extractions like any other.
    """
    try:
        resolve_media_type(file_name, mime_type)
    except ValueError:
        return ""
    from services.llm.router import ensure_vision_capable

    try:
        await ensure_vision_capable(db, "document_extraction")
    except RuntimeError as exc:
        logger.info("Vision text fallback unavailable: %s", exc)
        return ""
    row = await extract_document(
        db,
        raw=raw,
        file_name=file_name,
        mime_type=mime_type,
        user_id=user_id,
        source_kind=source_kind,
        source_ref=source_ref,
    )
    return row.raw_text if row.status == "ok" else ""


async def extract_document(
    db: AsyncSession,
    *,
    raw: bytes,
    file_name: str,
    mime_type: str | None = None,
    schema: dict | None = None,
    instruction: str | None = None,
    user_id: uuid.UUID | None = None,
    source_kind: str = "upload",
    source_ref: str = "",
) -> DocumentExtraction:
    """
    Run vision extraction and persist the result (commits internally).

    Returns the DocumentExtraction row: status='ok' with raw_text (+ structured
    when a schema was given), or status='error' with an honest error message.
    Never raises for extraction-level failures — only for programmer errors.
    """
    from services.llm.router import ensure_vision_capable, get_llm_client

    row = DocumentExtraction(
        id=uuid.uuid4(),
        user_id=user_id,
        source_kind=source_kind,
        source_ref=source_ref[:500],
        file_name=file_name[:500],
        schema=schema,
    )

    try:
        media_type = resolve_media_type(file_name, mime_type)
        row.mime_type = media_type
        if not raw:
            raise ValueError("The file is empty.")
        if media_type != "application/pdf" and len(raw) > MAX_VISION_BYTES:
            raise ValueError("Image exceeds the size limit for vision extraction.")

        _, model = await ensure_vision_capable(db, "document_extraction")
        row.model = model
        client = await get_llm_client(db, task="document_extraction")

        if media_type == "application/pdf":
            parts, total_pages = _split_pdf(raw)
            row.pages = total_pages
        else:
            parts = [raw]

        texts: list[str] = []
        in_tokens = out_tokens = 0
        for i, part in enumerate(parts):
            if len(part) > MAX_VISION_BYTES:
                raise ValueError(
                    "Document part exceeds the API size limit even after page "
                    "splitting — reduce the file size (e.g. re-scan at lower DPI)."
                )
            prompt = _TRANSCRIBE_PROMPT
            if instruction:
                # The vision pass is the only stage that sees the pages, so tell it
                # what is wanted — otherwise a figure is summarised away before the
                # question is ever asked.
                prompt += (
                    f"\n\nThe reader is looking for: {instruction}\nCover that in full "
                    "detail wherever it appears, including inside figures, while still "
                    "transcribing the rest of the document."
                )
            if len(parts) > 1:
                prompt += f"\n(This is part {i + 1} of {len(parts)} of the same document.)"
            chunk = await client.chat(
                messages=[{
                    "role": "user",
                    "content": [_content_block(part, media_type), {"type": "text", "text": prompt}],
                }],
                temperature=0.0,
            )
            texts.append(chunk.content.strip())
            in_tokens += chunk.input_tokens or 0
            out_tokens += chunk.output_tokens or 0

        raw_text = "\n\n".join(texts).strip()
        row.raw_text = raw_text

        if schema is not None:
            extract_prompt = (
                "Extract data from the document text below and return ONLY valid JSON "
                "matching this schema — no other text. Use null for any field not "
                "present in the document; NEVER invent values.\n\n"
                f"Schema:\n{json.dumps(schema, indent=2)}\n\n"
                + (f"Additional instructions: {instruction}\n\n" if instruction else "")
                + f"Document text:\n{raw_text[:150_000]}"
            )
            chunk = await client.chat(
                messages=[{"role": "user", "content": extract_prompt}],
                temperature=0.0,
            )
            in_tokens += chunk.input_tokens or 0
            out_tokens += chunk.output_tokens or 0
            structured = parse_json_response(chunk.content)
            if structured is None:
                row.error = "Structured output could not be parsed as JSON; raw text is available."
            row.structured = structured
        elif instruction:
            # Free-form instruction without schema: answer against the transcription.
            chunk = await client.chat(
                messages=[{
                    "role": "user",
                    "content": (
                        f"{instruction}\n\nAnswer using ONLY the document text below; if the "
                        f"answer isn't in the document, say so.\n\nDocument text:\n{raw_text[:150_000]}"
                    ),
                }],
                temperature=0.0,
            )
            in_tokens += chunk.input_tokens or 0
            out_tokens += chunk.output_tokens or 0
            row.structured = {"answer": chunk.content.strip()}

        row.input_tokens = in_tokens
        row.output_tokens = out_tokens
        row.status = "ok"
    except Exception as exc:  # noqa: BLE001 — recorded honestly, surfaced to caller
        logger.warning("Vision extraction failed for %s: %s", file_name, exc)
        row.status = "error"
        row.error = str(exc)

    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row
