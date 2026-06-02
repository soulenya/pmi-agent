"""Briefings API — generate and retrieve daily briefings."""

from __future__ import annotations

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

router = APIRouter(prefix="/briefings", tags=["briefings"])


async def _generate_briefing_content(
    user_id,
    db: AsyncSession,
    for_date: date,
) -> dict:
    """Build structured briefing content from live DB state."""
    # Open tasks due on or before today
    task_repo = TaskRepository(db)
    all_tasks = await task_repo.list(user_id=user_id)
    today = date.today()
    due_tasks = [
        t for t in all_tasks
        if t.status not in ("done", "cancelled")
        and t.due_date
        and t.due_date.date() <= today  # type: ignore[union-attr]
    ]

    # Pending approvals
    approval_repo = ApprovalRepository(db)
    pending = await approval_repo.list_pending(user_id)

    priority_items = [
        {"type": "task", "title": t.title, "priority": t.priority, "due": str(t.due_date)}
        for t in due_tasks[:5]
    ]
    open_actions = [
        {"type": "approval", "title": a.intent_title, "risk": a.risk_level}
        for a in pending[:5]
    ]

    in_progress = [t for t in all_tasks if t.status == "in_progress"]
    open_actions += [
        {"type": "task", "title": t.title, "status": t.status}
        for t in in_progress[:5]
    ]

    headline = f"PMI Daily Briefing — {for_date.strftime('%B %d, %Y')}"
    lines = [headline, ""]
    if priority_items:
        lines.append(f"⚠️  {len(due_tasks)} task(s) overdue or due today")
    if pending:
        lines.append(f"🔔  {len(pending)} approval(s) awaiting your decision")
    if in_progress:
        lines.append(f"🔄  {len(in_progress)} task(s) in progress")
    if not priority_items and not pending and not in_progress:
        lines.append("✅  No urgent items today.")

    return {
        "headline": headline,
        "priority_items": priority_items,
        "open_actions": open_actions,
        "upcoming_events": [],
        "full_content": "\n".join(lines),
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
