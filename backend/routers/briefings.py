"""Briefings API — generate and retrieve daily briefings."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from models.schemas.briefings import BriefingOut
from repositories.briefing_repo import BriefingRepository
from repositories.task_repo import TaskRepository
from repositories.conversation_repo import ApprovalRepository
from services.llm.router import get_llm_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/briefings", tags=["briefings"])


_BRIEFING_SYSTEM = """\
You are the PMI Executive Assistant for Precisian Medical Instruments. \
Your job is to write a concise, professional daily briefing in Markdown. \
Be direct. Use bullet points. Highlight urgent items with **bold**. \
Keep the entire briefing under 300 words. Do not use emojis.
"""

_BRIEFING_USER_TEMPLATE = """\
Today is {today}. Generate the daily executive briefing for PMI based on this data:

## Open Tasks Due Today or Overdue ({due_count})
{due_tasks_block}

## Tasks In Progress ({in_progress_count})
{in_progress_block}

## Pending Approvals Requiring Decision ({approval_count})
{approvals_block}

Write the briefing as clean Markdown with:
1. A one-sentence headline summarising the day.
2. A **Priority Actions** section listing the most urgent items.
3. A **Status Summary** covering in-progress work.
4. A brief **Outlook** sentence if relevant.
"""


async def _build_briefing_blocks(user_id, db: AsyncSession, today: date) -> tuple[list, list, list]:
    """Return (due_tasks, in_progress_tasks, pending_approvals)."""
    task_repo = TaskRepository(db)
    all_tasks = await task_repo.list(user_id=user_id)

    due_tasks = [
        t for t in all_tasks
        if t.status not in ("done", "cancelled")
        and t.due_date
        and t.due_date.date() <= today  # type: ignore[union-attr]
    ]
    in_progress = [t for t in all_tasks if t.status == "in_progress"]

    approval_repo = ApprovalRepository(db)
    pending = await approval_repo.list_pending(user_id)

    return due_tasks, in_progress, pending


def _task_list_block(tasks: list, limit: int = 8) -> str:
    if not tasks:
        return "None."
    lines = []
    for t in tasks[:limit]:
        due = f" (due {t.due_date.date()})" if t.due_date else ""
        priority = f" [{t.priority}]" if getattr(t, "priority", None) else ""
        lines.append(f"- {t.title}{priority}{due}")
    return "\n".join(lines)


async def _generate_briefing_content(user_id, db: AsyncSession, for_date: date) -> dict:
    """Build structured briefing content, using LLM for prose."""
    due_tasks, in_progress, pending = await _build_briefing_blocks(user_id, db, for_date)

    # Structured items (used for sidebar stats)
    priority_items = [
        {"type": "task", "title": t.title, "priority": getattr(t, "priority", None), "due": str(t.due_date)}
        for t in due_tasks[:5]
    ]
    open_actions = [
        {"type": "approval", "title": a.intent_title, "risk": a.risk_level}
        for a in pending[:5]
    ] + [
        {"type": "task", "title": t.title, "status": t.status}
        for t in in_progress[:5]
    ]

    headline = f"PMI Daily Briefing — {for_date.strftime('%B %d, %Y')}"

    # Build LLM prompt
    user_prompt = _BRIEFING_USER_TEMPLATE.format(
        today=for_date.strftime("%B %d, %Y"),
        due_count=len(due_tasks),
        due_tasks_block=_task_list_block(due_tasks),
        in_progress_count=len(in_progress),
        in_progress_block=_task_list_block(in_progress),
        approval_count=len(pending),
        approvals_block="\n".join(
            f"- {a.intent_title} [risk: {a.risk_level}]" for a in pending[:8]
        ) or "None.",
    )

    full_content = headline  # fallback if LLM fails
    try:
        llm = await get_llm_client(db, task="briefings")
        chunk = await llm.chat(
            messages=[
                {"role": "system", "content": _BRIEFING_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
        )
        if chunk.content:
            full_content = chunk.content.strip()
    except Exception as exc:
        logger.warning("LLM briefing generation failed, using fallback: %s", exc)
        # Fallback: plain-text summary
        lines = [f"# {headline}", ""]
        if due_tasks:
            lines.append(f"**{len(due_tasks)} task(s) overdue or due today.**")
        if pending:
            lines.append(f"**{len(pending)} approval(s) awaiting decision.**")
        if in_progress:
            lines.append(f"{len(in_progress)} task(s) in progress.")
        if not due_tasks and not pending and not in_progress:
            lines.append("No urgent items today.")
        full_content = "\n".join(lines)

    return {
        "headline": headline,
        "priority_items": priority_items,
        "open_actions": open_actions,
        "upcoming_events": [],
        "full_content": full_content,
    }


@router.get("/today", response_model=BriefingOut)
async def get_or_generate_today(
    refresh: bool = Query(False, description="Force regenerate even if one exists today"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BriefingOut:
    """Return today's briefing, generating one if it doesn't exist yet."""
    repo = BriefingRepository(db)
    today = date.today()

    existing = await repo.get_for_date(current_user.id, today)
    if existing and not refresh:
        return BriefingOut.model_validate(existing)

    content = await _generate_briefing_content(current_user.id, db, today)
    briefing = await repo.create(
        user_id=current_user.id,
        briefing_type="daily",
        generated_for_date=today,
        **content,
    )
    await db.commit()
    return BriefingOut.model_validate(briefing)


@router.get("", response_model=list[BriefingOut])
async def list_briefings(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BriefingOut]:
    repo = BriefingRepository(db)
    briefings = await repo.list(current_user.id, limit=limit)
    return [BriefingOut.model_validate(b) for b in briefings]
