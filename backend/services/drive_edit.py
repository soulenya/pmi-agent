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
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.drive_grant import DriveEditGrant

logger = logging.getLogger(__name__)

DOC_MIME = "application/vnd.google-apps.document"
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
SLIDES_MIME = "application/vnd.google-apps.presentation"

# Anything else is edited by overwriting bytes, which only makes sense for text.
_TEXT_MIME_PREFIXES = ("text/",)
_TEXT_MIMES = {"application/json", "application/xml", "application/x-yaml"}

# Office formats Drive can turn into a native Google file. Editable only after
# conversion — their bytes are a zip archive, not text.
_CONVERTIBLE_MIMES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/msword": "Word",
    "application/rtf": "rich text",
    "text/rtf": "rich text",
    "application/vnd.oasis.opendocument.text": "OpenDocument text",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/vnd.ms-excel": "Excel",
    "application/vnd.oasis.opendocument.spreadsheet": "OpenDocument spreadsheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
    "application/vnd.ms-powerpoint": "PowerPoint",
    "application/vnd.oasis.opendocument.presentation": "OpenDocument presentation",
}


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


def _existing_classification(geometry: dict, theme) -> str:
    """The mark already used on this deck, so a new slide carries the same one.

    Read rather than asked: the deck's own slides are the authority, and a new
    slide that disagrees with its neighbours is worse than one with no mark.
    """
    known = {v for v in theme.classifications.values() if v}
    for page in geometry.get("slides") or []:
        for el in page.get("elements") or []:
            text = (el.get("text") or "").strip()
            if text in known:
                return text
    return ""


async def _add_slide(
    db: AsyncSession,
    file_id: str,
    *,
    slide: dict | None,
    position: int | None,
    run,
) -> str:
    """Build one archetype slide and insert it into an existing deck."""
    from services import google_service as gs
    from services.decks.archetypes import BY_NAME
    from services.decks.drive_theme import get_deck_theme
    from services.decks.slides_renderer import PAGE_TOKEN, record, to_requests

    if not isinstance(slide, dict) or not slide:
        raise DriveEditError(
            "add_slide needs a 'slide' object: an archetype plus its fields, the "
            "same shape create_deck takes. Call list_deck_archetypes to see them."
        )
    archetype = str(slide.get("archetype", "")).strip()
    if not archetype:
        raise DriveEditError(
            "The slide needs an 'archetype'. Call list_deck_archetypes for the "
            "fourteen layouts and the fields each one accepts."
        )
    if archetype not in BY_NAME:
        raise DriveEditError(
            f'"{archetype}" is not a layout. Available: {", ".join(sorted(BY_NAME))}.'
        )

    theme, _ = await get_deck_theme(db)
    geometry = await run(lambda: gs.slides_page_geometry(file_id))
    total = len(geometry.get("slides") or [])
    index = total if position is None else max(0, min(int(position) - 1, total))

    mark = _existing_classification(geometry, theme)
    # A cover in first place carries no page number, matching build_pptx.
    page_no = None if index == 0 and archetype == "cover" else index + 1
    try:
        ops = record(
            archetype, slide, theme,
            page_no=page_no, classification=mark,
        )
    except Exception as exc:  # noqa: BLE001 — a bad field set must read clearly
        raise DriveEditError(
            f"That slide could not be laid out: {exc}. Check the archetype's "
            "fields with list_deck_archetypes."
        ) from exc

    requests = to_requests(ops, PAGE_TOKEN, f"lg{uuid.uuid4().hex[:8]}_")
    page_id = await run(lambda: gs.slides_add_slide(file_id, requests, index=index))
    await run(lambda: gs.slides_set_background(file_id, page_id, theme.palette.background))

    renumbered = await _renumber_pages(file_id, theme, run)

    where = f"at position {index + 1} of {total + 1}"
    marked = f', marked "{mark}"' if mark else " (this deck carries no classification mark)"
    tail = f"; renumbered {renumbered} page number(s)" if renumbered else ""
    return f"added a {archetype} slide {where} (slide id {page_id}){marked}{tail}"


