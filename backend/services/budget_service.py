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

# Company budgets folder (Morgan, 2026-07-22): EVERY user's budget sheets are
# created here — baked in so all budgets live in one known place on Drive.
# The SystemSetting below still wins when set (relocation without a release).
BUDGET_FOLDER_ID = "1k-tBw0UomODw-nwJjjkNteHaQltuNs2D"
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


# ── cross-budget references ───────────────────────────────────────────────

_REF_NOTE_PREFIX = "budget-ref:"


def _ref_note(ref_budget_id) -> str:
    return f"{_REF_NOTE_PREFIX}{ref_budget_id} (auto-synced total — edit in the source budget)"


def _find_ref_row(budget: Budget, ref_budget_id) -> dict | None:
    marker = f"{_REF_NOTE_PREFIX}{ref_budget_id}"
    for e in budget.cached_ledger or []:
        if marker in str(e.get("note", "")):
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


async def sync_budget_references(db: AsyncSession, budget: Budget) -> list[dict]:
    """Refresh referenced budgets and keep line-item rows in sync.

    Returns panel data for each reference. Line-item rows are ONE marked row
    per referenced budget ("[Budget] <title>", source='budget-ref') that the
    user set up explicitly — updating them on refresh is that standing
    instruction, not a silent write. Never raises.
    """
    from models.db.budget import BudgetReference
    from services import google_service as gs

    refs = list(
        (
            await db.execute(
                select(BudgetReference)
                .where(BudgetReference.budget_id == budget.id)
                .order_by(BudgetReference.created_at)
            )
        ).scalars()
    )
    if not refs:
        return []
    out: list[dict] = []
    rows_changed = False
    for ref in refs:
        target = (
            await db.execute(select(Budget).where(Budget.id == ref.ref_budget_id))
        ).scalar_one_or_none()
        if target is None:
            continue
        try:
            await refresh_budget(db, target)
        except BudgetError:
            logger.info("Reference sync: target %s refresh failed; using cache", target.id)
        ts = target.cached_summary or {}
        total = float(ts.get("total_spent") or 0)
        out.append(
            {
                "id": str(ref.id),
                "ref_budget_id": str(target.id),
                "ref_title": target.title,
                "include_as_entry": ref.include_as_entry,
                "total_spent": total,
                "allotment": ts.get("allotment"),
                "remaining": ts.get("remaining"),
                "entry_count": ts.get("entry_count", 0),
                "external_readonly": target.external_readonly,
            }
        )
        if not ref.include_as_entry or budget.external_readonly:
            continue
        try:
            row = _find_ref_row(budget, target.id)
            desc = f"[Budget] {target.title}"[:300]
            if row is None:
                await _run(
                    lambda d=desc, t=total, rid=target.id: gs.sheets_append_row(
                        budget.drive_file_id,
                        "Ledger!A:F",
                        [datetime.now(timezone.utc).strftime("%Y-%m-%d"), d, "", t,
                         "budget-ref", _ref_note(rid)],
                    )
                )
                rows_changed = True
            elif (
                row.get("amount") is None
                or abs(float(row["amount"]) - total) > 0.005
                or str(row.get("description", "")) != desc
            ):
                await _run(
                    lambda r=row, d=desc, t=total, rid=target.id: gs.sheets_update_range(
                        budget.drive_file_id,
                        f"Ledger!A{r['row']}:F{r['row']}",
                        [[datetime.now(timezone.utc).strftime("%Y-%m-%d"), d,
                          str(r.get("category", "")), t, "budget-ref", _ref_note(rid)]],
                    )
                )
                rows_changed = True
        except Exception:  # noqa: BLE001 — one ref row must not break the read
            logger.exception("Reference sync: row update failed for %s→%s", budget.id, target.id)
    if rows_changed:
        try:
            await refresh_budget(db, budget, force=True)
        except BudgetError:
            logger.info("Reference sync: post-sync refresh failed for %s", budget.id)
    return out


async def remove_reference_row(db: AsyncSession, budget: Budget, ref_budget_id) -> bool:
    """Delete the managed line-item row for a reference, if present."""
    row = _find_ref_row(budget, ref_budget_id)
    if row is None:
        return False
    try:
        await delete_entry(
            db, budget, int(row["row"]),
            {"description": row.get("description"), "amount": row.get("amount")},
        )
        return True
    except BudgetError:
        logger.info("Reference row removal failed for %s (ref %s)", budget.id, ref_budget_id)
        return False
