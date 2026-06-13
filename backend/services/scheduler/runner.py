"""Recurring scheduled-task engine for Little Gerry.

Responsibilities:
  - ``compute_next_run`` — given a recurrence (daily/weekly/monthly + local
    time), return the next ``datetime`` at which a task should fire.
  - ``run_scheduled_task`` — run one task headlessly through the agent executor,
    capture the final answer, and record the outcome on the row.
  - ``scheduled_tasks_loop`` — the background loop started from the app lifespan;
    wakes once a minute, runs anything due, reschedules it.

All times are LOCAL (``datetime.now()`` with no tz), matching the existing
daily-assistant and Drive-sync loops in this per-user desktop app.
"""

from __future__ import annotations

import calendar
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.enums import MessageRole
from models.db.scheduled_task import ScheduledTask
from repositories.conversation_repo import (
    ConversationRepository,
    MessageRepository,
)

logger = logging.getLogger(__name__)

VALID_FREQUENCIES = ("daily", "weekly", "monthly")


def compute_next_run(
    *,
    frequency: str,
    hour: int,
    minute: int,
    day_of_week: int | None = None,
    day_of_month: int | None = None,
    after: datetime | None = None,
) -> datetime:
    """Return the next local ``datetime`` the task should run, strictly after ``after``.

    - daily: every day at hour:minute
    - weekly: on ``day_of_week`` (0=Mon..6=Sun) at hour:minute
    - monthly: on ``day_of_month`` (1..31, clamped to month length) at hour:minute
    """
    now = after or datetime.now()
    hour = max(0, min(23, int(hour)))
    minute = max(0, min(59, int(minute)))

    if frequency == "daily":
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    if frequency == "weekly":
        target_dow = 0 if day_of_week is None else max(0, min(6, int(day_of_week)))
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        days_ahead = (target_dow - candidate.weekday()) % 7
        candidate += timedelta(days=days_ahead)
        if candidate <= now:
            candidate += timedelta(days=7)
        return candidate

    if frequency == "monthly":
        target_dom = 1 if day_of_month is None else max(1, min(31, int(day_of_month)))

        def _for_month(year: int, month: int) -> datetime:
            last_day = calendar.monthrange(year, month)[1]
            day = min(target_dom, last_day)
            return datetime(year, month, day, hour, minute)

        candidate = _for_month(now.year, now.month)
        if candidate <= now:
            year = now.year + (1 if now.month == 12 else 0)
            month = 1 if now.month == 12 else now.month + 1
            candidate = _for_month(year, month)
        return candidate

    # Unknown frequency → default to 24h out so a misconfigured row never spins.
    return now + timedelta(days=1)


async def run_scheduled_task(db: AsyncSession, task: ScheduledTask) -> dict:
    """Run a single scheduled task headlessly and record the outcome on the row.

    Returns ``{"status": "success"|"failed", "output": str}``.
    """
    # Import here to avoid a circular import at module load time.
    from services.agent.executor import AgentExecutor

    conv_repo = ConversationRepository(db)
    msg_repo = MessageRepository(db)

    # Reuse a single conversation per task so its run history accumulates in one
    # place the user can open in chat; create it on first run.
    conv = None
    if task.conversation_id:
        conv = await conv_repo.get(task.conversation_id, task.user_id)
    if conv is None:
        conv = await conv_repo.create(
            user_id=task.user_id,
            title=f"[Scheduled] {task.title}"[:200],
        )
        task.conversation_id = conv.id

    # Mark the row as running so the UI can show progress while the agent works.
    task.last_run_status = "running"
    await db.commit()

    status = "success"
    output = ""
    try:
        executor = await AgentExecutor.create(db, task.user_id, conv.id)
        # Consume the agent stream to completion; frames are irrelevant here —
        # the executor persists the final assistant message itself.
        async for _frame in executor._run(task.prompt):
            pass

        # Read back the most recent assistant message as the run output.
        msgs = await msg_repo.list_for_conversation(conv.id, limit=200, most_recent=True)
        assistant_msgs = [m for m in msgs if m.role == MessageRole.ASSISTANT]
        output = assistant_msgs[-1].content if assistant_msgs else ""
        if not output:
            status = "failed"
            output = "The scheduled run produced no response."
    except Exception as exc:  # noqa: BLE001 — record failure, never crash the loop
        logger.exception("Scheduled task %s failed", task.id)
        status = "failed"
        output = f"Run failed: {exc}"

    # Record outcome + reschedule.
    now = datetime.now()
    task.last_run_at = now
    task.last_run_status = status
    task.last_run_output = output[:4000]
    task.run_count = (task.run_count or 0) + 1
    task.next_run_at = compute_next_run(
        frequency=task.frequency,
        hour=task.hour,
        minute=task.minute,
        day_of_week=task.day_of_week,
        day_of_month=task.day_of_month,
        after=now,
    )
    await db.commit()
    return {"status": status, "output": output}


