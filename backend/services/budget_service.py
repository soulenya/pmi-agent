"""Budget service — Drive-backed personal budgets, two surfaces, one ledger.

The Google Sheet is the system of record. This service creates standardized
budget sheets, parses them into the DB mirror, and performs targeted writes
(row appends / single-row updates / single-row deletes) that always re-read
the sheet first — so edits made directly in Google Sheets are never
clobbered, and edits made here appear in Sheets immediately.

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

BUDGET_FOLDER_NAME = "Little Gerry Budgets"
SETTING_FOLDER_ID = "budgets.folder_id_override"
LEDGER_COLUMNS = ("date", "description", "category", "amount", "source", "note")


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
    folder = await _run(lambda: gs.drive_find_or_create_folder(BUDGET_FOLDER_NAME, None))
    if not folder.get("id"):
        raise BudgetError("Couldn't find or create the Little Gerry Budgets folder on Drive.")
    db.add(SystemSetting(key=SETTING_FOLDER_ID, value=folder["id"]))
    await db.flush()
    return folder["id"]


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
    """Link a sheet Gerry didn't create — READ-ONLY (drive.file boundary)."""
    from services import google_service as gs

    _require_google()
    file_id = file_id.strip()
    try:
        meta = await _run(lambda: gs.sheets_get_metadata(file_id))
    except Exception as exc:  # noqa: BLE001
        raise BudgetError(f"Couldn't read that spreadsheet: {exc}") from exc
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
        ledger = gs.sheets_read(budget.drive_file_id, "Ledger!A2:F2000").get("rows", [])
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
        raise BudgetError(f"Couldn't read the budget sheet: {exc}") from exc

    entries = []
    for i, row in enumerate(ledger_rows):
        padded = list(row) + [""] * (6 - len(row))
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

    total = sum(e["amount"] for e in entries if e["amount"] is not None)
    by_category: dict[str, float] = {}
    for e in entries:
        if e["amount"] is None:
            continue
        key = e["category"] or "(uncategorized)"
        by_category[key] = round(by_category.get(key, 0) + e["amount"], 2)

    allotment = sheet_allotment if sheet_allotment is not None else (
        float(budget.allotment) if budget.allotment is not None else None
    )
    budget.cached_ledger = entries
    budget.cached_categories = categories
    budget.cached_summary = {
        "total_spent": round(total, 2),
        "allotment": allotment,
        "remaining": round(allotment - total, 2) if allotment is not None else None,
        "by_category": by_category,
        "entry_count": len(entries),
    }
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
) -> Budget:
    from services import google_service as gs

    _require_google()
    _require_writable(budget)
    if not description.strip():
        raise BudgetError("Entry description is required.")
    row = [date.strip(), description.strip()[:300], category.strip()[:100],
           amount, source, note.strip()[:500]]
    await _run(lambda: gs.sheets_append_row(budget.drive_file_id, "Ledger!A:F", row))
    return await refresh_budget(db, budget, force=True)


async def _verify_row(budget: Budget, row_index: int, expected: dict) -> None:
    """Re-read the target row and confirm it still matches what the caller saw."""
    from services import google_service as gs

    current = await _run(
        lambda: gs.sheets_read(budget.drive_file_id, f"Ledger!A{row_index}:F{row_index}")
    )
    rows = current.get("rows", [])
    padded = (list(rows[0]) + [""] * 6)[:6] if rows else [""] * 6
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

    current = await _run(
        lambda: gs.sheets_read(budget.drive_file_id, f"Ledger!A{row_index}:F{row_index}")
    )
    rows = current.get("rows", [])
    padded = (list(rows[0]) + [""] * 6)[:6] if rows else [""] * 6
    col_map = {"date": 0, "description": 1, "category": 2, "amount": 3, "source": 4, "note": 5}
    for key, idx in col_map.items():
        if key in fields and fields[key] is not None:
            padded[idx] = fields[key]
    await _run(
        lambda: gs.sheets_update_range(
            budget.drive_file_id, f"Ledger!A{row_index}:F{row_index}", [padded]
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
