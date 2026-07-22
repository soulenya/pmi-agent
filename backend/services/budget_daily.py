"""Budget daily automations — threshold nudges, cap warnings, monthly rollups.

Runs once per local day (called from the daily assistant scan, right after
the workroom automations and before the Google-credentials gate — the checks
work from the cached mirror even without Google; when Google IS connected
each budget gets a cheap modifiedTime-gated refresh first).

* **Allotment thresholds** — crossing 80% / 100% of a budget's allotment
  raises a notification once per crossing (re-armed when spending drops
  back below).
* **Category-cap warnings** — a category reaching its cap notifies once,
  re-armed when it goes back under.
* **Monthly rollup** — on the first scan of a new month, each budget with
  spending in the previous month gets a one-line rollup notification.
* **Digest baseline** — yesterday's total per budget is snapshotted so the
  workroom morning digest can report "spending changed since yesterday"
  for pinned budgets.

Read-only nudges: nothing here ever writes to a sheet. Best-effort
throughout — failures are logged and skipped, never raised into the scan.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.budget import Budget
from models.db.enums import NotificationType
from repositories.conversation_repo import NotificationRepository

logger = logging.getLogger(__name__)

SETTING_LAST_DATE = "budgets.daily.last_date"
SETTING_STATE = "budgets.daily.state"

_MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def _fmt(value, currency: str = "USD") -> str:
    if value is None:
        return "—"
    sym = "$" if (currency or "USD").upper() == "USD" else f"{currency} "
    return f"{sym}{float(value):,.2f}"


async def _get_setting(db: AsyncSession, key: str):
    from models.db.settings import SystemSetting

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return row.value if row is not None else None


async def _set_setting(db: AsyncSession, key: str, value) -> None:
    from models.db.settings import SystemSetting

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        db.add(SystemSetting(key=key, value=value))
    else:
        row.value = value
    await db.flush()


async def get_digest_baseline(db: AsyncSession, budget_id) -> float | None:
    """Yesterday's total for a budget (for the workroom digest), or None."""
    try:
        state = await _get_setting(db, SETTING_STATE) or {}
        entry = state.get(str(budget_id)) or {}
        today = datetime.now().strftime("%Y-%m-%d")
        if entry.get("total_date") == today:
            return entry.get("prev_total")
        return entry.get("total")
    except Exception:  # noqa: BLE001 — baseline is best-effort
        return None


def _prev_month(now: datetime) -> tuple[str, str]:
    """(YYYY-MM key, human name) of the month before ``now``."""
    year, month = now.year, now.month - 1
    if month == 0:
        year, month = year - 1, 12
    return f"{year:04d}-{month:02d}", f"{_MONTH_NAMES[month - 1]}"