# Strong references to in-flight "run now" tasks so they aren't garbage-collected.
_background_runs: set = set()


def start_background_run(task_id: uuid.UUID) -> None:
    """Kick off a scheduled-task run in the background with its own DB session.

    Used by the "run now" endpoint so the HTTP request can return immediately —
    agent runs routinely take longer than the frontend's request timeout, and a
    client disconnect must not cancel the run.
    """
    import asyncio

    async def _run() -> None:
        from database import AsyncSessionLocal

        try:
            async with AsyncSessionLocal() as db:
                task = (
                    await db.execute(
                        select(ScheduledTask).where(ScheduledTask.id == task_id)
                    )
                ).scalar_one_or_none()
                if task is not None:
                    await run_scheduled_task(db, task)
        except Exception:
            logger.exception("Background run of scheduled task %s crashed", task_id)

    bg = asyncio.create_task(_run())
    _background_runs.add(bg)
    bg.add_done_callback(_background_runs.discard)


async def scheduled_tasks_loop(get_db, notification_manager) -> None:
    """Background loop: every minute, run any enabled task whose time has come.

    ``get_db`` is the app's async DB-session generator; ``notification_manager``
    is used to push a notification to the user when a task finishes.
    """
    import asyncio

    while True:
        await asyncio.sleep(60)
        try:
            now = datetime.now()
            async for db in get_db():
                due = (
                    await db.execute(
                        select(ScheduledTask).where(
                            ScheduledTask.enabled.is_(True),
                            ScheduledTask.next_run_at.isnot(None),
                            ScheduledTask.next_run_at <= now,
                        )
                    )
                ).scalars().all()

                for task in due:
                    title = task.title
                    user_id = str(task.user_id)
                    result = await run_scheduled_task(db, task)
                    try:
                        await notification_manager.push(
                            user_id,
                            {
                                "type": "notification",
                                "title": (
                                    f"Scheduled task complete: {title}"
                                    if result["status"] == "success"
                                    else f"Scheduled task failed: {title}"
                                ),
                                "notif_type": "reminder",
                            },
                        )
                    except Exception:
                        logger.exception("Failed to push scheduled-task notification")
        except Exception:
            logger.exception("Scheduled tasks loop error")


async def backfill_next_run(db: AsyncSession) -> None:
    """Set ``next_run_at`` for any enabled task that is missing one (e.g. after a restart)."""
    rows = (
        await db.execute(
            select(ScheduledTask).where(
                ScheduledTask.enabled.is_(True),
                ScheduledTask.next_run_at.is_(None),
            )
        )
    ).scalars().all()
    for task in rows:
        task.next_run_at = compute_next_run(
            frequency=task.frequency,
            hour=task.hour,
            minute=task.minute,
            day_of_week=task.day_of_week,
            day_of_month=task.day_of_month,
        )

    # A backend restart mid-run leaves rows stuck on "running"; mark them failed
    # so the UI doesn't show a phantom run forever.
    stale = (
        await db.execute(
            select(ScheduledTask).where(ScheduledTask.last_run_status == "running")
        )
    ).scalars().all()
    for task in stale:
        task.last_run_status = "failed"
        task.last_run_output = "The run was interrupted by an app restart."

    if rows or stale:
        await db.commit()