_PAGE_NO_RE = re.compile(r"^\d{1,3}$")


async def _renumber_pages(file_id: str, theme, run) -> int:
    """Rewrite the page-number marks so they match the new slide order.

    Inserting or deleting a slide otherwise leaves every later number stale.
    Only shapes that sit where the theme puts the page number AND contain
    nothing but digits are touched, so body text is never rewritten.
    """
    from services import google_service as gs

    c = theme.chrome
    geometry = await run(lambda: gs.slides_page_geometry(file_id))
    fixed = 0
    for page in geometry.get("slides") or []:
        want = str(page["index"]).zfill(2)
        for el in page.get("elements") or []:
            text = (el.get("text") or "").strip()
            if not _PAGE_NO_RE.match(text) or text == want or "left" not in el:
                continue
            at_corner = (
                abs(el["left"] - c.page_no_l) <= 0.35
                and abs(el["top"] - c.page_no_t) <= 0.35
            )
            if not at_corner:
                continue
            try:
                await run(lambda oid=el["object_id"]: gs.slides_set_shape_text(
                    file_id, oid, want
                ))
                fixed += 1
            except Exception:  # noqa: BLE001 — a stale number must not fail the edit
                logger.exception("Could not renumber page mark %s", el.get("object_id"))
    return fixed


async def _add_slide_text_box(
    db: AsyncSession,
    file_id: str,
    slide_id: str,
    text: str,
    *,
    role: str,
    box: dict | None,
    run,
) -> str:
    """Create a text box styled by the deck theme, refusing to cover anything."""
    from services import google_service as gs
    from services.decks.drive_theme import get_deck_theme
    from services.decks.slide_edit import (
        SlideEditError,
        check_placement,
        resolve_role,
        suggest_footnote_box,
    )

    if not slide_id:
        raise DriveEditError(
            "add_text_box needs the SLIDE's object id in cell_range — read_deck "
            "returns one per slide (not a shape id)."
        )
    if not text.strip():
        raise DriveEditError("add_text_box needs the text to put in the box.")

    theme, _ = await get_deck_theme(db)
    try:
        style = resolve_role(theme, role or "body")
    except SlideEditError as exc:
        raise DriveEditError(str(exc)) from exc

    geometry = await run(lambda: gs.slides_page_geometry(file_id))
    page = next(
        (s for s in geometry["slides"] if s["object_id"] == slide_id), None
    )
    if page is None:
        ids = ", ".join(s["object_id"] for s in geometry["slides"][:12])
        raise DriveEditError(
            f'No slide "{slide_id}" in this deck. Slide ids are: {ids}.'
        )

    canvas_w, canvas_h = geometry["width_in"], geometry["height_in"]
    if box is None:
        if (role or "").strip().lower() != "footnote":
            raise DriveEditError(
                "add_text_box needs a box: left, top, width and height in inches. "
                "Read the deck first — read_deck reports each shape's position, so "
                "you can find a clear area rather than guessing."
            )
        # Footnotes have one obvious home, so placing them is not a guess.
        box = suggest_footnote_box(page["elements"], canvas_w, canvas_h, theme)

    try:
        placement = {k: float(box[k]) for k in ("left", "top", "width", "height")}
    except (KeyError, TypeError, ValueError) as exc:
        raise DriveEditError(
            "box must give left, top, width and height as numbers of inches."
        ) from exc

    try:
        check_placement(placement, page["elements"], canvas_w, canvas_h)
    except SlideEditError as exc:
        raise DriveEditError(str(exc)) from exc

    body = text.upper() if style.pop("upper", False) else text
    object_id = await run(lambda: gs.slides_add_textbox(
        file_id, slide_id, body,
        left_in=placement["left"], top_in=placement["top"],
        width_in=placement["width"], height_in=placement["height"],
        **style,
    ))
    return (
        f"added a {role or 'body'} text box (id {object_id}) at "
        f"{placement['left']:.2f}in, {placement['top']:.2f}in — "
        f"{style['font']} {style['size_pt']:g}pt in the deck's own style"
    )


