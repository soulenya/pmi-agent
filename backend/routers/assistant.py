"""Daily assistant router.

Exposes the daily Gmail/Tasks assistant: review suggestions, approve/dismiss
them (creating Little Gerry tasks or keeping/removing imported meeting notes),
read/update the scan settings, and trigger a manual scan.
"""
from __future__ import annotations

import logging
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["assistant"])

_PRIORITY_MAP = {
    "low": TaskPriority.LOW.value,
    "medium": TaskPriority.MEDIUM.value,
    "high": TaskPriority.HIGH.value,
    "critical": TaskPriority.CRITICAL.value,
}

# Suggestion source_type → the task source kinds the UI knows how to open.
_SOURCE_KIND_MAP = {
    "gmail_thread": "gmail_thread",
    "gmail_message": "gmail_thread",
    "gmail_attachment": "kb_doc",
    "gmail_invoice": "gmail_thread",
    "drive_doc": "kb_doc",
    "chat_conversation": "conversation",
    "google_task": "google_task",
    "workroom": "workroom",
}


def _task_source_ref(s: AssistantSuggestion) -> dict | None:
    """What an accepted suggestion's task is ABOUT, so the task can open it."""
    payload = s.payload or {}
    if s.source_type == "workroom" and payload.get("workroom_id"):
        return {
            "kind": "workroom",
            "id": str(payload["workroom_id"]),
            "label": str(payload.get("workroom_title") or "Workroom")[:200],
            "url": None,
        }
    kind = _SOURCE_KIND_MAP.get(s.source_type)
    ident = ""
    if kind == "gmail_thread":
        ident = str(payload.get("thread_id") or "")
    elif kind == "kb_doc":
        ident = str(payload.get("document_id") or "")
    elif kind == "conversation":
        ident = str(payload.get("conversation_id") or "")
    if not ident and kind:
        # daily-scan dedup anchors are prefixed ("thread:<id>", "conv:<id>")
        raw = str(s.source_id or "")
        ident = raw.split(":", 1)[1] if raw.startswith(("thread:", "conv:")) else raw
    if kind and ident:
        return {"kind": kind, "id": ident[:255], "label": s.title[:200], "url": s.source_url}
    # Anything else with a link (Odoo alerts, external records) still opens.
    if s.source_url:
        return {"kind": "url", "id": "", "label": s.title[:200], "url": s.source_url}
    return None


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
    dismissal_count: int = 0
    created_at: datetime
    resolved_at: datetime | None = None

    class Config:
        from_attributes = True


class AcceptResult(BaseModel):
    status: str
    suggestion_id: uuid.UUID
    task_id: uuid.UUID | None = None


class BulkSuggestionRequest(BaseModel):
    ids: list[uuid.UUID]
    action: str  # "complete" | "dismiss"


class BulkResult(BaseModel):
    processed: int
    skipped: int


class KindStats(BaseModel):
    kind: str
    pending: int = 0
    accepted: int = 0
    dismissed: int = 0
    completed: int = 0


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
    from config import settings as app_settings
    from services import user_settings

    if app_settings.hub_mode:
        # Everyone keeps their own schedule; the system values are the default.
        enabled = await daily_scan.get_user_setting(
            db, _user, daily_scan.SETTING_ENABLED, daily_scan.DEFAULT_ENABLED
        )
        hour = await daily_scan.get_user_setting(
            db, _user, daily_scan.SETTING_HOUR, daily_scan.DEFAULT_HOUR
        )
        last_run = await user_settings.get(
            db, _user.id, daily_scan.SETTING_LAST_RUN, None
        )
    else:
        enabled = await daily_scan.get_setting(
            db, daily_scan.SETTING_ENABLED, daily_scan.DEFAULT_ENABLED
        )
        hour = await daily_scan.get_setting(db, daily_scan.SETTING_HOUR, daily_scan.DEFAULT_HOUR)
        last_run = await daily_scan.get_setting(db, daily_scan.SETTING_LAST_RUN, None)
    return AssistantSettings(enabled=bool(enabled), hour_local=int(hour), last_run=last_run)


