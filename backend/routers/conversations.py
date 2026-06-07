"""REST endpoints for conversations, messages, approvals, and notifications."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.enums import MessageRole
from models.db.user import User
from models.schemas.conversations import (
    ApprovalOut,
    ConversationCreate,
    ConversationOut,
    ConversationUpdate,
    MessageOut,
    NotificationOut,
    ResolveApprovalRequest,
)
from repositories.conversation_repo import (
    ApprovalRepository,
    ConversationRepository,
    MessageRepository,
    NotificationRepository,
)
from services.audit.logger import AuditLogger, get_audit_logger

router = APIRouter(prefix="/conversations", tags=["conversations"])
approvals_router = APIRouter(prefix="/approvals", tags=["approvals"])
notifications_router = APIRouter(prefix="/notifications", tags=["notifications"])


# ── Conversations ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    include_archived: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    repo = ConversationRepository(db)
    conversations = await repo.list_for_user(
        current_user.id,
        include_archived=include_archived,
        limit=limit,
        offset=offset,
    )
    return conversations


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    repo = ConversationRepository(db)
    conv = await repo.create(
        user_id=current_user.id,
        title=body.title,
        agent_type=body.agent_type,
    )
    await db.commit()
    return conv


@router.get("/{conv_id}", response_model=ConversationOut)
async def get_conversation(
    conv_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    repo = ConversationRepository(db)
    conv = await repo.get(conv_id, current_user.id)
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    return conv


@router.patch("/{conv_id}", response_model=ConversationOut)
async def update_conversation(
    conv_id: uuid.UUID,
    body: ConversationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    repo = ConversationRepository(db)
    conv = await repo.get(conv_id, current_user.id)
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    updates = body.model_dump(exclude_none=True)
    conv = await repo.update(conv, **updates)
    await db.commit()
    return conv


@router.get("/{conv_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conv_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    before_id: uuid.UUID | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    conv_repo = ConversationRepository(db)
    conv = await conv_repo.get(conv_id, current_user.id)
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    msg_repo = MessageRepository(db)
    return await msg_repo.list_for_conversation(conv_id, limit=limit, before_id=before_id)


# ── Approvals ─────────────────────────────────────────────────────────────────

@approvals_router.get("/pending", response_model=list[ApprovalOut])
async def list_pending_approvals(
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ApprovalOut]:
    repo = ApprovalRepository(db)
    return await repo.list_pending(current_user.id, limit=limit)


@approvals_router.get("/count", response_model=dict)
async def count_pending_approvals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    repo = ApprovalRepository(db)
    count = await repo.count_pending(current_user.id)
    return {"count": count}


async def _execute_approved_action(
    intent,
    db,
    current_user,
    audit: AuditLogger,
) -> dict:
    """
    Dispatch execution for known intent types after human approval.

    Supported:
      send_email           → gmail_send(to, subject, body)
      create_calendar_event → calendar_create_event(title, start, end, ...)

    All other intent types return {"status": "no_action", ...}.
    Execution failures are caught and returned as {"status": "error", "detail": "..."}.
    The approval decision is NEVER rolled back on execution failure.
    """
    itype = intent.intent_type
    payload = intent.intent_payload or {}

    try:
        if itype == "send_email":
            from services.google_service import gmail_send
            to = payload.get("to") or payload.get("recipient_email") or ""
            subject = payload.get("subject") or ""
            body = payload.get("body") or payload.get("draft_body") or ""
            if not to or not subject:
                return {
                    "status": "error",
                    "detail": "Payload is missing 'to' or 'subject' fields — cannot send.",
                }
            result = gmail_send(to=to, subject=subject, body=body)

            # If this came from an email draft, mark it sent
            draft_id_raw = payload.get("draft_id")
            if draft_id_raw:
                try:
                    import uuid as _uuid
                    from sqlalchemy import select as _select
                    from models.db.email_draft import EmailDraft
                    draft_uuid = _uuid.UUID(str(draft_id_raw))
                    row = (await db.execute(
                        _select(EmailDraft).where(EmailDraft.id == draft_uuid)
                    )).scalar_one_or_none()
                    if row:
                        row.status = "sent"
                        await db.commit()
                except Exception:
                    pass  # draft update is best-effort

            await audit.log(
                "approval.action_executed",
                actor_id=current_user.id,
                entity_type="approval_intent",
                entity_id=intent.id,
                payload={"intent_type": itype, "result": result},
            )
            await db.commit()
            return {"status": "executed", "action": "send_email", **result}

        if itype == "create_calendar_event":
            from services.google_service import calendar_create_event
            title = payload.get("title") or payload.get("summary") or "(No title)"
            start = payload.get("start") or payload.get("start_time") or ""
            end = payload.get("end") or payload.get("end_time") or ""
            if not start or not end:
                return {
                    "status": "error",
                    "detail": "Payload is missing 'start' or 'end' fields — cannot create event.",
                }
            result = calendar_create_event(
                title=title,
                start=start,
                end=end,
                description=payload.get("description", ""),
                location=payload.get("location", ""),
                attendees=payload.get("attendees") or [],
            )
            await audit.log(
                "approval.action_executed",
                actor_id=current_user.id,
                entity_type="approval_intent",
                entity_id=intent.id,
                payload={"intent_type": itype, "result": result},
            )
            await db.commit()
            return {"status": "executed", "action": "create_calendar_event", **result}

        # All other types: approved but no automated execution
        return {
            "status": "no_action",
            "detail": f"Intent type '{itype}' was approved but has no automated executor. Carry out the action manually.",
        }

    except Exception as exc:
        # Execution failure must not roll back the approval decision
        err_msg = str(exc)
        try:
            await audit.log(
                "approval.action_failed",
                actor_id=current_user.id,
                entity_type="approval_intent",
                entity_id=intent.id,
                payload={"intent_type": itype, "error": err_msg},
            )
            await db.commit()
        except Exception:
            pass
        return {"status": "error", "detail": err_msg}


@approvals_router.post("/{intent_id}/resolve", response_model=ApprovalOut)
async def resolve_approval(
    intent_id: uuid.UUID,
    body: ResolveApprovalRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    audit: AuditLogger = Depends(get_audit_logger),
) -> ApprovalOut:
    repo = ApprovalRepository(db)
    intent = await repo.get(intent_id, current_user.id)
    if intent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found.")
    if intent.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Approval is already {intent.status}.",
        )
    intent = await repo.resolve(
        intent,
        approved=body.approved,
        resolved_by=current_user.id,
        rejection_reason=body.rejection_reason,
    )
    await db.commit()

    # ── Audit log the human decision ─────────────────────────────────────────────────────
    decision = "approved" if body.approved else "rejected"
    await audit.log(
        f"approval.{decision}",
        actor_id=current_user.id,
        entity_type="approval_intent",
        entity_id=intent_id,
        payload={
            "intent_type": intent.intent_type,
            "intent_title": intent.intent_title,
            "risk_level": intent.risk_level,
            "rejection_reason": body.rejection_reason,
        },
    )
    await db.commit()

    # ── Execute the approved action ─────────────────────────────────────────────────────
    execution_result: dict | None = None
    if body.approved:
        execution_result = await _execute_approved_action(intent, db, current_user, audit)

    out = ApprovalOut.model_validate(intent)
    out.execution_result = execution_result
    return out


@approvals_router.delete("/expired", response_model=dict)
async def clear_expired_approvals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete all expired (and still 'pending') approval requests for the current user."""
    repo = ApprovalRepository(db)
    count = await repo.delete_expired(current_user.id)
    await db.commit()
    return {"deleted": count}


# ── Notifications ─────────────────────────────────────────────────────────────

@notifications_router.get("", response_model=list[NotificationOut])
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[NotificationOut]:
    repo = NotificationRepository(db)
    return await repo.list_for_user(current_user.id, unread_only=unread_only, limit=limit)


@notifications_router.post("/{notif_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_notification_read(
    notif_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    repo = NotificationRepository(db)
    await repo.mark_read(notif_id, current_user.id)
    await db.commit()


@notifications_router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    repo = NotificationRepository(db)
    await repo.mark_all_read(current_user.id)
    await db.commit()
