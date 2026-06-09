"""Daily assistant router.

Exposes the daily Gmail/Tasks assistant: review suggestions, approve/dismiss
them (creating Little Gerry tasks or keeping/removing imported meeting notes),
read/update the scan settings, and trigger a manual scan.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.assistant import AssistantSuggestion
from models.db.enums import TaskPriority, TaskStatus
from models.db.user import User
from repositories.task_repo import TaskRepository
from services.assistant import daily_scan
from services.embeddings.service import EmbeddingService, get_embedding_service_db

router = APIRouter(prefix="/assistant", tags=["assistant"])

_PRIORITY_MAP = {
    "low": TaskPriority.LOW.value,
    "medium": TaskPriority.MEDIUM.value,
    "high": TaskPriority.HIGH.value,
    "critical": TaskPriority.CRITICAL.value,
}


# ── schemas ───────────────────────────────────────────────────────────────

class SuggestionOut(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    title: str
    summary: str | None = None
    source_type: str
    source_id: str
    source_url: str | None = None
    payload: dict[str, Any]
    result_entity_type: str | None = None
    result_entity_id: uuid.UUID | None = None
    created_at: datetime
    resolved_at: datetime | None = None

    class Config:
        from_attributes = True


class AcceptResult(BaseModel):
    status: str
    suggestion_id: uuid.UUID
    task_id: uuid.UUID | None = None


class AssistantSettings(BaseModel):
    enabled: bool
    hour_local: int
    last_run: str | None = None


class AssistantSettingsUpdate(BaseModel):
    enabled: bool | None = None
    hour_local: int | None = None


# ── settings ──────────────────────────────────────────────────────────────

@router.get("/settings", response_model=AssistantSettings)
async def get_settings(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    enabled = await daily_scan.get_setting(db, daily_scan.SETTING_ENABLED, daily_scan.DEFAULT_ENABLED)
    hour = await daily_scan.get_setting(db, daily_scan.SETTING_HOUR, daily_scan.DEFAULT_HOUR)
    last_run = await daily_scan.get_setting(db, daily_scan.SETTING_LAST_RUN, None)
    return AssistantSettings(enabled=bool(enabled), hour_local=int(hour), last_run=last_run)


@router.put("/settings", response_model=AssistantSettings)
async def update_settings(
    body: AssistantSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.enabled is not None:
        await daily_scan.set_setting(db, daily_scan.SETTING_ENABLED, bool(body.enabled), user.id)
    if body.hour_local is not None:
        hour = max(0, min(23, int(body.hour_local)))
        await daily_scan.set_setting(db, daily_scan.SETTING_HOUR, hour, user.id)
    await db.commit()
    return await get_settings(_user=user, db=db)


# ── suggestions ───────────────────────────────────────────────────────────

@router.get("/suggestions", response_model=list[SuggestionOut])
async def list_suggestions(
    status: str = Query("pending"),
    kind: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(AssistantSuggestion)
        .where(AssistantSuggestion.user_id == user.id)
        .order_by(AssistantSuggestion.created_at.desc())
        .limit(200)
    )
    if status and status != "all":
        stmt = stmt.where(AssistantSuggestion.status == status)
    if kind:
        stmt = stmt.where(AssistantSuggestion.kind == kind)
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows)


@router.get("/suggestions/count")
async def count_pending(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count = (
        await db.execute(
            select(func.count(AssistantSuggestion.id)).where(
                AssistantSuggestion.user_id == user.id,
                AssistantSuggestion.status == "pending",
            )
        )
    ).scalar_one()
    return {"pending": int(count or 0)}


async def _get_owned(db: AsyncSession, user: User, suggestion_id: uuid.UUID) -> AssistantSuggestion:
    s = (
        await db.execute(
            select(AssistantSuggestion).where(
                AssistantSuggestion.id == suggestion_id,
                AssistantSuggestion.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if s is None:
        raise HTTPException(404, "Suggestion not found")
    return s


@router.post("/suggestions/{suggestion_id}/accept", response_model=AcceptResult)
async def accept_suggestion(
    suggestion_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_owned(db, user, suggestion_id)
    if s.status != "pending":
        raise HTTPException(409, f"Suggestion already {s.status}")

    task_id: uuid.UUID | None = None

    if s.kind in ("task_recommendation", "followup_email"):
        task = (s.payload or {}).get("task") or {}
        title = (task.get("title") or s.title or "Task").strip()[:500]
        if not title:
            raise HTTPException(400, "No task title available to create a task")
        priority = _PRIORITY_MAP.get(str(task.get("priority", "medium")).lower(), TaskPriority.MEDIUM.value)
        fields: dict[str, Any] = {
            "title": title,
            "description": task.get("description") or s.summary or "",
            "priority": priority,
            "status": TaskStatus.TODO.value,
        }
        due_in = task.get("due_in_days")
        if isinstance(due_in, (int, float)) and due_in >= 0:
            fields["due_date"] = datetime.now(timezone.utc) + timedelta(days=int(due_in))
        created = await TaskRepository(db).create(created_by=user.id, **fields)
        task_id = created.id
        s.result_entity_type = "task"
        s.result_entity_id = created.id

    # meeting_import: accepting means "keep it" — the document is already in the KB.
    # followup_task: accepting means "acknowledged".

    s.status = "accepted"
    s.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return AcceptResult(status="accepted", suggestion_id=s.id, task_id=task_id)


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=AcceptResult)
async def dismiss_suggestion(
    suggestion_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
):
    s = await _get_owned(db, user, suggestion_id)
    if s.status != "pending":
        raise HTTPException(409, f"Suggestion already {s.status}")

    # Dismissing an import removes the document that was auto-added to the KB.
    if s.kind == "meeting_import" and s.result_entity_type == "document" and s.result_entity_id:
        try:
            from services.documents.ingestion import DocumentIngestionService

            await DocumentIngestionService(db=db, embedding_svc=embedding_svc).delete(s.result_entity_id)
        except Exception:
            # Document may have been removed already; proceed with dismissal.
            pass

    s.status = "dismissed"
    s.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return AcceptResult(status="dismissed", suggestion_id=s.id)


# ── manual scan ───────────────────────────────────────────────────────────

@router.post("/scan")
async def trigger_scan(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
):
    """Run the daily scan now (manual trigger)."""
    result = await daily_scan.run_daily_scan(db, embedding_svc)
    try:
        from main import notification_manager

        for n in result.get("notifications", []):
            await notification_manager.push(
                n["user_id"], {"type": "assistant_suggestion", "title": n["title"]}
            )
    except Exception:
        pass
    return {
        "created": result.get("created", 0),
        "imported": result.get("imported", 0),
        "skipped": result.get("skipped"),
    }