async def convert_to_google(
    db: AsyncSession, user_id: uuid.UUID, file_id: str
) -> str:
    """Make an editable Google copy of a Word/Excel/PowerPoint file on Drive.

    The source is left alone — Drive conversion always produces a new file with
    a new id — and the user's edit grant is carried onto the copy so they are
    not asked to approve the same document twice.
    """
    from services import google_service as gs

    meta = await _meta(file_id)
    mime = meta.get("mimeType", "")
    name = meta.get("name") or file_id
    if mime in (DOC_MIME, SHEET_MIME, SLIDES_MIME):
        raise DriveEditError(
            f'"{name}" is already a native Google file and can be edited directly — '
            "no conversion is needed."
        )
    if mime not in _CONVERTIBLE_MIMES:
        raise DriveEditError(
            f'"{name}" is a {mime or "binary"} file, which Drive cannot convert into a '
            "Google document. Word, Excel, PowerPoint, RTF and OpenDocument files can "
            "be converted; PDFs and images cannot."
        )

    missing = write_access_missing()
    if missing:
        raise DriveEditError(missing)

    loop = asyncio.get_event_loop()
    try:
        copied = await loop.run_in_executor(
            None, lambda: gs.drive_convert_to_google(file_id)
        )
    except Exception as exc:  # noqa: BLE001 — surfaced to the user, not swallowed
        logger.exception("Drive conversion failed for %s", file_id)
        raise DriveEditError(f'Could not convert "{name}": {exc}') from exc
    if not copied.get("id"):
        raise DriveEditError(f'Drive would not convert "{name}".')

    inherited = await get_active_grant(db, user_id, file_id) is not None
    if inherited:
        await grant(
            db,
            user_id,
            copied["id"],
            file_name=copied.get("name", ""),
            mime_type=copied.get("mime_type", ""),
            file_url=copied.get("url", ""),
        )

    kind = {DOC_MIME: "Google Doc", SHEET_MIME: "Google Sheet", SLIDES_MIME: "Google Slides deck"}.get(
        copied.get("mime_type", ""), "Google file"
    )
    permission = (
        "Your edit permission carried across, so it is ready to edit now."
        if inherited
        else "Ask for edit permission on this NEW id before changing it."
    )
    return (
        f'Converted "{copied.get("source_name", name)}" into a {kind}.\n'
        f'New file: "{copied.get("name", "")}"\n'
        f'New file_id: {copied["id"]}\n'
        f'Link: {copied.get("url", "")}\n'
        f"{permission} The original {_CONVERTIBLE_MIMES.get(mime, '')} file is unchanged "
        "and keeps its own link — tell the user the copy is a separate document, and "
        "use the NEW file_id from now on."
    )


def _quote(text: str, limit: int = 60) -> str:
    """A single-line, length-capped rendering of text for an error message."""
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


async def _no_change_report(
    file_id: str, name: str, find: str, replace: str, run
) -> str:
    """Explain a zero-match replace, distinguishing 'already done' from 'not there'.

    A model that is told only "not found" tries again with a different guess;
    told the replacement is already in place, it stops.
    """
    from services import google_service as gs

    try:
        body = await run(lambda: gs.docs_plain_text(file_id))
    except Exception:  # noqa: BLE001 — the diagnosis is optional, the refusal is not
        body = ""
    if replace and body and replace in body:
        return (
            f'No change needed: "{_quote(find)}" is not in "{name}", but '
            f'"{_quote(replace)}" already is — this edit has already been applied. '
            "Do not repeat it. Re-read the document if you are unsure of its current state."
        )
    return (
        f'No change: "{_quote(find)}" does not appear in "{name}". The document was '
        "not modified. Re-read it with read_drive_file and copy the target text "
        "exactly as it appears, including spacing, rather than guessing again."
    )


