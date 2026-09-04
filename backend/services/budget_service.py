"""Budget service — Drive-backed personal budgets, two surfaces, one ledger.

The Google Sheet is the system of record. This service creates standardized
budget sheets, parses them into the DB mirror, and performs targeted writes
(row appends / single-row updates / single-row deletes) that always re-read
the sheet first — so edits made directly in Google Sheets are never
clobbered, and edits made here appear in Sheets immediately.

Every ledger row carries a status in column G, because money that has moved
and money that is merely promised are different facts and adding them
together tells you nothing. Four plain words, so the sheet still reads like a
sheet to a person who opens it in Drive:

    Spent      money out, already gone
    Allocated  money out, committed but not yet paid
    Collected  money in, already received
    Expected   money in, invoiced or forecast but not yet collected

A blank status means Spent, which is what every row written before this
existed meant, so older sheets keep their totals.

NOT an official budget center: a personal financial-management aid.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.budget import Budget

logger = logging.getLogger(__name__)

# Company budgets folder (Morgan, 2026-07-22): EVERY user's budget sheets are
# created here — baked in so all budgets live in one known place on Drive.
# The SystemSetting below still wins when set (relocation without a release).
BUDGET_FOLDER_ID = "1k-tBw0UomODw-nwJjjkNteHaQltuNs2D"
SETTING_FOLDER_ID = "budgets.folder_id_override"
LEDGER_COLUMNS = ("date", "description", "category", "amount", "source", "note", "status")
LEDGER_WIDTH = len(LEDGER_COLUMNS)
LEDGER_RANGE = "Ledger!A2:G2000"
LEDGER_APPEND_RANGE = "Ledger!A:G"

STATUS_SPENT = "Spent"
STATUS_ALLOCATED = "Allocated"
STATUS_COLLECTED = "Collected"
STATUS_EXPECTED = "Expected"
ENTRY_STATUSES = (STATUS_SPENT, STATUS_ALLOCATED, STATUS_COLLECTED, STATUS_EXPECTED)

#: Money out of the budget. The rest is money in.
OUTGOING_STATUSES = (STATUS_SPENT, STATUS_ALLOCATED)
#: Not yet real. The rest has actually moved.
PLANNED_STATUSES = (STATUS_ALLOCATED, STATUS_EXPECTED)

# What a person might reasonably type into column G by hand. Anything we do
# not recognise falls back to Spent: that is how every row behaved before the
# column existed, so an unfamiliar word can never quietly remove money from
# the total.
_STATUS_SYNONYMS = {
    "": STATUS_SPENT,
    "spent": STATUS_SPENT,
    "spend": STATUS_SPENT,
    "actual": STATUS_SPENT,
    "paid": STATUS_SPENT,
    "allocated": STATUS_ALLOCATED,
    "allocation": STATUS_ALLOCATED,
    "committed": STATUS_ALLOCATED,
    "commitment": STATUS_ALLOCATED,
    "reserved": STATUS_ALLOCATED,
    "planned": STATUS_ALLOCATED,
    "unpaid": STATUS_ALLOCATED,
    "owed": STATUS_ALLOCATED,
    "collected": STATUS_COLLECTED,
    "received": STATUS_COLLECTED,
    "income": STATUS_COLLECTED,
    "expected": STATUS_EXPECTED,
    "projected": STATUS_EXPECTED,
    "forecast": STATUS_EXPECTED,
    "invoiced": STATUS_EXPECTED,
    "uncollected": STATUS_EXPECTED,
}


def normalize_status(raw) -> str:
    """Map whatever is in column G onto one of the four statuses."""
    return _STATUS_SYNONYMS.get(str(raw or "").strip().lower(), STATUS_SPENT)


def summarize_entries(entries: list[dict], allotment: float | None) -> dict:
    """Total a parsed ledger up into the figures the app shows.

    Kept apart from the Drive round-trip so the arithmetic can be checked on
    its own — it is the part people will argue with.
    """
    by_status: dict[str, float] = {s: 0.0 for s in ENTRY_STATUSES}
    by_category: dict[str, float] = {}
    for e in entries:
        if e.get("amount") is None:
            continue
        status = e.get("status") or STATUS_SPENT
        by_status[status] = round(by_status[status] + e["amount"], 2)
        if status not in OUTGOING_STATUSES:
            continue  # category caps are about money leaving, not arriving
        key = e.get("category") or "(uncategorized)"
        by_category[key] = round(by_category.get(key, 0) + e["amount"], 2)

    spent = by_status[STATUS_SPENT]
    allocated = by_status[STATUS_ALLOCATED]
    return {
        # total_spent keeps its name and its meaning: money actually gone.
        "total_spent": round(spent, 2),
        "total_allocated": round(allocated, 2),
        "total_collected": round(by_status[STATUS_COLLECTED], 2),
        "total_expected": round(by_status[STATUS_EXPECTED], 2),
        # What the budget owes the world whether or not the money has left.
        "committed": round(spent + allocated, 2),
        "allotment": allotment,
        # Allocated money is gone as far as planning is concerned, so it comes
        # off what is left. What remains is what is still free to promise.
        "remaining": round(allotment - spent - allocated, 2) if allotment is not None else None,
        "by_category": by_category,
        "by_status": {k: round(v, 2) for k, v in by_status.items()},
        "entry_count": len(entries),
    }


class BudgetError(Exception):
    """User-facing budget failure."""


def _require_google() -> None:
    from services.google_service import get_credentials

    if not get_credentials():
        raise BudgetError(
            "Google Workspace is not connected — connect it in Settings to use budgets."
        )


async def _run(fn):
    return await asyncio.get_event_loop().run_in_executor(None, fn)


async def _get_budget_folder_id(db: AsyncSession) -> str:
    from models.db.settings import SystemSetting
    from services import google_service as gs

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == SETTING_FOLDER_ID))
    ).scalar_one_or_none()
    if row is not None and row.value:
        return str(row.value)
    meta = await _run(lambda: gs.drive_get_metadata(BUDGET_FOLDER_ID))
    if meta is None or meta.get("trashed"):
        raise BudgetError(
            "The company budgets folder on Drive isn't reachable from this "
            "Google account — ask Morgan to share the 'Little Gerry Budgets' "
            "folder with you (edit access), then try again."
        )
    return BUDGET_FOLDER_ID


# ── creation / linking ────────────────────────────────────────────────────


async def create_budget(
    db: AsyncSession,
    user_id: uuid.UUID,
    title: str,
    allotment: float | None = None,
    currency: str = "USD",
    categories: list[str] | None = None,
) -> Budget:
    from services import google_service as gs

    _require_google()
    title = title.strip()[:200]
    if not title:
        raise BudgetError("Budget title is required.")
    folder_id = await _get_budget_folder_id(db)
    created = await _run(
        lambda: gs.sheets_create_budget_spreadsheet(
            title, allotment, currency, [c.strip() for c in (categories or []) if c.strip()], folder_id
        )
    )
    budget = Budget(
        user_id=user_id,
        title=title,
        drive_file_id=created["id"],
        drive_url=created.get("url", ""),
        allotment=allotment,
        currency=currency,
    )
    db.add(budget)
    await db.flush()
    await refresh_budget(db, budget, force=True)
    return budget


async def link_external_budget(db: AsyncSession, user_id: uuid.UUID, file_id: str) -> Budget:
    """Link a sheet Gerry didn't create — READ-ONLY (drive.file boundary).

    Accepts a bare spreadsheet ID or any pasted Google Sheets URL.
    """
    from services import google_service as gs
    from services.live_document import extract_drive_file_id

    _require_google()
    file_id = extract_drive_file_id(file_id)
    if not file_id:
        raise BudgetError("Paste the spreadsheet's link (or its ID) to link it.")
    try:
        meta = await _run(lambda: gs.sheets_get_metadata(file_id))
    except Exception as exc:  # noqa: BLE001
        text = str(exc)
        if "404" in text:
            raise BudgetError(
                "Google couldn't find that spreadsheet. Check the link, and make "
                "sure the sheet is shared with the Google account connected in "
                "Settings (a teammate must share it with you first)."
            ) from exc
        if "403" in text:
            raise BudgetError(
                "Google refused access to that spreadsheet — ask its owner to "
                "share it with the Google account connected in Settings."
            ) from exc
        raise BudgetError(f"Couldn't read that spreadsheet: {text[:200]}") from exc
    budget = Budget(
        user_id=user_id,
        title=(meta.get("title") or "Linked budget")[:200],
        drive_file_id=file_id,
        drive_url=f"https://docs.google.com/spreadsheets/d/{file_id}",
        external_readonly=True,
    )
    db.add(budget)
    await db.flush()
    await refresh_budget(db, budget, force=True)
    return budget


# ── parsing / refresh ─────────────────────────────────────────────────────


def _parse_amount(raw) -> float | None:
    s = str(raw or "").strip().replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


async def _ensure_status_header(budget: Budget) -> None:
    """Name column G in sheets created before the status column existed.

    Rows written there would otherwise sit under a blank heading, which is a
    good way to have someone delete them. Writing the label bumps the file's
    modified time once; the next refresh sees a filled cell and stops.
    """
    if budget.external_readonly:
        return
    from services import google_service as gs

    def _fix() -> None:
        header = gs.sheets_read(budget.drive_file_id, "Ledger!A1:G1").get("rows", [])
        row = header[0] if header else []
        if len(row) >= LEDGER_WIDTH and str(row[6]).strip():
            return
        if not any(str(c).strip() for c in row):
            return  # not a Gerry-shaped ledger; leave it alone
        gs.sheets_update_range(budget.drive_file_id, "Ledger!G1", [["Status"]])

    try:
        await _run(_fix)
    except Exception:  # noqa: BLE001 — a missing label must never fail a read
        logger.info("Could not label the status column on budget %s", budget.id)


async def refresh_budget(db: AsyncSession, budget: Budget, force: bool = False) -> Budget:
    """Re-read the sheet into the mirror when Drive says it changed (or forced)."""
    from services import google_service as gs

    _require_google()
    meta = await _run(lambda: gs.drive_get_metadata(budget.drive_file_id))
    if meta is None:
        raise BudgetError(
            "The budget's spreadsheet is missing on Drive — it may have been deleted."
        )
    modified = meta.get("modified", "")
    if not force and modified and modified == budget.drive_modified_at:
        return budget  # cache is current

    def _read_all() -> tuple[list, list, list]:
        try:
            ledger = gs.sheets_read(budget.drive_file_id, LEDGER_RANGE).get("rows", [])
        except Exception as exc:  # noqa: BLE001 — external sheets may have no Ledger tab
            if "Unable to parse range" not in str(exc):
                raise
            # Linked external sheet without Gerry's layout — read the first
            # tab best-effort (columns mapped A–G as date/description/
            # category/amount/source/note/status; read-only, so nothing can be
            # hurt). A sheet that never heard of column G simply has no
            # status, which reads as Spent.
            tabs = gs.sheets_get_metadata(budget.drive_file_id).get("sheets", [])
            if not tabs:
                raise
            first = tabs[0].replace("'", "''")
            ledger = gs.sheets_read(budget.drive_file_id, f"'{first}'!A2:G2000").get("rows", [])
        try:
            cats = gs.sheets_read(budget.drive_file_id, "Categories!A2:B200").get("rows", [])
        except Exception:  # noqa: BLE001 — external sheets may lack the tab
            cats = []
        try:
            settings_rows = gs.sheets_read(budget.drive_file_id, "Settings!A1:B10").get("rows", [])
        except Exception:  # noqa: BLE001
            settings_rows = []
        return ledger, cats, settings_rows

    try:
        ledger_rows, cat_rows, settings_rows = await _run(_read_all)
    except Exception as exc:  # noqa: BLE001
        raise BudgetError(f"Couldn't read the budget sheet: {str(exc)[:200]}") from exc

    await _ensure_status_header(budget)

    entries = []
    for i, row in enumerate(ledger_rows):
        padded = list(row) + [""] * (LEDGER_WIDTH - len(row))
        amount = _parse_amount(padded[3])
        if not any(str(c).strip() for c in padded):
            continue
        entries.append(
            {
                "row": i + 2,  # 1-based sheet row (header is row 1)
                "date": str(padded[0]).strip(),
                "description": str(padded[1]).strip(),
                "category": str(padded[2]).strip(),
                "amount": amount,
                "source": str(padded[4]).strip() or "sheet-edit",
                "note": str(padded[5]).strip(),
                "status": normalize_status(padded[6]),
            }
        )

    categories = []
    for row in cat_rows:
        name = str(row[0]).strip() if row else ""
        if not name:
            continue
        cap = _parse_amount(row[1]) if len(row) > 1 else None
        categories.append({"name": name, "cap": cap})

    settings = {str(r[0]).strip(): (r[1] if len(r) > 1 else "") for r in settings_rows if r}
    sheet_allotment = _parse_amount(settings.get("Allotment"))
    sheet_title = str(settings.get("Title", "")).strip()

    allotment = sheet_allotment if sheet_allotment is not None else (
        float(budget.allotment) if budget.allotment is not None else None
    )
    budget.cached_ledger = entries
    budget.cached_categories = categories
    budget.cached_summary = summarize_entries(entries, allotment)
    if sheet_allotment is not None:
        budget.allotment = sheet_allotment
    if sheet_title:
        budget.title = sheet_title[:200]
    budget.drive_modified_at = modified
    budget.cached_at = datetime.now(timezone.utc)
    await db.flush()
    return budget


# ── writes (append / targeted row ops; sheet re-read first) ──────────────


def _require_writable(budget: Budget) -> None:
    if budget.external_readonly:
        raise BudgetError(
            "This budget is a linked external sheet — Little Gerry can only read it. "
            "Edit it directly in Google Sheets, or create a Gerry-managed budget."
        )


async def add_entry(
    db: AsyncSession,
    budget: Budget,
    *,
    date: str,
    description: str,
    amount: float,
    category: str = "",
    note: str = "",
    source: str = "user",
    status: str = STATUS_SPENT,
) -> Budget:
    from services import google_service as gs

    _require_google()
    _require_writable(budget)
    if not description.strip():
        raise BudgetError("Entry description is required.")
    row = [date.strip(), description.strip()[:300], category.strip()[:100],
           amount, source, note.strip()[:500], normalize_status(status)]
    await _run(lambda: gs.sheets_append_row(budget.drive_file_id, LEDGER_APPEND_RANGE, row))
    return await refresh_budget(db, budget, force=True)


async def _read_row(budget: Budget, row_index: int) -> list:
    """Read one ledger row, padded to the full column set."""
    from services import google_service as gs

    current = await _run(
        lambda: gs.sheets_read(budget.drive_file_id, f"Ledger!A{row_index}:G{row_index}")
    )
    rows = current.get("rows", [])
    if not rows:
        return [""] * LEDGER_WIDTH
    return (list(rows[0]) + [""] * LEDGER_WIDTH)[:LEDGER_WIDTH]


async def _verify_row(budget: Budget, row_index: int, expected: dict) -> None:
    """Re-read the target row and confirm it still matches what the caller saw."""
    padded = await _read_row(budget, row_index)
    got_desc = str(padded[1]).strip()
    got_amount = _parse_amount(padded[3])
    want_desc = str(expected.get("description", "")).strip()
    want_amount = expected.get("amount")
    if want_desc and got_desc != want_desc:
        raise BudgetError(
            f'Row {row_index} changed in the sheet (now "{got_desc}") — refresh and try again.'
        )
    if want_amount is not None and got_amount is not None and abs(got_amount - float(want_amount)) > 0.005:
        raise BudgetError(
            f"Row {row_index} amount changed in the sheet — refresh and try again."
        )


async def update_entry(
    db: AsyncSession,
    budget: Budget,
    row_index: int,
    expected: dict,
    fields: dict,
) -> Budget:
    from services import google_service as gs

    _require_google()
    _require_writable(budget)
    if row_index < 2:
        raise BudgetError("Row 1 is the header — entries start at row 2.")
    await _verify_row(budget, row_index, expected)

    padded = await _read_row(budget, row_index)
    for idx, key in enumerate(LEDGER_COLUMNS):
        if key in fields and fields[key] is not None:
            padded[idx] = normalize_status(fields[key]) if key == "status" else fields[key]
    await _run(
        lambda: gs.sheets_update_range(
            budget.drive_file_id, f"Ledger!A{row_index}:G{row_index}", [padded]
        )
    )
    return await refresh_budget(db, budget, force=True)


async def delete_entry(
    db: AsyncSession, budget: Budget, row_index: int, expected: dict
) -> Budget:
    from services import google_service as gs

    _require_google()
    _require_writable(budget)
    if row_index < 2:
        raise BudgetError("Row 1 is the header — entries start at row 2.")
    await _verify_row(budget, row_index, expected)
    await _run(lambda: gs.sheets_delete_row(budget.drive_file_id, "Ledger", row_index))
    return await refresh_budget(db, budget, force=True)


async def update_settings(
    db: AsyncSession,
    budget: Budget,
    *,
    title: str | None = None,
    allotment: float | None = ...,  # sentinel: ... = unchanged, None = clear
) -> Budget:
    """Update Settings-tab values (title/allotment) in the sheet + mirror."""
    from services import google_service as gs

    _require_google()
    if budget.external_readonly:
        # External: DB-side rename only; the sheet stays untouched.
        if title:
            budget.title = title.strip()[:200]
        await db.flush()
        return budget
    if title:
        await _run(
            lambda: gs.sheets_update_range(budget.drive_file_id, "Settings!B1", [[title.strip()[:200]]])
        )
    if allotment is not ...:
        await _run(
            lambda: gs.sheets_update_range(
                budget.drive_file_id, "Settings!B2", [[allotment if allotment is not None else ""]]
            )
        )
    return await refresh_budget(db, budget, force=True)


# ── cross-budget references ───────────────────────────────────────────────

_REF_NOTE_PREFIX = "budget-ref:"

#: The managed row kinds a reference can put in its parent's ledger, and the
#: status each one is written with.
_REF_ROW_STATUS = {"spent": STATUS_SPENT, "allocated": STATUS_ALLOCATED}


def _ref_note(ref_budget_id, kind: str = "spent") -> str:
    what = "total" if kind == "spent" else "allocations"
    return (
        f"{_REF_NOTE_PREFIX}{ref_budget_id}:{kind} "
        f"(auto-synced {what} — edit in the source budget)"
    )


def _ref_row_kind(note, ref_budget_id) -> str | None:
    """Which managed row this is for the given reference, if any.

    Rows written before the ledger had a status column carry a bare
    ``budget-ref:<id>`` marker and meant the spend total, so that is what they
    are still read as.
    """
    marker = f"{_REF_NOTE_PREFIX}{ref_budget_id}"
    text = str(note or "")
    at = text.find(marker)
    if at < 0:
        return None
    rest = text[at + len(marker):]
    for kind in _REF_ROW_STATUS:
        if rest.startswith(f":{kind}"):
            return kind
    return "spent" if not rest[:1].isalnum() else None


def _find_ref_row(budget: Budget, ref_budget_id, kind: str = "spent") -> dict | None:
    for e in budget.cached_ledger or []:
        if _ref_row_kind(e.get("note"), ref_budget_id) == kind:
            return e
    return None


async def check_reference_cycle(db: AsyncSession, budget_id, ref_budget_id) -> bool:
    """True when linking budget_id → ref_budget_id would create a cycle."""
    from models.db.budget import BudgetReference

    refs = list((await db.execute(select(BudgetReference))).scalars())
    edges: dict = {}
    for r in refs:
        edges.setdefault(r.budget_id, set()).add(r.ref_budget_id)
    edges.setdefault(budget_id, set()).add(ref_budget_id)
    # DFS from ref target: can we get back to the referencing budget?
    stack, seen = [ref_budget_id], set()
    while stack:
        node = stack.pop()
        if node == budget_id:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(edges.get(node, ()))
    return False


async def _sync_ref_row(
    budget: Budget, target: Budget, kind: str, total: float
) -> bool:
    """Create, update or clear one managed roll-up row. True if the sheet changed."""
    from services import google_service as gs

    row = _find_ref_row(budget, target.id, kind)
    suffix = "" if kind == "spent" else " (allocated)"
    desc = f"[Budget] {target.title}{suffix}"[:300]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    status = _REF_ROW_STATUS[kind]

    if row is None:
        # Nothing to mirror and nothing mirrored: leave the ledger alone
        # rather than parking a zero row in it.
        if abs(total) < 0.005:
            return False
        await _run(
            lambda: gs.sheets_append_row(
                budget.drive_file_id,
                LEDGER_APPEND_RANGE,
                [today, desc, "", total, "budget-ref", _ref_note(target.id, kind), status],
            )
        )
        return True

    unchanged = (
        row.get("amount") is not None
        and abs(float(row["amount"]) - total) <= 0.005
        and str(row.get("description", "")) == desc
        and str(row.get("status", "")) == status
    )
    if unchanged:
        return False
    await _run(
        lambda: gs.sheets_update_range(
            budget.drive_file_id,
            f"Ledger!A{row['row']}:G{row['row']}",
            [[today, desc, str(row.get("category", "")), total, "budget-ref",
              _ref_note(target.id, kind), status]],
        )
    )
    return True


def _ref_panel_row(ref, target: Budget) -> dict:
    """The figures a reference contributes, read straight from the mirror."""
    ts = target.cached_summary or {}
    total = float(ts.get("total_spent") or 0)
    allocated = float(ts.get("total_allocated") or 0)
    return {
        "id": str(ref.id),
        "ref_budget_id": str(target.id),
        "ref_title": target.title,
        "include_as_entry": ref.include_as_entry,
        "total_spent": total,
        "total_allocated": allocated,
        "total_collected": float(ts.get("total_collected") or 0),
        "total_expected": float(ts.get("total_expected") or 0),
        "committed": round(total + allocated, 2),
        "allotment": ts.get("allotment"),
        "remaining": ts.get("remaining"),
        "entry_count": ts.get("entry_count", 0),
        "external_readonly": target.external_readonly,
    }


async def _references_with_targets(db: AsyncSession, budget: Budget) -> list[tuple]:
    from models.db.budget import BudgetReference

    refs = list(
        (
            await db.execute(
                select(BudgetReference)
                .where(BudgetReference.budget_id == budget.id)
                .order_by(BudgetReference.created_at)
            )
        ).scalars()
    )
    pairs = []
    for ref in refs:
        target = (
            await db.execute(select(Budget).where(Budget.id == ref.ref_budget_id))
        ).scalar_one_or_none()
        if target is not None:
            pairs.append((ref, target))
    return pairs


async def reference_panel(db: AsyncSession, budget: Budget) -> list[dict]:
    """Reference figures from the mirror alone — no Drive call, no writes.

    This is what a project member gets. Refreshing a referenced sheet needs
    its owner's Google credentials, which a colleague does not have.
    """
    return [_ref_panel_row(ref, target) for ref, target in await _references_with_targets(db, budget)]


async def sync_budget_references(db: AsyncSession, budget: Budget) -> list[dict]:
    """Refresh referenced budgets and keep line-item rows in sync.

    Returns panel data for each reference. Line-item rows are marked rows
    ("[Budget] <title>", source='budget-ref') that the user set up explicitly
    — updating them on refresh is that standing instruction, not a silent
    write. A referenced budget contributes up to two rows: what it has spent
    and what it has allocated, kept apart so the parent's own allocated total
    means the same thing at every level of the tree. Never raises.
    """
    from models.db.budget import BudgetReference  # noqa: F401 — model registration

    pairs = await _references_with_targets(db, budget)
    if not pairs:
        return []
    out: list[dict] = []
    rows_changed = False
    for ref, target in pairs:
        try:
            await refresh_budget(db, target)
        except BudgetError:
            logger.info("Reference sync: target %s refresh failed; using cache", target.id)
        panel = _ref_panel_row(ref, target)
        out.append(panel)
        if not ref.include_as_entry or budget.external_readonly:
            continue
        for kind, amount in (
            ("spent", panel["total_spent"]),
            ("allocated", panel["total_allocated"]),
        ):
            try:
                if await _sync_ref_row(budget, target, kind, amount):
                    rows_changed = True
            except Exception:  # noqa: BLE001 — one ref row must not break the read
                logger.exception(
                    "Reference sync: %s row failed for %s→%s", kind, budget.id, target.id
                )
    if rows_changed:
        try:
            await refresh_budget(db, budget, force=True)
        except BudgetError:
            logger.info("Reference sync: post-sync refresh failed for %s", budget.id)
    return out


async def remove_reference_row(db: AsyncSession, budget: Budget, ref_budget_id) -> bool:
    """Delete the managed line-item rows for a reference, if present.

    Deleting a row renumbers everything under it, so each row is found again
    from the freshly refreshed ledger rather than from indices read up front.
    """
    removed = False
    for kind in _REF_ROW_STATUS:
        row = _find_ref_row(budget, ref_budget_id, kind)
        if row is None:
            continue
        try:
            await delete_entry(
                db, budget, int(row["row"]),
                {"description": row.get("description"), "amount": row.get("amount")},
            )
            removed = True
        except BudgetError:
            logger.info(
                "Reference row removal failed for %s (ref %s, %s)", budget.id, ref_budget_id, kind
            )
    return removed
