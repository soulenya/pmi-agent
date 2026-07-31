"""Drive access policy — restricted QMS folder + draft files.

Standing rule (Morgan, 2026-07-22): Gerry must not read or reference anything
inside the QMS folder (or any of its subfolders), or any file whose name
carries "draft" in any variation (_Draft, Drafts, DRAFT…), unless the user
EXPLICITLY asked for it — and then Gerry must confirm first, naming the
folder it will access and the file it will read.

Enforced HARD here (tool layer), not just in the system prompt: the Drive
read/browse tools call these checks and refuse restricted targets unless the
call carries confirm_restricted=true, which the model may only send after
telling the user exactly what it will open and getting their go-ahead.

An active per-file Drive edit grant also satisfies the rule for that one file:
the user created it by clicking Allow on a prompt naming the file, which is the
explicit request the rule carves out, recorded and revocable. It exempts only
that file id — never its folder or its neighbours.

Ancestry walks are memoized per process; the restricted-folder set can be
extended via the SystemSetting "drive_policy.restricted_folder_ids".
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# The QMS folder — everything under it is restricted.
QMS_FOLDER_ID = "1c5mGaeldOIUXZyGVwUoTOsUTtGJ2LMp_"
SETTING_RESTRICTED_IDS = "drive_policy.restricted_folder_ids"

# "draft" in any variation, anywhere in the name (deliberately generous —
# _Draft, Drafts, DRAFT v2, report-draft.docx all match).
_DRAFT_RE = re.compile(r"draft", re.IGNORECASE)

# file_id -> (parent_id | None, name) — metadata cache for ancestry walks.
_ancestry_cache: dict[str, tuple[str | None, str]] = {}

CONFIRM_PROTOCOL = (
    "If the user EXPLICITLY asked for this, first tell them exactly which "
    "folder you will access and which file you will read, get their "
    "confirmation, then call again with confirm_restricted=true. Never set "
    "confirm_restricted without doing that."
)


def is_draft_name(name: str) -> bool:
    return bool(_DRAFT_RE.search(name or ""))


async def _restricted_ids(db) -> set[str]:
    ids = {QMS_FOLDER_ID}
    if db is None:
        return ids
    try:
        from sqlalchemy import select

        from models.db.settings import SystemSetting

        row = (
            await db.execute(
                select(SystemSetting).where(SystemSetting.key == SETTING_RESTRICTED_IDS)
            )
        ).scalar_one_or_none()
        if row is not None and isinstance(row.value, list):
            ids.update(str(v) for v in row.value if v)
    except Exception:  # noqa: BLE001 — the built-in default always applies
        logger.exception("Failed to read restricted-folder setting")
    return ids


async def _granted_ids(db, user_id) -> set[str]:
    """File ids the user has explicitly authorised Gerry to edit."""
    if db is None or user_id is None:
        return set()
    try:
        from services.drive_edit import list_grants

        return {g.file_id for g in await list_grants(db, user_id)}
    except Exception:  # noqa: BLE001 — a lookup failure must not widen access
        logger.exception("Failed to read Drive edit grants")
        return set()


def _lookup(file_id: str) -> tuple[str | None, str]:
    """(parent_id, name) for a Drive item, cached. ("", "") on failure."""
    if file_id in _ancestry_cache:
        return _ancestry_cache[file_id]
    try:
        from services.google_service import _build

        svc = _build("drive", "v3")
        meta = svc.files().get(
            fileId=file_id, fields="id,name,parents", supportsAllDrives=True
        ).execute()
        parents = meta.get("parents") or []
        entry = (parents[0] if parents else None, meta.get("name", ""))
    except Exception:  # noqa: BLE001 — unknown ancestry is treated as unrestricted
        entry = (None, "")
    _ancestry_cache[file_id] = entry
    return entry


def _walk_ancestry(file_id: str, restricted: set[str], max_depth: int = 15) -> str | None:
    """Name of the restricted ancestor folder (or the item itself), or None."""
    current: str | None = file_id
    for _ in range(max_depth):
        if current is None:
            return None
        if current in restricted:
            return _lookup(current)[1] or "the restricted QMS folder"
        parent, _name = _lookup(current)
        current = parent
    return None


async def check_drive_target(
    db, file_id: str, confirm: bool, *, name_hint: str = "", user_id=None
) -> str | None:
    """Refusal message for a restricted Drive file/folder, or None when allowed.

    ``confirm=True`` (the explicit-request escape hatch) always allows access —
    the model is contractually required to have named the folder/file to the
    user first. An active edit grant for this exact file allows it too.
    """
    if confirm:
        return None
    try:
        if file_id in await _granted_ids(db, user_id):
            return None
        restricted = await _restricted_ids(db)
        hit = _walk_ancestry(file_id, restricted)
        name = name_hint or _lookup(file_id)[1]
        if hit:
            return (
                f'BLOCKED by standing policy: "{name or file_id}" is inside the '
                f'restricted QMS area ("{hit}"). Do not reference its contents. '
                + CONFIRM_PROTOCOL
            )
        if is_draft_name(name):
            return (
                f'BLOCKED by standing policy: "{name}" is a DRAFT file — drafts '
                "are not to be referenced. " + CONFIRM_PROTOCOL
            )
    except Exception:  # noqa: BLE001 — policy failure must not fabricate a block
        logger.exception("Drive policy check failed for %s", file_id)
    return None


async def filter_drive_results(
    db, items: list[dict], confirm: bool, *, user_id=None
) -> tuple[list[dict], int]:
    """Drop restricted items from search/list results. Returns (kept, excluded).

    Items need ``id`` and ``name``. With ``confirm=True`` nothing is dropped.
    """
    if confirm or not items:
        return items, 0
    try:
        restricted = await _restricted_ids(db)
    except Exception:  # noqa: BLE001
        return items, 0
    granted = await _granted_ids(db, user_id)
    kept: list[dict] = []
    excluded = 0
    for it in items:
        try:
            if it.get("id", "") in granted:
                kept.append(it)
                continue
            if is_draft_name(it.get("name", "")) or _walk_ancestry(it.get("id", ""), restricted):
                excluded += 1
                continue
        except Exception:  # noqa: BLE001 — never drop an item on a check error
            pass
        kept.append(it)
    return kept, excluded


EXCLUDED_NOTE = (
    "\n\n({n} result(s) were withheld by standing policy — they are in the "
    "restricted QMS area or are draft files. Only access them if the user "
    "explicitly asks: confirm first, naming the folder and file, then retry "
    "with confirm_restricted=true.)"
)
