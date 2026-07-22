"""Invoice filing — Gmail attachment → the company's invoice folder on Drive.

Gerry's job is to FEED THE FUNNEL: move invoice attachments from Gmail into
the right "<Company> Invoices" subfolder under the invoice parent folder.
The container-bound Apps Script owns everything downstream (OCR, sheet rows,
budget totals, burn rate, alerts) via its daily 9am folder scan — Gerry
NEVER writes to that workbook and never creates company folders (a new
company also needs its sheet block, which is the sheet's Control Panel job).

Uploads preserve original bytes (the script's OCR needs real PDFs/images,
never Google-Docs conversions). Dedup is by filename in the target folder;
the script's own fingerprint dedup is the second net.
"""

from __future__ import annotations

import asyncio
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

INVOICE_PARENT_FOLDER_ID = "10NQQeIETjEv_1fGCowSQSHGX37Cgn1eg"
SETTING_PARENT_FOLDER_ID = "invoices.parent_folder_id_override"

# Mirror the Apps Script's ALLOWED_MIMES: what its OCR pipeline can ingest.
_ALLOWED_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "text/csv",
}
_ALLOWED_EXTS = (".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".csv")

_AMOUNT_RE = re.compile(
    r"(?:\$|USD\s?)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)"
)


class InvoiceError(Exception):
    """User-facing invoice-filing failure."""


async def _run(fn):
    return await asyncio.get_event_loop().run_in_executor(None, fn)


async def get_parent_folder_id(db: AsyncSession) -> str:
    from models.db.settings import SystemSetting

    row = (
        await db.execute(
            select(SystemSetting).where(SystemSetting.key == SETTING_PARENT_FOLDER_ID)
        )
    ).scalar_one_or_none()
    if row is not None and row.value:
        return str(row.value)
    return INVOICE_PARENT_FOLDER_ID


def _is_invoice_file(att: dict) -> bool:
    mime = (att.get("mime_type") or "").lower().split(";")[0].strip()
    if mime in _ALLOWED_MIMES:
        return True
    return (att.get("filename") or "").lower().endswith(_ALLOWED_EXTS)


def parse_amount(text: str) -> float | None:
    """Best-effort largest dollar amount in an email subject/body, or None."""
    amounts = []
    for m in _AMOUNT_RE.finditer(text or ""):
        try:
            amounts.append(float(m.group(1).replace(",", "")))
        except ValueError:
            continue
    return max(amounts) if amounts else None


def _folder_display(name: str) -> str:
    """Company name from a '<Company> Invoices' folder name."""
    return re.sub(r"\s+invoices\s*$", "", name, flags=re.IGNORECASE).strip() or name


def match_company_folder(folders: list[dict], *hints: str) -> tuple[dict | None, list[dict]]:
    """(folder, candidates): unique match, or None + candidate list for the caller."""
    for hint in hints:
        h = (hint or "").strip().lower()
        if not h:
            continue
        exact = [f for f in folders if _folder_display(f["name"]).lower() == h]
        if len(exact) == 1:
            return exact[0], []
        partial = [
            f for f in folders
            if h in f["name"].lower() or _folder_display(f["name"]).lower() in h
        ]
        if len(partial) == 1:
            return partial[0], []
        if len(partial) > 1:
            return None, partial
    return None, folders


async def file_invoice_from_email(
    db: AsyncSession,
    message_id: str,
    company: str = "",
    attachment_filename: str = "",
) -> dict:
    """File one invoice attachment. Returns a result dict; raises InvoiceError
    with a user-ready message when input is needed (attachment/company choice)."""
    from services import google_service as gs

    if not gs.get_credentials():
        raise InvoiceError(
            "Google Workspace is not connected — connect it in Settings first."
        )
    message_id = message_id.strip()
    if not message_id:
        raise InvoiceError("message_id is required (find it with search_gmail).")

    try:
        meta = await _run(lambda: gs.gmail_get_message(message_id))
    except Exception as exc:  # noqa: BLE001
        raise InvoiceError(f"Couldn't read that email: {exc}") from exc

    try:
        attachments = await _run(lambda: gs.gmail_get_attachments(message_id))
    except Exception as exc:  # noqa: BLE001
        raise InvoiceError(f"Couldn't fetch the email's attachments: {exc}") from exc
    usable = [a for a in attachments if _is_invoice_file(a)]
    if not usable:
        raise InvoiceError(
            "That email has no PDF/image/CSV attachments — nothing the invoice "
            "pipeline can ingest."
        )
    if attachment_filename.strip():
        want = attachment_filename.strip().lower()
        picked = [a for a in usable if a["filename"].lower() == want] or [
            a for a in usable if want in a["filename"].lower()
        ]
        if not picked:
            names = ", ".join(a["filename"] for a in usable)
            raise InvoiceError(
                f'No attachment matches "{attachment_filename}". Available: {names}.'
            )
        att = picked[0]
    elif len(usable) == 1:
        att = usable[0]
    else:
        names = ", ".join(a["filename"] for a in usable)
        raise InvoiceError(
            f"That email has several usable attachments: {names}. Call again "
            "with attachment_filename to pick one."
        )

    # Resolve the "<Company> Invoices" folder — never auto-create (a new
    # company also needs its sheet block via the sheet's Control Panel).
    parent_id = await get_parent_folder_id(db)
    try:
        children = await _run(lambda: gs.drive_list_folder(parent_id, max_results=200))
    except Exception as exc:  # noqa: BLE001
        raise InvoiceError(f"Couldn't list the invoice folders: {exc}") from exc
    folders = [c for c in children if c.get("type") == "folder"]
    if not folders:
        raise InvoiceError("The invoice parent folder has no company subfolders.")

    sender = meta.get("from", "")
    sender_name = (sender.split("<")[0] or "").strip().strip('"')
    sender_domain = ""
    m = re.search(r"@([A-Za-z0-9.-]+)", sender)
    if m:
        sender_domain = m.group(1).rsplit(".", 1)[0].split(".")[-1]
    folder, candidates = match_company_folder(folders, company, sender_name, sender_domain)
    if folder is None:
        listing = "; ".join(_folder_display(f["name"]) for f in candidates[:25])
        raise InvoiceError(
            ("Several company folders match — " if candidates != folders else
             "Couldn't determine the company folder — ")
            + f"call again with company set to one of: {listing}. "
            "(If this is a NEW company, its folder AND sheet block must be "
            "created from the invoice sheet's PMI Control Panel first.)"
        )

    # Dedup: same filename already in the folder → report, don't re-upload.
    try:
        existing = await _run(lambda: gs.drive_list_folder(folder["id"], max_results=200))
    except Exception:  # noqa: BLE001 — dedup check is best-effort
        existing = []
    dup = next(
        (e for e in existing if e.get("name", "").lower() == att["filename"].lower()),
        None,
    )
    company_name = _folder_display(folder["name"])
    amount = parse_amount(f"{meta.get('subject', '')}\n{meta.get('body', '')}")
    if dup is not None:
        return {
            "status": "duplicate",
            "company": company_name,
            "folder_name": folder["name"],
            "filename": att["filename"],
            "existing_url": dup.get("url", ""),
            "amount": amount,
        }

    uploaded = await _run(
        lambda: gs.drive_upload_bytes(
            att["data"], att["filename"], att.get("mime_type") or None, folder["id"]
        )
    )
    return {
        "status": "filed",
        "company": company_name,
        "folder_name": folder["name"],
        "filename": att["filename"],
        "file_id": uploaded.get("id", ""),
        "url": uploaded.get("url", ""),
        "amount": amount,
        "subject": meta.get("subject", ""),
    }