async def _replace_in_doc(
    file_id: str,
    name: str,
    find: str,
    replace: str,
    occurrence: int | None,
    all_occurrences: bool,
    run,
) -> str | None:
    """Replace one occurrence in a Google Doc. Returns None when nothing matched.

    Refuses an ambiguous multi-match instead of changing them all: form and
    contract templates repeat the same blank placeholder in every field, so a
    replace-everything write scatters one answer across the whole document.
    """
    from services import google_service as gs

    found = await run(lambda: gs.docs_find_occurrences(file_id, find))
    matches = found["matches"]

    if not found["indexable"]:
        # Emoji or other non-BMP text makes index maths unsafe; fall back.
        result = await run(lambda: gs.docs_replace_text(file_id, find, replace))
        n = result["occurrences"]
        if n == 0:
            return None
        return f'replaced {n} occurrence{"s" if n != 1 else ""} of "{_quote(find)}"'

    if not matches:
        return None

    if all_occurrences:
        result = await run(lambda: gs.docs_replace_text(file_id, find, replace))
        n = result["occurrences"]
        return f'replaced all {n} occurrence{"s" if n != 1 else ""} of "{_quote(find)}"'

    if len(matches) > 1 and occurrence is None:
        listing = "\n".join(
            f"  {i}. …{m['before'][-45:]}[{_quote(find, 30)}]{m['after'][:45]}…"
            for i, m in enumerate(matches[:8], start=1)
        )
        more = f"\n  (and {len(matches) - 8} more)" if len(matches) > 8 else ""
        raise DriveEditError(
            f'Nothing was changed. "{_quote(find)}" appears {len(matches)} times in '
            f'"{name}", so replacing it would write the same text into all of them — '
            "that is how a form ends up with one answer in every blank.\n"
            f"{listing}{more}\n"
            "Either pass occurrence=<number from the list above> to change exactly "
            "one, or extend 'find' with enough surrounding text to be unique (for "
            "example include the label that precedes it). Pass all_occurrences=true "
            "only when you genuinely mean every one."
        )

    index = 1 if occurrence is None else occurrence
    if index < 1 or index > len(matches):
        raise DriveEditError(
            f'Nothing was changed. occurrence={index} was requested but '
            f'"{_quote(find)}" appears {len(matches)} time(s) in "{name}".'
        )
    target = matches[index - 1]
    if not target["contiguous"]:
        raise DriveEditError(
            f'Nothing was changed. That occurrence of "{_quote(find)}" straddles a '
            "table cell or section boundary, so it cannot be replaced as one block. "
            "Target a shorter run of text that sits inside a single paragraph or cell."
        )

    await run(lambda: gs.docs_replace_range(file_id, target["start"], target["end"], replace))
    where = f" (occurrence {index} of {len(matches)})" if len(matches) > 1 else ""
    return f'replaced "{_quote(find)}" with "{_quote(replace) or "nothing"}"{where}'


