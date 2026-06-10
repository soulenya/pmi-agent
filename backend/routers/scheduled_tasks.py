"""Scheduled tasks router.

CRUD for recurring instructions the user asks Little Gerry to perform on a
schedule (daily/weekly/monthly at a local time), plus a "run now" endpoint.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.scheduled_task import ScheduledTask
from models.db.user import User
from services.scheduler.runner import (
    VALID_FREQUENCIES,
    compute_next_run,
    run_scheduled_task,
)

router = APIRouter(prefix="/scheduled-tasks", tags=["scheduled-tasks"])


# ── schemas ───────────────────────────────────────────────────────────────

class ScheduledTaskOut(BaseModel):
    id: uuid.UUID
    title: str
    prompt: str
    frequency: str
    day_of_week: int | None = None
    day_of_month: int | None = None
    hour: int
    minute: int
    enabled: bool
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_run_status: str | None = None
    last_run_output: str | None = None
    conversation_id: uuid.UUID | None = None
    run_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ScheduledTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    prompt: str = Field(min_length=1)
    frequency: str = "weekly"
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    hour: int = Field(default=8, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    enabled: bool = True


class ScheduledTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    prompt: str | None = Field(default=None, min_length=1)
    frequency: str | None = None
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    hour: int | None = Field(default=None, ge=0, le=23)
    minute: int | None = Field(default=None, ge=0, le=59)
    enabled: bool | None = None


# ── helpers ───────────────────────────────────────────────────────────────

def _validate_frequency(freq: str) -> None:
    if freq not in VALID_FREQUENCIES:
        raise HTTPException(
            400, f"frequency must be one of {', '.join(VALID_FREQUENCIES)}"
        )


async def _get_owned(
    db: AsyncSession, task_id: uuid.UUID, user: User
) -> ScheduledTask:
    row = (
        await db.execute(
            select(ScheduledTask).where(
                ScheduledTask.id == task_id,
                ScheduledTask.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Scheduled task not found")
    return row


def _recompute(task: ScheduledTask) -> None:
    task.next_run_at = compute_next_run(
        frequency=task.frequency,
        hour=task.hour,
        minute=task.minute,
        day_of_week=task.day_of_week,
        day_of_month=task.day_of_month,
    )


# ── endpoints ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[ScheduledTaskOut])
async def list_scheduled_tasks(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(ScheduledTask)
            .where(ScheduledTask.user_id == user.id)
            .order_by(ScheduledTask.created_at.desc())
        )
    ).scalars().all()
    return list(rows)


@router.post("", response_model=ScheduledTaskOut, status_code=201)
async def create_scheduled_task(
    body: ScheduledTaskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _validate_frequency(body.frequency)
    task = ScheduledTask(
        user_id=user.id,
        title=body.title.strip(),
        prompt=body.prompt.strip(),
        frequency=body.frequency,
        day_of_week=body.day_of_week,
        day_of_month=body.day_of_month,
        hour=body.hour,
        minute=body.minute,
        enabled=body.enabled,
    )
    if task.enabled:
        _recompute(task)
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=ScheduledTaskOut)
async def update_scheduled_task(
    task_id: uuid.UUID,
    body: ScheduledTaskUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await _get_owned(db, task_id, user)
    data = body.model_dump(exclude_unset=True)
    if "frequency" in data and data["frequency"] is not None:
        _validate_frequency(data["frequency"])
    for key, value in data.items():
        setattr(task, key, value)
    # Re-derive the next run whenever the schedule or enabled flag changes.
    if task.enabled:
        _recompute(task)
    else:
        task.next_run_at = None
    await db.commit()
    await db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
async def delete_scheduled_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await _get_owned(db, task_id, user)
    await db.delete(task)
    await db.commit()


@router.post("/{task_id}/run", response_model=ScheduledTaskOut)
async def run_now(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Run a scheduled task immediately (also reschedules its next run)."""
    task = await _get_owned(db, task_id, user)
    await run_scheduled_task(db, task)
    await db.refresh(task)
    return task