@router.put("/settings", response_model=AssistantSettings)
async def update_settings(
    body: AssistantSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from config import settings as app_settings
    from services import user_settings

    if app_settings.hub_mode:
        if body.enabled is not None:
            await user_settings.set_value(
                db, user.id, daily_scan.SETTING_ENABLED, bool(body.enabled)
            )
        if body.hour_local is not None:
            hour = max(0, min(23, int(body.hour_local)))
            await user_settings.set_value(db, user.id, daily_scan.SETTING_HOUR, hour)
    else:
        if body.enabled is not None:
            await daily_scan.set_setting(
                db, daily_scan.SETTING_ENABLED, bool(body.enabled), user.id
            )
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


@router.get("/suggestions/stats", response_model=list[KindStats])
async def suggestion_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-kind accept/dismiss history — the UI ranks categories by it."""
    rows = (
        await db.execute(
            select(
                AssistantSuggestion.kind,
                AssistantSuggestion.status,
                func.count(AssistantSuggestion.id),
            )
            .where(AssistantSuggestion.user_id == user.id)
            .group_by(AssistantSuggestion.kind, AssistantSuggestion.status)
        )
    ).all()

    tally: dict[str, dict[str, int]] = {}
    for kind, status, count in rows:
        bucket = tally.setdefault(
            kind, {"pending": 0, "accepted": 0, "dismissed": 0, "completed": 0}
        )
        if status in bucket:
            bucket[status] += int(count or 0)
    return [KindStats(kind=kind, **counts) for kind, counts in tally.items()]


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

    if s.kind in ("task_recommendation", "followup_email", "workroom_todo"):
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
            "source_ref": _task_source_ref(s),
        }
        due_in = task.get("due_in_days")
        if isinstance(due_in, (int, float)) and due_in >= 0:
            fields["due_date"] = datetime.now(timezone.utc) + timedelta(days=int(due_in))
        created = await TaskRepository(db).create(created_by=user.id, **fields)
        task_id = created.id
        s.result_entity_type = "task"
        s.result_entity_id = created.id

        # A workroom to-do lives in its room: pin the task + journal the accept.
        if s.kind == "workroom_todo":
            try:
                from models.db.workroom import Workroom
                from services.workroom_context import add_journal_entry, pin_workroom_item

                room_id = (s.payload or {}).get("workroom_id")
                room = None
                if room_id:
                    room = (
                        await db.execute(
                            select(Workroom).where(
                                Workroom.id == uuid.UUID(str(room_id)),
                                Workroom.user_id == user.id,
                            )
                        )
                    ).scalar_one_or_none()
                if room is not None:
                    await pin_workroom_item(db, room, "task", title, str(created.id))
                    await add_journal_entry(db, room, f"Accepted next step: {title}")
            except Exception:  # noqa: BLE001 — room bookkeeping is best-effort
                logger.exception("Failed to journal workroom_todo accept")

    # meeting_import: accepting means "keep it" — the document is already in the KB.
    # followup_task: accepting means "acknowledged".

    # budget_entry: accepting writes the suggested entry into the budget's
    # sheet. The accept click IS the user's explicit action, so it does not
    # require the per-budget Gerry grant (external linked sheets stay
    # read-only — the service refuses those).
    if s.kind == "budget_entry":
        from models.db.budget import Budget
        from services import budget_service as bs

        payload = s.payload or {}
        entry = payload.get("entry") or {}
        budget = None
        if payload.get("budget_id"):
            budget = (
                await db.execute(
                    select(Budget).where(
                        Budget.id == uuid.UUID(str(payload["budget_id"])),
                        Budget.user_id == user.id,
                    )
                )
            ).scalar_one_or_none()
        if budget is None:
            raise HTTPException(410, "That budget no longer exists — dismiss this suggestion.")
        if entry.get("amount") is None or not str(entry.get("description", "")).strip():
            raise HTTPException(400, "The suggestion has no usable entry data.")
        try:
            await bs.add_entry(
                db,
                budget,
                date=str(entry.get("date", "")) or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                description=str(entry["description"]),
                amount=float(entry["amount"]),
                category=str(entry.get("category", "") or ""),
                note=str(entry.get("note", "") or ""),
                source="gerry",
            )
        except bs.BudgetError as exc:
            raise HTTPException(409, str(exc)) from exc
        s.result_entity_type = "budget"
        s.result_entity_id = budget.id

    # gmail_invoice: accepting files the email attachment into the budget's
    # linked invoice folder (when one exists) and adds the ledger entry when
    # an amount was readable. Suggest-first: nothing happened until this click.
    if s.kind == "gmail_invoice":
        import asyncio

        from models.db.budget import Budget, BudgetFolder
        from services import budget_service as bs
        from services import google_service as gs

        payload = s.payload or {}
        entry = payload.get("entry") or {}
        budget = None
        if payload.get("budget_id"):
            budget = (
                await db.execute(
                    select(Budget).where(
                        Budget.id == uuid.UUID(str(payload["budget_id"])),
                        Budget.user_id == user.id,
                    )
                )
            ).scalar_one_or_none()
        if budget is None:
            raise HTTPException(410, "That budget no longer exists — dismiss this suggestion.")
        filed_to = None
        message_id = str(payload.get("message_id") or "")
        want_name = str(payload.get("attachment_filename") or "")
        folder = None
        if payload.get("folder_row_id"):
            folder = (
                await db.execute(
                    select(BudgetFolder).where(
                        BudgetFolder.id == uuid.UUID(str(payload["folder_row_id"])),
                        BudgetFolder.budget_id == budget.id,
                    )
                )
            ).scalar_one_or_none()
        if folder is not None and message_id and want_name:
            try:
                loop = asyncio.get_event_loop()
                atts = await loop.run_in_executor(None, lambda: gs.gmail_get_attachments(message_id))
                att = next((a for a in atts if a["filename"] == want_name), None)
                if att is not None:
                    uploaded = await loop.run_in_executor(
                        None,
                        lambda: gs.drive_upload_bytes(
                            att["data"], att["filename"], att.get("mime_type") or None, folder.folder_id
                        ),
                    )
                    filed_to = uploaded.get("url", "")
                    # Register it so a folder scan doesn't re-suggest the same doc.
                    reg = dict(folder.scanned_files or {})
                    reg[uploaded.get("id", "")] = {
                        "name": att["filename"],
                        "status": "filed_from_gmail",
                        "amount": entry.get("amount"),
                        "scanned_at": datetime.now(timezone.utc).isoformat(),
                    }
                    folder.scanned_files = reg
            except Exception:  # noqa: BLE001 — filing is best-effort, entry still counts
                logger.exception("gmail_invoice accept: filing to folder failed")
        if entry.get("amount") is not None and str(entry.get("description", "")).strip():
            try:
                await bs.add_entry(
                    db,
                    budget,
                    date=str(entry.get("date", "")) or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    description=str(entry["description"]),
                    amount=float(entry["amount"]),
                    category=str(entry.get("category", "") or ""),
                    note=(str(entry.get("note", "") or "") + (f" Filed: {filed_to}" if filed_to else "")).strip(),
                    source="gerry",
                )
            except bs.BudgetError as exc:
                raise HTTPException(409, str(exc)) from exc
        elif filed_to is None and folder is None:
            raise HTTPException(
                400,
                "No amount was readable and this budget has no linked invoice folder — nothing to do.",
            )
        s.result_entity_type = "budget"
        s.result_entity_id = budget.id

    s.status = "accepted"
    s.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return AcceptResult(status="accepted", suggestion_id=s.id, task_id=task_id)


async def _dismiss_row(
    db: AsyncSession, s: AssistantSuggestion, embedding_svc: EmbeddingService
) -> None:
    """Mark a pending suggestion dismissed (shared by single + bulk routes)."""
    # Dismissing an import removes the document that was auto-added to the KB.
    if s.kind == "meeting_import" and s.result_entity_type == "document" and s.result_entity_id:
        try:
            from services.documents.ingestion import DocumentIngestionService

            await DocumentIngestionService(db=db, embedding_svc=embedding_svc).delete(s.result_entity_id)
        except Exception:
            # Document may have been removed already; proceed with dismissal.
            pass

    s.status = "dismissed"
    s.dismissal_count = (s.dismissal_count or 0) + 1
    s.resolved_at = datetime.now(timezone.utc)


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

    await _dismiss_row(db, s, embedding_svc)
    await db.commit()
    return AcceptResult(status="dismissed", suggestion_id=s.id)


@router.post("/suggestions/{suggestion_id}/complete", response_model=AcceptResult)
async def complete_suggestion(
    suggestion_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a suggestion as already done.

    Unlike dismissal (which resurfaces once to guard against accidents), a
    completed suggestion is permanently suppressed — future scans will never
    recommend the same item again.
    """
    s = await _get_owned(db, user, suggestion_id)
    if s.status != "pending":
        raise HTTPException(409, f"Suggestion already {s.status}")

    s.status = "completed"
    s.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return AcceptResult(status="completed", suggestion_id=s.id)


@router.post("/suggestions/bulk", response_model=BulkResult)
async def bulk_resolve_suggestions(
    body: BulkSuggestionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
):
    """Complete or dismiss many pending suggestions in one call."""
    if body.action not in ("complete", "dismiss"):
        raise HTTPException(400, "action must be 'complete' or 'dismiss'")

    processed = 0
    skipped = 0
    now = datetime.now(timezone.utc)
    for sid in body.ids[:200]:
        s = (
            await db.execute(
                select(AssistantSuggestion).where(
                    AssistantSuggestion.id == sid,
                    AssistantSuggestion.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if s is None or s.status != "pending":
            skipped += 1
            continue
        if body.action == "complete":
            s.status = "completed"
            s.resolved_at = now
        else:
            await _dismiss_row(db, s, embedding_svc)
        processed += 1
    await db.commit()
    return BulkResult(processed=processed, skipped=skipped)


@router.post("/suggestions/{suggestion_id}/undo-dismiss", response_model=AcceptResult)
async def undo_dismiss_suggestion(
    suggestion_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revert an accidental dismissal back to pending.

    Decrements the dismissal counter so the undo also undoes the "dismissed
    twice → suppress forever" progression. (A dismissed ``meeting_import`` may
    have removed its imported document; that document is re-imported by the next
    scan when the suggestion resurfaces, not here.)
    """
    s = await _get_owned(db, user, suggestion_id)
    if s.status != "dismissed":
        raise HTTPException(409, f"Suggestion is {s.status}, not dismissed")

    s.status = "pending"
    s.dismissal_count = max(0, (s.dismissal_count or 0) - 1)
    s.resolved_at = None
    await db.commit()
    return AcceptResult(status="pending", suggestion_id=s.id)


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
