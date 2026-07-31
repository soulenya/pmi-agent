"""Gerry's write access to Google Drive — granted one file at a time.

Two responsibilities, kept together because neither is safe without the other:

* grant bookkeeping (``get_active_grant`` / ``grant`` / ``revoke`` / ``list_grants``)
* ``apply_edit``, the ONLY path that modifies a Drive file on the agent's
  behalf — it refuses to run without an active grant for that exact file id.

Grants are created by the signed-in user (permission prompt or Settings), never
by the agent, and cover exactly one file: nothing here ever widens to a folder.
Every edit lands in Drive's own version history, which is the undo path.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.drive_grant import DriveEditGrant

logger = logging.getLogger(__name__)

DOC_MIME = "application/vnd.google-apps.document"
SHEET_MIME = "application/vnd.google-apps.spreadsheet"

# Anything else is edited by overwriting bytes, which only makes sense for text.
_TEXT_MIME_PREFIXES = ("text/",)
_TEXT_MIMES = {"application/json", "application/xml", "application/x-yaml"}


class DriveEditError(Exception):
    """A refusal or failure the caller should report verbatim to the user."""


RECONNECT_MESSAGE = (
    "The Google connection is read-only — it was authorised before Little Gerry could "
    "edit files. Reconnect Google Workspace in Settings and tick every permission box; "
    "until then documents can be read but not changed."
)

# Full Drive write. Covers every file the account can edit.
_FULL_WRITE = "https://www.googleapis.com/auth/drive"
# Per-file write. Only covers files this app created or the user opened through it,
# which is still enough to edit most of what Gerry produced — so it counts as write
# access here and a file outside that set surfaces as a 403 with a clear explanation.
_FILE_WRITE = "https://www.googleapis.com/auth/drive.file"


def write_access_missing() -> str | None:
    """RECONNECT_MESSAGE when the stored token can't write to Drive at all, else None."""
    from services.google_service import granted_scopes

    scopes = granted_scopes()
    if not scopes:
        return None  # not connected at all — a different error already covers it
    if _FULL_WRITE in scopes or _FILE_WRITE in scopes:
        return None
    return RECONNECT_MESSAGE


def has_full_drive_write() -> bool:
    """True when the token can edit any file, not just ones Little Gerry created."""
    from services.google_service import granted_scopes

    return _FULL_WRITE in granted_scopes()


# ── grants ────────────────────────────────────────────────────────────────

async def get_active_grant(
    db: AsyncSession, user_id: uuid.UUID, file_id: str
) -> DriveEditGrant | None:
    return (
        await db.execute(
            select(DriveEditGrant).where(
                DriveEditGrant.user_id == user_id,
                DriveEditGrant.file_id == file_id,
                DriveEditGrant.status == "active",
            )
        )
    ).scalar_one_or_none()


async def list_grants(
    db: AsyncSession, user_id: uuid.UUID, *, active_only: bool = True
) -> list[DriveEditGrant]:
    stmt = select(DriveEditGrant).where(DriveEditGrant.user_id == user_id)
    if active_only:
        stmt = stmt.where(DriveEditGrant.status == "active")
    return list((await db.execute(stmt.order_by(DriveEditGrant.granted_at.desc()))).scalars())