async def run_budget_daily(db: AsyncSession) -> dict:
    """Run budget nudges for every budget, once per local day."""
    summary: dict = {"alerts": 0, "rollups": 0, "notifications": []}
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        if await _get_setting(db, SETTING_LAST_DATE) == today:
            return summary
    except Exception:  # noqa: BLE001
        return summary

    now = datetime.now(timezone.utc)
    month_key = now.strftime("%Y-%m")
    prev_key, prev_name = _prev_month(now)
    state: dict = dict(await _get_setting(db, SETTING_STATE) or {})
    notif_repo = NotificationRepository(db)

    try:
        from services import google_service as gs

        google_ok = bool(gs.get_credentials())
    except Exception:  # noqa: BLE001
        google_ok = False

    budgets = list((await db.execute(select(Budget))).scalars())
    live_ids = {str(b.id) for b in budgets}
    # Drop state for budgets that no longer exist.
    state = {k: v for k, v in state.items() if k in live_ids}

    async def _notify(user_id, ntype: str, title: str, message: str, budget: Budget) -> None:
        notif = await notif_repo.create(
            user_id=user_id,
            type=ntype,
            title=title,
            message=message,
            entity_type="budget",
            entity_id=budget.id,
        )
        summary["notifications"].append(
            {"user_id": str(user_id), "id": str(notif.id), "title": title}
        )

    for budget in budgets:
        try:
            if google_ok:
                try:
                    from services import budget_service as bs

                    await bs.refresh_budget(db, budget)  # modifiedTime-gated: cheap
                except Exception:  # noqa: BLE001 — cache serves when Drive fails
                    logger.info("Budget daily: refresh failed for %s (using cache)", budget.id)

            s = budget.cached_summary or {}
            cur = budget.currency or "USD"
            total = float(s.get("total_spent") or 0)
            allotment = s.get("allotment")
            entry_state: dict = dict(state.get(str(budget.id)) or {})

            # 1. Allotment thresholds (80 / 100), once per crossing.
            level = 0
            if allotment is not None and float(allotment) > 0:
                pct = total / float(allotment) * 100
                level = 100 if pct >= 100 else 80 if pct >= 80 else 0
                prev_level = int(entry_state.get("level") or 0)
                if level > prev_level:
                    remaining = float(allotment) - total
                    if level >= 100:
                        title = f'Budget "{budget.title}" is over its allotment'
                        msg = (
                            f"Spent {_fmt(total, cur)} of {_fmt(allotment, cur)} "
                            f"({pct:.0f}%) — {_fmt(abs(remaining), cur)} over."
                        )
                        ntype = NotificationType.SYSTEM_ALERT.value
                    else:
                        title = f'Budget "{budget.title}" has reached {pct:.0f}% of its allotment'
                        msg = (
                            f"Spent {_fmt(total, cur)} of {_fmt(allotment, cur)} — "
                            f"{_fmt(remaining, cur)} remaining."
                        )
                        ntype = NotificationType.REMINDER.value
                    await _notify(budget.user_id, ntype, title, msg, budget)
                    summary["alerts"] += 1
            entry_state["level"] = level  # crossing down re-arms silently

            # 2. Category caps, once per crossing.
            by_cat = s.get("by_category") or {}
            capped_now: dict[str, bool] = {}
            alerted = dict(entry_state.get("categories") or {})
            for cat in budget.cached_categories or []:
                name, cap = cat.get("name"), cat.get("cap")
                if not name or cap is None or float(cap) <= 0:
                    continue
                spent = float(by_cat.get(name, 0))
                if spent >= float(cap):
                    capped_now[name] = True
                    if not alerted.get(name):
                        await _notify(
                            budget.user_id,
                            NotificationType.SYSTEM_ALERT.value,
                            f'"{name}" hit its cap in budget "{budget.title}"',
                            f"{_fmt(spent, cur)} of a {_fmt(cap, cur)} cap.",
                            budget,
                        )
                        summary["alerts"] += 1
            entry_state["categories"] = capped_now  # dropping below re-arms

            # 3. Monthly rollup — first scan of a new month.
            if entry_state.get("rollup_month") != month_key:
                entry_state["rollup_month"] = month_key
                month_entries = [
                    e for e in (budget.cached_ledger or [])
                    if str(e.get("date", "")).startswith(prev_key)
                    and e.get("amount") is not None
                ]
                if month_entries:
                    spent = round(sum(float(e["amount"]) for e in month_entries), 2)
                    cats = {e.get("category") or "(uncategorized)" for e in month_entries}
                    msg = f"{prev_name}: {_fmt(spent, cur)} across {len(cats)} categor{'y' if len(cats) == 1 else 'ies'}"
                    if allotment is not None:
                        msg += f" — {_fmt(float(allotment) - total, cur)} remaining overall"
                    await _notify(
                        budget.user_id,
                        NotificationType.REMINDER.value,
                        f'Monthly rollup — "{budget.title}"',
                        msg + ".",
                        budget,
                    )
                    summary["rollups"] += 1

            # 4. Digest baseline snapshot (prev day's total kept for today).
            if entry_state.get("total_date") != today:
                entry_state["prev_total"] = entry_state.get("total")
            entry_state["total"] = total
            entry_state["total_date"] = today

            state[str(budget.id)] = entry_state
        except Exception:  # noqa: BLE001 — one budget must not block the rest
            logger.exception("Budget daily failed for %s", budget.id)

    try:
        await _set_setting(db, SETTING_STATE, state)
        await _set_setting(db, SETTING_LAST_DATE, today)
        await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Budget daily: failed to persist")
        await db.rollback()
    if summary["alerts"] or summary["rollups"]:
        logger.info(
            "Budget daily complete: %d alert(s), %d rollup(s)",
            summary["alerts"],
            summary["rollups"],
        )
    return summary
