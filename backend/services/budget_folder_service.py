"""Budget folder scanning — read-only extraction from linked Drive folders.

A budget can link Drive folders (invoices, receipts, project docs). Gerry
scans them WITHOUT touching the sources: lists files, pulls text (PyMuPDF
for PDFs, CSV/plain decode, Drive-OCR-via-temp-Google-Doc for images and
scanned PDFs), asks the configured LLM for vendor/date/amount/category, and
proposes ledger entries as accept/dismiss ``budget_entry`` suggestions —
the exact accept path budgets already use. A per-folder ``scanned_files``
registry guarantees nothing is processed or suggested twice.

Also home to the per-budget Gmail invoice check (suggest-first: found
attachments become ``gmail_invoice`` suggestions whose accept files the
attachment into the budget's linked invoice folder and adds the entry).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.assistant import AssistantSuggestion
from models.db.budget import Budget, BudgetFolder
from models.db.enums import NotificationType
from repositories.conversation_repo import NotificationRepository

logger = logging.getLogger(__name__)

# Bound each scan pass: OCR + LLM per file is slow and costs money.
MAX_FILES_PER_SCAN = 8
_TEXT_MIN_CHARS = 40  # under this, a PDF is likely scanned → try OCR

_SCANNABLE_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "text/csv",
    "text/plain",
}

_EXTRACT_SYSTEM = (
    "You are Little Gerry, extracting billing data from a document for a "
    "personal budget ledger. Be precise; never invent values."
)

_EXTRACT_INSTRUCTIONS = (
    "From the document text, extract the invoice/receipt data. Respond ONLY "
    "with JSON in this exact shape:\n"
    "{\n"
    '  "vendor": "..." | null,\n'
    '  "date": "YYYY-MM-DD" | null,\n'
    '  "amount": number | null,\n'
    '  "category": "..." | null\n'
    "}\n"
    "amount = the TOTAL amount due/paid (not subtotals or line items). "
    "date = the invoice/receipt date (NOT a due date). category must be one "
    "of the provided budget categories or null when none fits. Use null for "
    "anything not clearly present."
)


class BudgetFolderError(Exception):
    """User-facing folder-linking/scanning failure."""


async def _run(fn):
    return await asyncio.get_event_loop().run_in_executor(None, fn)


def _extract_json(text: str) -> dict:
    if not text:
        return {}
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except Exception:  # noqa: BLE001
        return {}


# ── linking ───────────────────────────────────────────────────────────────


async def link_folder(db: AsyncSession, budget: Budget, kind: str, ref: str) -> BudgetFolder:
    from services import google_service as gs
    from services.live_document import extract_drive_file_id

    if not gs.get_credentials():
        raise BudgetFolderError("Google Workspace is not connected — connect it in Settings first.")
    kind = kind.strip().lower()
    if kind not in ("invoice", "receipt"):
        raise BudgetFolderError("Folder kind must be 'invoice' or 'receipt'.")
    folder_id = extract_drive_file_id(ref)
    if not folder_id:
        raise BudgetFolderError("Paste the Drive folder's link (or its ID).")
    try:
        meta = await _run(lambda: gs.drive_get_metadata(folder_id))
    except Exception as exc:  # noqa: BLE001
        raise BudgetFolderError(f"Couldn't read that folder: {str(exc)[:200]}") from exc
    if meta is None:
        raise BudgetFolderError(
            "Google couldn't find that folder. Check the link, and make sure "
            "it's shared with the connected Google account."
        )
    existing = (
        await db.execute(
            select(BudgetFolder).where(
                BudgetFolder.budget_id == budget.id,
                BudgetFolder.folder_id == folder_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise BudgetFolderError(f'That folder is already linked ("{existing.folder_name}").')
    folder = BudgetFolder(
        budget_id=budget.id,
        kind=kind,
        folder_id=folder_id,
        folder_name=(meta.get("name") or "Drive folder")[:500],
        folder_url=meta.get("url") or f"https://drive.google.com/drive/folders/{folder_id}",
    )
    db.add(folder)
    await db.flush()
    return folder


# ── extraction ────────────────────────────────────────────────────────────


def _get_text(data: bytes, name: str, mime: str) -> str:
    """Text from file bytes: parse what we can locally, OCR the rest."""
    from services import google_service as gs

    mime = (mime or "").split(";")[0].strip().lower()
    if mime in ("text/csv", "text/plain"):
        return data.decode("utf-8", errors="replace")
    if mime == "application/pdf":
        text = _pdf_local_text(data)
        if len(text.strip()) >= _TEXT_MIN_CHARS:
            return text
        # Likely a scanned PDF → Drive OCR via temp Google Doc.
        return gs.drive_ocr_extract_text(data, name, mime)
    if mime.startswith("image/"):
        return gs.drive_ocr_extract_text(data, name, mime)
    return ""


def _pdf_local_text(data: bytes) -> str:
    try:
        import fitz  # PyMuPDF

        with fitz.open(stream=data, filetype="pdf") as pdf:
            return "\n\n".join(t for t in (p.get_text() for p in pdf) if t.strip())
    except Exception:  # noqa: BLE001
        return ""


async def _get_text_smart(db: AsyncSession, data: bytes, name: str, mime: str) -> str:
    """Like _get_text, but scans/images go vision-first (works without Google),
    with Drive OCR as the fallback."""
    from services import google_service as gs

    mime = (mime or "").split(";")[0].strip().lower()
    if mime in ("text/csv", "text/plain"):
        return data.decode("utf-8", errors="replace")
    if mime == "application/pdf":
        text = await _run(lambda: _pdf_local_text(data))
        if len(text.strip()) >= _TEXT_MIN_CHARS:
            return text
    elif not mime.startswith("image/"):
        return ""
    # Scanned PDF or image → vision transcription first, Drive OCR fallback.
    from services.document_extraction import vision_extract_text

    vtext = await vision_extract_text(
        db, raw=data, file_name=name, mime_type=mime,
        source_kind="budget_scan", source_ref=name,
    )
    if vtext.strip():
        return vtext
    try:
        return await _run(lambda: gs.drive_ocr_extract_text(data, name, mime))
    except Exception as exc:  # noqa: BLE001 — no OCR path left; scanner skips the file
        logger.info("Folder scan: OCR fallback failed for %s (%s)", name, exc)
        return ""


async def _llm_extract(db: AsyncSession, text: str, categories: list[str]) -> dict:
    from services.llm.router import get_llm_client

    try:
        client = await get_llm_client(db, task="daily_assistant")
    except Exception as exc:  # noqa: BLE001
        logger.info("Folder scan: LLM unavailable (%s)", exc)
        return {}
    prompt = (
        _EXTRACT_INSTRUCTIONS
        + "\nBudget categories: "
        + (", ".join(categories) if categories else "(none defined)")
        + "\n\nDocument text (may be OCR, truncated):\n"
        + text[:6000]
    )
    try:
        chunk = await client.chat(
            [
                {"role": "system", "content": _EXTRACT_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("Folder scan: LLM call failed (%s)", exc)
        return {}
    return _extract_json(chunk.content)


async def _suggest_entry(
    db: AsyncSession,
    budget: Budget,
    source_id: str,
    title: str,
    summary: str,
    entry: dict,
    source_url: str | None,
    kind: str = "budget_entry",
    extra_payload: dict | None = None,
) -> AssistantSuggestion | None:
    prior = (
        await db.execute(
            select(AssistantSuggestion).where(
                AssistantSuggestion.user_id == budget.user_id,
                AssistantSuggestion.kind == kind,
                AssistantSuggestion.source_id == source_id,
            )
        )
    ).scalar_one_or_none()
    if prior is not None:
        return None
    s = AssistantSuggestion(
        user_id=budget.user_id,
        kind=kind,
        status="pending",
        title=title[:500],
        summary=summary,
        source_type="budget_folder" if kind == "budget_entry" else "gmail_invoice",
        source_id=source_id[:255],
        source_url=source_url,
        payload={
            "budget_id": str(budget.id),
            "budget_title": budget.title,
            "entry": entry,
            **(extra_payload or {}),
        },
    )
    db.add(s)
    await db.flush()
    try:
        await NotificationRepository(db).create(
            user_id=budget.user_id,
            type=NotificationType.APPROVAL_REQUIRED.value,
            title=s.title,
            message=s.summary,
            entity_type="assistant_suggestion",
            entity_id=s.id,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to notify for %s suggestion", kind)
    return s


def _fmt(value, currency: str = "USD") -> str:
    sym = "$" if (currency or "USD").upper() == "USD" else f"{currency} "
    return f"{sym}{float(value):,.2f}"


async def scan_folder(db: AsyncSession, budget: Budget, folder: BudgetFolder) -> dict:
    """One read-only scan pass over a linked folder. Returns a summary dict."""
    from services import google_service as gs

    if not gs.get_credentials():
        raise BudgetFolderError("Google Workspace is not connected — connect it in Settings first.")

    try:
        children = await _run(lambda: gs.drive_list_folder(folder.folder_id, max_results=200))
    except Exception as exc:  # noqa: BLE001
        raise BudgetFolderError(f"Couldn't list the folder: {str(exc)[:200]}") from exc

    registry = dict(folder.scanned_files or {})
    candidates = [
        c for c in children
        if c.get("type") != "folder"
        and c["id"] not in registry
        and (c.get("type") or "").split(";")[0].strip().lower() in _SCANNABLE_MIMES
    ]
    skipped_unsupported = len(
        [c for c in children if c.get("type") != "folder" and c["id"] not in registry]
    ) - len(candidates)
    batch = candidates[:MAX_FILES_PER_SCAN]
    remaining = len(candidates) - len(batch)

    categories = [c["name"] for c in (budget.cached_categories or []) if c.get("name")]
    cur = budget.currency or "USD"
    suggested = 0
    no_amount = 0
    errors = 0

    for f in batch:
        record: dict = {
            "name": f.get("name", ""),
            "scanned_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            blob = await _run(lambda fid=f["id"]: gs.drive_download_bytes(fid))
            text = await _get_text_smart(
                db, blob["content"], f.get("name", ""), blob.get("mime_type", f.get("type", ""))
            )
            extracted = await _llm_extract(db, text, categories) if text.strip() else {}
            amount = extracted.get("amount")
            try:
                amount = float(amount) if amount is not None else None
            except (TypeError, ValueError):
                amount = None
            record.update(
                vendor=extracted.get("vendor"),
                date=extracted.get("date"),
                amount=amount,
                category=extracted.get("category"),
            )
            if amount is not None and amount > 0:
                vendor = str(extracted.get("vendor") or "").strip()
                desc = (f"{vendor} — {f.get('name', '')}" if vendor else f.get("name", ""))[:300]
                cat = str(extracted.get("category") or "").strip()
                s = await _suggest_entry(
                    db,
                    budget,
                    source_id=f"folderdoc:{folder.folder_id}:{f['id']}",
                    title=f'Log {_fmt(amount, cur)} to budget "{budget.title}"?',
                    summary=f'From "{f.get("name", "")}" in the linked {folder.kind} folder "{folder.folder_name}".',
                    entry={
                        "date": str(extracted.get("date") or "") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                        "description": desc,
                        "amount": amount,
                        # A category the sheet has not met yet is added to it on
                        # accept, so a new kind of cost is not silently dropped.
                        "category": cat,
                        "note": f"Extracted from {folder.kind} folder: {f.get('url', '')}",
                    },
                    source_url=f.get("url"),
                )
                if s is not None:
                    record["status"] = "suggested"
                    record["suggestion_id"] = str(s.id)
                    suggested += 1
                else:
                    record["status"] = "already_suggested"
            else:
                record["status"] = "no_amount"
                no_amount += 1
        except Exception:  # noqa: BLE001 — one bad file must not sink the scan
            logger.exception("Folder scan failed for file %s", f.get("id"))
            record["status"] = "error"
            errors += 1
        registry[f["id"]] = record

    folder.scanned_files = registry
    folder.last_scan_at = datetime.now(timezone.utc)
    await db.flush()
    return {
        "scanned": len(batch),
        "suggested": suggested,
        "no_amount": no_amount,
        "errors": errors,
        "remaining": remaining,
        "skipped_unsupported": skipped_unsupported,
        "total_extracted": folder_extracted_total(folder),
    }


def folder_extracted_total(folder: BudgetFolder) -> float:
    return round(
        sum(
            float(r.get("amount") or 0)
            for r in (folder.scanned_files or {}).values()
            if isinstance(r, dict)
        ),
        2,
    )


# ── manual intake (a document that reached neither Drive nor the inbox) ───


async def intake_upload(
    db: AsyncSession, budget: Budget, *, filename: str, data: bytes, mime: str
) -> dict:
    """Read one hand-supplied invoice and propose it, exactly like a scan.

    Not every invoice arrives by email or lands in a watched folder. This is
    the same extraction and the same accept-or-dismiss review, so a document
    someone was handed on paper ends up in the ledger the same way.
    """
    mime = (mime or "").split(";")[0].strip().lower()
    if mime not in _SCANNABLE_MIMES:
        raise BudgetFolderError(
            "That file can't be read. Use a PDF, an image, or a CSV."
        )
    if not data:
        raise BudgetFolderError("That file is empty.")

    name = (filename or "invoice").strip()[:300]
    text = await _get_text_smart(db, data, name, mime)
    if not text.strip():
        raise BudgetFolderError(
            "No text could be read out of that file. A clearer scan usually works."
        )
    categories = [c["name"] for c in (budget.cached_categories or []) if c.get("name")]
    extracted = await _llm_extract(db, text, categories)
    try:
        amount = float(extracted["amount"]) if extracted.get("amount") is not None else None
    except (TypeError, ValueError, KeyError):
        amount = None
    if amount is None or amount <= 0:
        raise BudgetFolderError(
            "No total could be read out of that file — add the entry by hand instead."
        )

    vendor = str(extracted.get("vendor") or "").strip()
    cur = budget.currency or "USD"
    s = await _suggest_entry(
        db,
        budget,
        # The bytes identify the document, so the same invoice uploaded twice
        # is recognised rather than counted twice.
        source_id=f"upload:{hashlib.sha256(data).hexdigest()[:40]}",
        title=f'Log {_fmt(amount, cur)} to budget "{budget.title}"?',
        summary=f'From "{name}", uploaded by hand.',
        entry={
            "date": str(extracted.get("date") or "")
            or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "description": (f"{vendor} — {name}" if vendor else name)[:300],
            "amount": amount,
            "category": str(extracted.get("category") or "").strip(),
            "note": f"Uploaded by hand: {name}",
        },
        source_url=None,
    )
    return {
        "suggested": s is not None,
        "duplicate": s is None,
        "vendor": vendor,
        "amount": amount,
        "date": extracted.get("date"),
        "category": extracted.get("category"),
    }


# ── Gmail invoice check (per-budget, suggest-first) ──────────────────────

_GMAIL_QUERY = 'newer_than:2d has:attachment (invoice OR receipt OR bill OR "amount due")'


async def gmail_check_budget(db: AsyncSession, budget: Budget) -> int:
    """Look for fresh invoice-ish emails and suggest them for this budget.

    Accepting a ``gmail_invoice`` suggestion files the attachment into the
    budget's linked invoice folder (when one exists) and adds the ledger
    entry. Returns the number of new suggestions."""
    from services import google_service as gs
    from services.invoice_service import parse_amount

    if not gs.get_credentials():
        return 0
    try:
        messages = await _run(lambda: gs.gmail_search(_GMAIL_QUERY, max_results=10))
    except Exception:  # noqa: BLE001
        logger.info("Gmail budget check: search failed for %s", budget.id)
        return 0

    folder = (
        await db.execute(
            select(BudgetFolder)
            .where(BudgetFolder.budget_id == budget.id, BudgetFolder.kind == "invoice")
            .order_by(BudgetFolder.created_at)
        )
    ).scalars().first()

    created = 0
    for m in messages:
        msg_id = m.get("id") or m.get("message_id")
        if not msg_id:
            continue
        try:
            atts = await _run(lambda mid=msg_id: gs.gmail_get_attachments(mid))
        except Exception:  # noqa: BLE001
            continue
        usable = [
            a for a in atts
            if (a.get("mime_type") or "").split(";")[0].strip().lower()
            in ("application/pdf", "image/png", "image/jpeg", "image/jpg", "text/csv")
        ]
        if not usable:
            continue
        meta = None
        for att in usable[:2]:
            if meta is None:
                try:
                    meta = await _run(lambda mid=msg_id: gs.gmail_get_message(mid))
                except Exception:  # noqa: BLE001
                    meta = {}
            amount = parse_amount(f"{meta.get('subject', '')}\n{meta.get('body', '')}")
            sender = (meta.get("from", "").split("<")[0] or "").strip().strip('"')
            action = (
                f'filed to "{folder.folder_name}" and logged'
                if folder is not None else "logged"
            )
            s = await _suggest_entry(
                db,
                budget,
                source_id=f"gmailinv:{msg_id}:{att['filename']}",
                title=(
                    f'Invoice from {sender or "email"}: '
                    + (f"{_fmt(amount, budget.currency)} " if amount is not None else "")
                    + f'→ budget "{budget.title}"?'
                ),
                summary=(
                    f'"{att["filename"]}" from "{meta.get("subject", "")[:80]}" — accepting means it is {action}. '
                    + ("" if amount is not None else "No amount could be read from the email; only the file is filed.")
                ),
                entry={
                    "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "description": f"{sender or 'Email'} invoice — {att['filename']}"[:300],
                    "amount": amount,
                    "category": "",
                    "note": f"From email: {meta.get('subject', '')[:120]}",
                },
                source_url=None,
                kind="gmail_invoice",
                extra_payload={
                    "message_id": msg_id,
                    "attachment_filename": att["filename"],
                    "folder_row_id": str(folder.id) if folder is not None else None,
                },
            )
            if s is not None:
                created += 1
    return created
