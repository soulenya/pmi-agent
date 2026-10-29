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
    start_background_run,
)
from services.scheduler.steps import StepError, normalise_steps

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
    last_run_files: list[str] | None = None
    last_run_links: list[str] | None = None
    steps: list[dict] | None = None
    conversation_id: uuid.UUID | None = None
    workroom_id: uuid.UUID | None = None
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
    workroom_id: uuid.UUID | None = None
    # The procedure: do / if-then-otherwise steps (services.scheduler.steps).
    steps: list[dict] | None = None


class ScheduledTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    prompt: str | None = Field(default=None, min_length=1)
    frequency: str | None = None
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    hour: int | None = Field(default=None, ge=0, le=23)
    minute: int | None = Field(default=None, ge=0, le=59)
    enabled: bool | None = None
    workroom_id: uuid.UUID | None = None
    steps: list[dict] | None = None


# ── helpers ───────────────────────────────────────────────────────────────

def _clean_steps(raw) -> list[dict] | None:
    try:
        steps = normalise_steps(raw)
    except StepError as exc:
        raise HTTPException(422, str(exc)) from exc
    return steps or None

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


async def _validate_workroom(
    db: AsyncSession, workroom_id: uuid.UUID | None, user: User
) -> None:
    if workroom_id is None:
        return
    from models.db.workroom import Workroom

    room = (
        await db.execute(
            select(Workroom).where(
                Workroom.id == workroom_id, Workroom.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if room is None:
        raise HTTPException(404, "Workroom not found")


def _recompute(task: ScheduledTask) -> None:
    task.next_run_at = compute_next_run(
        frequency=task.frequency,
        hour=task.hour,
        minute=task.minute,
        day_of_week=task.day_of_week,
        day_of_month=task.day_of_month,
    )


# ── endpoints ─────────────────────────────────────────────────────────────

async def _backfill_links(db: AsyncSession, task: ScheduledTask) -> None:
    """Links for a run recorded before ``last_run_links`` existed.

    The run's assistant message kept the "Open in Drive" chip its upload
    produced even when the closing text never repeated the address; read it
    back once and store it, so an existing weekly report is reachable from
    Today without waiting for its next run.
    """
    if task.last_run_links is not None or task.last_run_status != "success" or not task.conversation_id:
        return
    from models.db.conversation import Message
    from services.scheduler.runner import run_links

    row = (
        await db.execute(
            select(Message.tool_results, Message.content)
            .where(Message.conversation_id == task.conversation_id, Message.role == "assistant")
            .order_by(Message.created_at.desc())
            .limit(1)
        )
    ).first()
    links: list[str] = []
    if row is not None:
        for art in row[0] or []:
            url = art.get("url") if isinstance(art, dict) else None
            if url and url not in links:
                links.append(url)
        for url in run_links(row[1]):
            if url not in links:
                links.append(url)
    task.last_run_links = links  # [] marks "looked, nothing" so this runs once


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
    touched = False
    for task in rows:
        if task.last_run_links is None and task.last_run_status == "success" and task.conversation_id:
            await _backfill_links(db, task)
            touched = True
    if touched:
        await db.commit()
    return list(rows)


@router.post("", response_model=ScheduledTaskOut, status_code=201)
async def create_scheduled_task(
    body: ScheduledTaskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _validate_frequency(body.frequency)
    await _validate_workroom(db, body.workroom_id, user)
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
        workroom_id=body.workroom_id,
        steps=_clean_steps(body.steps),
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
    if "workroom_id" in data:
        await _validate_workroom(db, data["workroom_id"], user)
    if "steps" in data:
        data["steps"] = _clean_steps(data["steps"])
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


@router.post("/{task_id}/run", response_model=ScheduledTaskOut, status_code=202)
async def run_now(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start a scheduled task immediately in the background.

    Returns right away with the task marked ``running``; the run itself can take
    several minutes, so the UI polls the list endpoint for the outcome.
    """
    task = await _get_owned(db, task_id, user)
    if task.last_run_status == "running":
        raise HTTPException(409, "This task is already running")
    task.last_run_status = "running"
    await db.commit()
    await db.refresh(task)
    start_background_run(task.id)
    return task