async def grant(
    db: AsyncSession,
    user_id: uuid.UUID,
    file_id: str,
    *,
    file_name: str = "",
    mime_type: str = "",
    file_url: str = "",
) -> DriveEditGrant:
    """Grant (or re-activate) write access to one file. User action only."""
    row = (
        await db.execute(
            select(DriveEditGrant).where(
                DriveEditGrant.user_id == user_id, DriveEditGrant.file_id == file_id
            )
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None:
        row = DriveEditGrant(
            user_id=user_id,
            file_id=file_id,
            file_name=file_name[:500],
            mime_type=mime_type[:255],
            file_url=file_url[:1000],
            status="active",
            granted_at=now,
        )
        db.add(row)
    else:
        row.status = "active"
        row.granted_at = now
        row.revoked_at = None
        if file_name:
            row.file_name = file_name[:500]
        if mime_type:
            row.mime_type = mime_type[:255]
        if file_url:
            row.file_url = file_url[:1000]
    await db.flush()
    return row


async def revoke(db: AsyncSession, user_id: uuid.UUID, file_id: str) -> bool:
    row = await get_active_grant(db, user_id, file_id)
    if row is None:
        return False
    row.status = "revoked"
    row.revoked_at = datetime.now(timezone.utc)
    await db.flush()
    return True


# ── editing ───────────────────────────────────────────────────────────────

def _is_text_file(mime: str) -> bool:
    return mime.startswith(_TEXT_MIME_PREFIXES) or mime in _TEXT_MIMES


async def _meta(file_id: str) -> dict:
    from services.google_service import drive_get_metadata

    meta = await asyncio.get_event_loop().run_in_executor(
        None, lambda: drive_get_metadata(file_id)
    )
    if meta is None:
        raise DriveEditError(
            "That Drive file could not be opened — it may have been deleted, or the "
            "Google account may not have access to it."
        )
    if meta.get("trashed"):
        raise DriveEditError(f"\"{meta.get('name', file_id)}\" is in the Drive trash.")
    return meta


async def describe_file(file_id: str) -> dict:
    """Metadata for a permission prompt. Raises DriveEditError if unreachable."""
    return await _meta(file_id)


async def apply_edit(
    db: AsyncSession,
    user_id: uuid.UUID,
    file_id: str,
    mode: str,
    *,
    text: str = "",
    find: str = "",
    replace: str = "",
    cell_range: str = "",
    values: list[list] | None = None,
) -> str:
    """Perform one edit on a granted Drive file and return a summary line.

    Raises ``DriveEditError`` when there is no active grant, when the mode does
    not suit the file type, or when Google rejects the write.
    """
    from googleapiclient.errors import HttpError

    from services import google_service as gs

    row = await get_active_grant(db, user_id, file_id)
    if row is None:
        raise DriveEditError(
            "No edit permission for that file. Ask the user for it with "
            "request_drive_edit_permission — permission is per file and they grant "
            "it by clicking Allow."
        )

    missing = write_access_missing()
    if missing:
        raise DriveEditError(missing)

    meta = await _meta(file_id)
    mime = meta.get("mimeType", "")
    name = meta.get("name") or row.file_name or file_id
    loop = asyncio.get_event_loop()

    def _run(fn):
        return loop.run_in_executor(None, fn)

    try:
        if mime == DOC_MIME:
            if mode == "append":
                if not text:
                    raise DriveEditError("append needs text.")
                body = text if text.startswith("\n") else "\n" + text
                await _run(lambda: gs.docs_append_text(file_id, body))
                summary = f"appended {len(text):,} characters"
            elif mode == "replace":
                if not find:
                    raise DriveEditError("replace needs find.")
                result = await _run(lambda: gs.docs_replace_text(file_id, find, replace))
                n = result["occurrences"]
                if n == 0:
                    return (
                        f'No change: "{find}" does not appear in "{name}". '
                        "The document was not modified."
                    )
                summary = f"replaced {n} occurrence{'s' if n != 1 else ''} of \"{find}\""
            elif mode == "overwrite":
                if not text:
                    raise DriveEditError("overwrite needs the full replacement text.")
                await _run(lambda: gs.docs_overwrite_text(file_id, text))
                summary = f"rewrote the whole document ({len(text):,} characters)"
            else:
                raise DriveEditError(
                    f'Google Docs support append, replace and overwrite — not "{mode}".'
                )

        elif mime == SHEET_MIME:
            if mode == "set_cells":
                if not cell_range or not values:
                    raise DriveEditError("set_cells needs cell_range and values.")
                await _run(lambda: gs.sheets_update_range(file_id, cell_range, values))
                summary = f"updated {cell_range} ({len(values)} row(s))"
            elif mode == "append":
                if not values:
                    raise DriveEditError("appending to a sheet needs values (one row).")
                target = cell_range or "A:Z"
                first = values[0] if isinstance(values[0], list) else list(values)
                await _run(lambda: gs.sheets_append_row(file_id, target, first))
                summary = f"appended a row to {target}"
            else:
                raise DriveEditError(
                    f'Google Sheets support set_cells and append — not "{mode}".'
                )

        elif _is_text_file(mime):
            if mode == "overwrite":
                if not text:
                    raise DriveEditError("overwrite needs the full replacement text.")
                new_text = text
            elif mode in ("append", "replace"):
                current = await _run(lambda: gs.drive_get_content(file_id, max_chars=None))
                existing = current.get("content", "")
                if mode == "append":
                    if not text:
                        raise DriveEditError("append needs text.")
                    new_text = existing + ("" if existing.endswith("\n") else "\n") + text
                else:
                    if not find:
                        raise DriveEditError("replace needs find.")
                    if find not in existing:
                        return (
                            f'No change: "{find}" does not appear in "{name}". '
                            "The file was not modified."
                        )
                    new_text = existing.replace(find, replace)
            else:
                raise DriveEditError(f'Text files support append, replace and overwrite — not "{mode}".')
            await _run(
                lambda: gs.drive_update_bytes(file_id, new_text.encode("utf-8"), mime or "text/plain")
            )
            summary = f"saved {len(new_text):,} characters"

        else:
            raise DriveEditError(
                f'"{name}" is a {mime or "binary"} file — Gerry can edit Google Docs, '
                "Google Sheets and plain-text files in place, but not this type. "
                "Uploading a replacement with upload_to_drive is the alternative."
            )
    except HttpError as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        if status == 403:
            extra = (
                ""
                if has_full_drive_write()
                else (
                    " Little Gerry's Google connection can only write to files it created "
                    "itself; to let it edit anything else in the Drive, reconnect Google "
                    "Workspace in Settings and tick every permission box."
                )
            )
            raise DriveEditError(
                f'Google refused the edit to "{name}" (403) — the account may only have '
                f"view access to that file.{extra}"
            ) from exc
        raise DriveEditError(f'Google rejected the edit to "{name}": {exc}') from exc
    except DriveEditError:
        raise
    except Exception as exc:  # noqa: BLE001 — surfaced to the user, not swallowed
        logger.exception("Drive edit failed for %s", file_id)
        raise DriveEditError(f'Could not edit "{name}": {exc}') from exc

    row.edit_count += 1
    row.last_used_at = datetime.now(timezone.utc)
    if meta.get("name"):
        row.file_name = meta["name"][:500]
    await db.flush()

    return (
        f'Edited "{name}" — {summary}. The change is live in Google Drive now; '
        "File → Version history there restores the previous version."
    )
