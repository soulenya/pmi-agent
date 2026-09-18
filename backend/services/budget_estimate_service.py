"""Budget estimates — the cost you expect before the money exists.

A ledger records money that has moved or been promised. An estimate is the
plan before either: what a contract will cost if won, what an R&D effort
will need. It lives on its own tab of the budget's Google Sheet so it can be
built here or in Sheets, and it is kept apart from the ledger so a plan can
never be mistaken for spend.

Estimate tab, one line per row:

    Phase | Kind | Description | Qty | Unit cost | Amount | Note | Category

Qty × Unit cost gives Amount when both are filled (hours × rate, units ×
price); otherwise Amount is typed straight in. Kind is one of Labor,
Materials, Travel, Subcontract, Other — the buckets a government cost volume
expects, and enough for anything else. Category is the budget's own category
(the Categories tab), so a committed line lands in the ledger under it;
blank falls back to the kind. It sits last because tabs made before it
existed have data in A:G.

Two ways to total it, chosen per budget on the Settings tab:

    Simple          the sum of the lines
    Cost build-up   labor → fringe → overhead → other direct costs → G&A → fee,
                    each rate on the Settings tab, the way a proposal is priced

Committing an estimate turns each line into an Allocated ledger row (money
promised, not yet paid) and can set the allotment to the estimate total; the
estimate itself stays as the baseline to compare against.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from models.db.budget import Budget
from services.budget_service import (
    STATUS_ALLOCATED,
    BudgetError,
    _parse_amount,
    _require_google,
    _require_writable,
    ensure_category,
    refresh_budget,
)

logger = logging.getLogger(__name__)

TAB = "Estimate"
COLUMNS = ("phase", "kind", "description", "qty", "unit_cost", "amount", "note", "category")
WIDTH = len(COLUMNS)
HEADER = ["Phase", "Kind", "Description", "Qty", "Unit cost", "Amount", "Note", "Category"]
RANGE = f"{TAB}!A2:H2000"
APPEND_RANGE = f"{TAB}!A:H"

KINDS = ("Labor", "Materials", "Travel", "Subcontract", "Other")
_KIND_SYNONYMS = {
    "labor": "Labor", "labour": "Labor", "personnel": "Labor", "staff": "Labor", "hours": "Labor",
    "material": "Materials", "materials": "Materials", "equipment": "Materials", "parts": "Materials",
    "supplies": "Materials",
    "travel": "Travel", "trip": "Travel",
    "subcontract": "Subcontract", "subcontractor": "Subcontract", "sub": "Subcontract",
    "consultant": "Subcontract", "vendor": "Subcontract",
    "other": "Other", "odc": "Other", "": "Other",
}

MODE_SIMPLE = "Simple"
MODE_COST = "Cost build-up"
MODES = (MODE_SIMPLE, MODE_COST)

# Settings-tab keys (column A) that hold the estimate's rates. Percentages.
SETTING_MODE = "Estimate Mode"
SETTING_FRINGE = "Fringe %"
SETTING_OVERHEAD = "Overhead %"
SETTING_GA = "G&A %"
SETTING_FEE = "Fee %"
RATE_KEYS = (SETTING_FRINGE, SETTING_OVERHEAD, SETTING_GA, SETTING_FEE)
SETTINGS_RANGE = "Settings!A1:B30"

_COMMIT_MARK = "estimate-commit:"


def normalize_kind(raw) -> str:
    text = str(raw or "").strip()
    if text in KINDS:
        return text
    return _KIND_SYNONYMS.get(text.lower(), "Other")


def normalize_mode(raw) -> str:
    text = str(raw or "").strip().lower()
    if text.startswith("cost") or text in ("build-up", "buildup", "loaded", "government"):
        return MODE_COST
    return MODE_SIMPLE


def _pct(raw) -> float:
    """A rate typed as 30, 30%, or 0.30 all mean thirty percent."""
    s = str(raw or "").strip().replace("%", "")
    if not s:
        return 0.0
    try:
        v = float(s)
    except ValueError:
        return 0.0
    return v * 100 if 0 < v < 1 else v


def parse_lines(rows: list) -> list[dict]:
    lines = []
    for i, row in enumerate(rows):
        padded = list(row) + [""] * (WIDTH - len(row))
        if not any(str(c).strip() for c in padded):
            continue
        qty = _parse_amount(padded[3])
        unit = _parse_amount(padded[4])
        typed = _parse_amount(padded[5])
        # Hours × rate is the line's own arithmetic; a typed amount only stands
        # when one of the two factors is missing.
        amount = round(qty * unit, 2) if qty is not None and unit is not None else typed
        lines.append(
            {
                "row": i + 2,
                "phase": str(padded[0]).strip(),
                "kind": normalize_kind(padded[1]),
                "description": str(padded[2]).strip(),
                "qty": qty,
                "unit_cost": unit,
                "amount": amount,
                "note": str(padded[6]).strip(),
                "category": str(padded[7]).strip(),
            }
        )
    return lines


def parse_rates(settings: dict) -> dict:
    return {
        "mode": normalize_mode(settings.get(SETTING_MODE)),
        "fringe_pct": _pct(settings.get(SETTING_FRINGE)),
        "overhead_pct": _pct(settings.get(SETTING_OVERHEAD)),
        "ga_pct": _pct(settings.get(SETTING_GA)),
        "fee_pct": _pct(settings.get(SETTING_FEE)),
    }


def _build_up(lines: list[dict], rates: dict) -> dict:
    """One priced total: direct costs, the pools on top, and the fee."""
    labor = round(sum(l["amount"] or 0 for l in lines if l["kind"] == "Labor"), 2)
    odc = round(sum(l["amount"] or 0 for l in lines if l["kind"] != "Labor"), 2)
    if rates["mode"] != MODE_COST:
        total = round(labor + odc, 2)
        return {"direct": total, "labor": labor, "odc": odc, "fringe": 0.0, "overhead": 0.0,
                "ga": 0.0, "fee": 0.0, "cost": total, "total": total}
    fringe = round(labor * rates["fringe_pct"] / 100, 2)
    overhead = round((labor + fringe) * rates["overhead_pct"] / 100, 2)
    subtotal = round(labor + fringe + overhead + odc, 2)
    ga = round(subtotal * rates["ga_pct"] / 100, 2)
    cost = round(subtotal + ga, 2)
    fee = round(cost * rates["fee_pct"] / 100, 2)
    return {"direct": round(labor + odc, 2), "labor": labor, "odc": odc, "fringe": fringe,
            "overhead": overhead, "ga": ga, "fee": fee, "cost": cost, "total": round(cost + fee, 2)}


def summarize(lines: list[dict], rates: dict) -> dict:
    """The estimate as the app shows it: totals overall, by phase and by kind."""
    priced = [l for l in lines if l.get("amount") is not None]
    by_kind: dict[str, float] = {}
    by_category: dict[str, float] = {}
    for l in priced:
        by_kind[l["kind"]] = round(by_kind.get(l["kind"], 0) + l["amount"], 2)
        cat = l.get("category") or l["kind"]
        by_category[cat] = round(by_category.get(cat, 0) + l["amount"], 2)
    phases: list[str] = []
    for l in priced:
        if l["phase"] not in phases:
            phases.append(l["phase"])
    by_phase = {
        (p or "(no phase)"): _build_up([l for l in priced if l["phase"] == p], rates)["total"]
        for p in phases
    }
    return {
        **_build_up(priced, rates),
        **rates,
        "by_kind": by_kind,
        "by_category": by_category,
        "by_phase": by_phase,
        "line_count": len(lines),
    }


# ── sheet plumbing ────────────────────────────────────────────────────────


async def _run(fn):
    return await asyncio.get_event_loop().run_in_executor(None, fn)


async def ensure_tab(budget: Budget) -> bool:
    """Give a sheet made before estimates existed its Estimate tab and rate rows.

    Idempotent; returns True when something was added. Read-only linked sheets
    are left alone — the estimate then simply has nowhere to live.
    """
    if budget.external_readonly:
        return False
    from services import google_service as gs

    def _fix() -> bool:
        changed = False
        tabs = gs.sheets_get_metadata(budget.drive_file_id).get("sheets", [])
        if TAB not in tabs:
            gs.sheets_add_tab(budget.drive_file_id, TAB, frozen_rows=1)
            gs.sheets_update_range(budget.drive_file_id, f"{TAB}!A1:H1", [HEADER])
            changed = True
        else:
            # A tab from before the Category column: label H so a hand-typed row lands in it.
            head = gs.sheets_read(budget.drive_file_id, f"{TAB}!A1:H1").get("rows", [[]])
            if len(head[0] if head else []) < WIDTH:
                gs.sheets_update_range(budget.drive_file_id, f"{TAB}!H1", [[HEADER[-1]]])
                changed = True
        rows = gs.sheets_read(budget.drive_file_id, SETTINGS_RANGE).get("rows", [])
        keys = {str(r[0]).strip() for r in rows if r}
        missing = [
            [SETTING_MODE, MODE_SIMPLE] if SETTING_MODE not in keys else None,
            *([k, ""] if k not in keys else None for k in RATE_KEYS),
        ]
        missing = [m for m in missing if m]
        if missing:
            start = len(rows) + 2  # one blank row after what is there
            gs.sheets_update_range(
                budget.drive_file_id, f"Settings!A{start}:B{start + len(missing) - 1}", missing
            )
            changed = True
        return changed

    return await _run(_fix)


async def read_into_cache(budget: Budget) -> None:
    """Read the Estimate tab and rates into the mirror. Missing tab = no estimate."""
    from services import google_service as gs

    def _read() -> tuple[list, dict]:
        try:
            rows = gs.sheets_read(budget.drive_file_id, RANGE).get("rows", [])
        except Exception as exc:  # noqa: BLE001 — no tab yet
            if "Unable to parse range" not in str(exc):
                raise
            rows = []
        try:
            srows = gs.sheets_read(budget.drive_file_id, SETTINGS_RANGE).get("rows", [])
        except Exception:  # noqa: BLE001
            srows = []
        settings = {str(r[0]).strip(): (r[1] if len(r) > 1 else "") for r in srows if r}
        return rows, settings

    rows, settings = await _run(_read)
    lines = parse_lines(rows)
    rates = parse_rates(settings)
    budget.cached_estimate = lines
    summary = dict(budget.cached_summary or {})
    summary["estimate"] = summarize(lines, rates)
    budget.cached_summary = summary


async def _prepare(db: AsyncSession, budget: Budget) -> None:
    _require_google()
    _require_writable(budget)
    await ensure_tab(budget)


def _row_values(
    *, phase: str, kind: str, description: str, qty: float | None, unit_cost: float | None,
    amount: float | None, note: str, category: str = "",
) -> list:
    if qty is not None and unit_cost is not None:
        amount = round(qty * unit_cost, 2)
    if amount is None:
        raise BudgetError("Give an amount, or both a quantity and a unit cost.")
    return [
        phase.strip()[:100], normalize_kind(kind), description.strip()[:300],
        qty if qty is not None else "", unit_cost if unit_cost is not None else "",
        amount, note.strip()[:500], (category or "").strip()[:100],
    ]


async def add_line(db: AsyncSession, budget: Budget, **fields) -> Budget:
    from services import google_service as gs

    await _prepare(db, budget)
    if not str(fields.get("description", "")).strip():
        raise BudgetError("Estimate line description is required.")
    row = _row_values(
        phase=fields.get("phase", ""), kind=fields.get("kind", "Other"),
        description=fields["description"], qty=fields.get("qty"),
        unit_cost=fields.get("unit_cost"), amount=fields.get("amount"), note=fields.get("note", ""),
        category=fields.get("category") or "",
    )
    await ensure_category(budget, row[-1])
    await _run(lambda: gs.sheets_append_row(budget.drive_file_id, APPEND_RANGE, row))
    return await refresh_budget(db, budget, force=True)


async def _read_row(budget: Budget, row_index: int) -> list:
    from services import google_service as gs

    got = await _run(
        lambda: gs.sheets_read(budget.drive_file_id, f"{TAB}!A{row_index}:H{row_index}")
    )
    rows = got.get("rows", [])
    return ((list(rows[0]) if rows else []) + [""] * WIDTH)[:WIDTH]


async def _verify(budget: Budget, row_index: int, expected: dict) -> list:
    padded = await _read_row(budget, row_index)
    want = str(expected.get("description", "")).strip()
    if want and str(padded[2]).strip() != want:
        raise BudgetError(
            f'Estimate row {row_index} changed in the sheet (now "{padded[2]}") — refresh and try again.'
        )
    return padded


async def update_line(
    db: AsyncSession, budget: Budget, row_index: int, expected: dict, fields: dict
) -> Budget:
    from services import google_service as gs

    await _prepare(db, budget)
    if row_index < 2:
        raise BudgetError("Row 1 is the header — estimate lines start at row 2.")
    padded = await _verify(budget, row_index, expected)
    current = parse_lines([padded])[0] if any(str(c).strip() for c in padded) else None
    merged = {
        "phase": current["phase"] if current else "",
        "kind": current["kind"] if current else "Other",
        "description": current["description"] if current else "",
        "qty": current["qty"] if current else None,
        "unit_cost": current["unit_cost"] if current else None,
        "amount": current["amount"] if current else None,
        "note": current["note"] if current else "",
        "category": current.get("category", "") if current else "",
    }
    for key in COLUMNS:
        if key in fields:
            merged[key] = fields[key]
    # A typed amount replaces the product; a changed factor makes a new product.
    if "amount" in fields and fields["amount"] is not None and not (
        "qty" in fields or "unit_cost" in fields
    ):
        merged["qty"], merged["unit_cost"] = None, None
    row = _row_values(**merged)
    await ensure_category(budget, row[-1])
    await _run(
        lambda: gs.sheets_update_range(
            budget.drive_file_id, f"{TAB}!A{row_index}:H{row_index}", [row]
        )
    )
    return await refresh_budget(db, budget, force=True)


async def delete_line(db: AsyncSession, budget: Budget, row_index: int, expected: dict) -> Budget:
    from services import google_service as gs

    await _prepare(db, budget)
    if row_index < 2:
        raise BudgetError("Row 1 is the header — estimate lines start at row 2.")
    await _verify(budget, row_index, expected)
    await _run(lambda: gs.sheets_delete_row(budget.drive_file_id, TAB, row_index))
    return await refresh_budget(db, budget, force=True)


async def update_rates(
    db: AsyncSession,
    budget: Budget,
    *,
    mode: str | None = None,
    fringe_pct: float | None = None,
    overhead_pct: float | None = None,
    ga_pct: float | None = None,
    fee_pct: float | None = None,
) -> Budget:
    """Write the mode and rates onto the Settings tab, wherever their rows sit."""
    from services import google_service as gs

    await _prepare(db, budget)
    wanted = {
        SETTING_MODE: normalize_mode(mode) if mode is not None else None,
        SETTING_FRINGE: fringe_pct,
        SETTING_OVERHEAD: overhead_pct,
        SETTING_GA: ga_pct,
        SETTING_FEE: fee_pct,
    }

    def _write() -> None:
        rows = gs.sheets_read(budget.drive_file_id, SETTINGS_RANGE).get("rows", [])
        for i, r in enumerate(rows):
            key = str(r[0]).strip() if r else ""
            if key in wanted and wanted[key] is not None:
                gs.sheets_update_range(budget.drive_file_id, f"Settings!B{i + 1}", [[wanted[key]]])

    await _run(_write)
    return await refresh_budget(db, budget, force=True)


# ── commit: the plan becomes allocations ─────────────────────────────────


def committed_on(budget: Budget) -> str | None:
    """The date the estimate was last committed to the ledger, if it was."""
    for e in budget.cached_ledger or []:
        note = str(e.get("note") or "")
        at = note.find(_COMMIT_MARK)
        if at >= 0:
            return note[at + len(_COMMIT_MARK):at + len(_COMMIT_MARK) + 10]
    return None


async def commit(
    db: AsyncSession, budget: Budget, *, set_allotment: bool, force: bool = False
) -> dict:
    """Write every priced line as an Allocated ledger row; optionally set the
    allotment to the estimate total. In cost build-up mode the pools (fringe,
    overhead, G&A, fee) become one Allocated row each, so the ledger carries
    the loaded total, not only the direct costs."""
    from services import google_service as gs

    await _prepare(db, budget)
    await refresh_budget(db, budget, force=True)
    lines = [l for l in (budget.cached_estimate or []) if l.get("amount") is not None]
    if not lines:
        raise BudgetError("The estimate has no priced lines to commit.")
    previous = committed_on(budget)
    if previous and not force:
        raise BudgetError(
            f"This estimate was already committed on {previous}. Remove those Allocated "
            "rows from the ledger first, or commit again with force to add a second set."
        )
    est = (budget.cached_summary or {}).get("estimate") or summarize(lines, parse_rates({}))
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    mark = f"{_COMMIT_MARK}{today}"
    rows: list[list] = []
    for l in lines:
        phase = f"{l['phase']} · " if l["phase"] else ""
        note_bits = [mark]
        if l.get("qty") is not None and l.get("unit_cost") is not None:
            note_bits.append(f"{l['qty']:g} × {l['unit_cost']:g}")
        if l.get("note"):
            note_bits.append(l["note"])
        rows.append([
            today, f"{phase}{l['description']}"[:300], l.get("category") or l["kind"], l["amount"],
            "estimate", " — ".join(note_bits)[:500], STATUS_ALLOCATED,
        ])
    if est.get("mode") == MODE_COST:
        for label, key in (("Fringe", "fringe"), ("Overhead", "overhead"), ("G&A", "ga"), ("Fee", "fee")):
            if est.get(key):
                rows.append([
                    today, f"{label} (estimate, {est.get(f'{key}_pct', 0):g}%)"[:300],
                    label, est[key], "estimate", mark, STATUS_ALLOCATED,
                ])
    for kind in {r[2] for r in rows}:
        await ensure_category(budget, kind)
    await _run(lambda: gs.sheets_append_rows(budget.drive_file_id, "Ledger!A:G", rows))
    if set_allotment:
        await _run(
            lambda: gs.sheets_update_range(budget.drive_file_id, "Settings!B2", [[est["total"]]])
        )
    await refresh_budget(db, budget, force=True)
    return {"rows_added": len(rows), "allocated": est["total"], "allotment_set": set_allotment}