async def _verify_doc_edit(file_id: str, find: str, replace: str, run) -> str:
    """Re-read the doc and show the text around the change.

    Without this the model only knows what it asked for, not what landed, so it
    reports success on a garbled document — or retries an edit that worked.
    """
    from services import google_service as gs

    try:
        body = await run(lambda: gs.docs_plain_text(file_id))
    except Exception:  # noqa: BLE001 — verification is best-effort
        return ""
    at = body.find(replace)
    if at == -1:
        return (
            "\n\nWARNING: re-reading the document does not show the new text. "
            "Read it with read_drive_file before making any further edit."
        )
    window = " ⏎ ".join(body[max(0, at - 120) : at + len(replace) + 120].splitlines())
    note = f"\n\nVerified — the document now reads:\n…{window}…"
    copies = body.count(replace)
    if copies > 1:
        note += (
            f"\n\nWARNING: that text now appears {copies} times in the document. "
            "If it should appear once, read the file and remove the duplicates "
            "before doing anything else."
        )
    if find and find in body:
        note += (
            f'\n\nNote: "{_quote(find)}" still appears elsewhere in the document. '
            "That is expected if you deliberately changed only one occurrence."
        )
    return note


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
    role: str = "",
    box: dict | None = None,
    slide: dict | None = None,
    position: int | None = None,
    occurrence: int | None = None,
    all_occurrences: bool = False,
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
                summary = await _replace_in_doc(
                    file_id, name, find, replace, occurrence, all_occurrences, _run
                )
                if summary is None:
                    return await _no_change_report(file_id, name, find, replace, _run)
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

        elif mime == SLIDES_MIME:
            if mode == "replace":
                if not find:
                    raise DriveEditError("replace needs find.")
                result = await _run(lambda: gs.slides_replace_text(file_id, find, replace))
                n = result["occurrences"]
                if n == 0:
                    return (
                        f'No change: "{find}" does not appear in "{name}". '
                        "The deck was not modified."
                    )
                summary = f"replaced {n} occurrence{'s' if n != 1 else ''} of \"{find}\""
            elif mode == "set_shape":
                if not cell_range:
                    raise DriveEditError(
                        "set_shape needs the shape's object id — read the deck first "
                        "with read_deck, which returns one per text box."
                    )
                await _run(lambda: gs.slides_set_shape_text(file_id, cell_range, text))
                summary = f"rewrote shape {cell_range} ({len(text):,} characters)"
            elif mode == "delete_slide":
                if not cell_range:
                    raise DriveEditError(
                        "delete_slide needs the slide's object id — read_deck returns one "
                        "per slide."
                    )
                await _run(lambda: gs.slides_delete_slide(file_id, cell_range))
                from services.decks.drive_theme import get_deck_theme

                theme, _ = await get_deck_theme(db)
                fixed = await _renumber_pages(file_id, theme, _run)
                summary = f"deleted slide {cell_range}" + (
                    f" and renumbered {fixed} page number(s)" if fixed else ""
                )
            elif mode == "add_text_box":
                summary = await _add_slide_text_box(
                    db, file_id, cell_range, text, role=role, box=box, run=_run
                )
            elif mode == "delete_shape":
                if not cell_range:
                    raise DriveEditError(
                        "delete_shape needs the shape's object id — read_deck returns one "
                        "per text box."
                    )
                await _run(lambda: gs.slides_delete_object(file_id, cell_range))
                summary = f"deleted shape {cell_range}"
            elif mode == "add_slide":
                summary = await _add_slide(
                    db, file_id, slide=slide, position=position, run=_run
                )
            else:
                raise DriveEditError(
                    "Google Slides support replace, set_shape, add_text_box, "
                    f'add_slide, delete_shape and delete_slide — not "{mode}".'
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

        elif mime in _CONVERTIBLE_MIMES:
            raise DriveEditError(
                f'"{name}" is a {_CONVERTIBLE_MIMES[mime]} file, not a native Google '
                "document, so its text cannot be edited in place — writing to it would "
                "corrupt the file. Call convert_drive_file on it: that makes a Google "
                "Docs copy you can edit immediately, carries your edit permission "
                "across, and leaves the original untouched. Tell the user the copy is "
                "a new file with its own link before you start changing it."
            )

        else:
            raise DriveEditError(
                f'"{name}" is a {mime or "binary"} file — Gerry can edit Google Docs, '
                "Google Sheets, Google Slides and plain-text files in place, but not "
                "this type. Uploading a replacement with upload_to_drive is the "
                "alternative."
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

    check = ""
    if mime == DOC_MIME and mode == "replace" and replace:
        check = await _verify_doc_edit(file_id, find, replace, _run)

    return (
        f'Edited "{name}" — {summary}. The change is live in Google Drive now; '
        "File → Version history there restores the previous version." + check
    )
