"""The company brain, for desktops: the hub asks GBrain on the caller's behalf.

GBrain is reachable only from the hub's own network, so a desktop's assistant
comes through here. Any signed-in colleague may read and record; who they are
is taken from this session, never from the request body.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services import brain_conversations as conversations
from services import company_brain as svc

router = APIRouter(prefix="/brain", tags=["brain"])


class RecallIn(BaseModel):
    question: str = Field(default="", max_length=svc.MAX_QUESTION_CHARS)
    subject: str | None = Field(default=None, max_length=svc.MAX_SUBJECT_CHARS)
    limit: int = Field(default=10, ge=1, le=svc.MAX_RECALL)


class RememberIn(BaseModel):
    fact: str = Field(min_length=1, max_length=svc.MAX_FACT_CHARS)
    subject: str = Field(min_length=1, max_length=svc.MAX_SUBJECT_CHARS)
    kind: Literal["fact", "commitment", "event", "preference", "belief"] = "fact"
    origin: Literal["user_said", "tool_output", "inferred"] = "user_said"
    replaces: str | None = Field(default=None, max_length=40)


class ForgetIn(BaseModel):
    fact_id: str = Field(min_length=1, max_length=40)


def _refused(exc: svc.BrainError) -> HTTPException:
    code = (
        status.HTTP_503_SERVICE_UNAVAILABLE
        if isinstance(exc, svc.BrainUnavailable)
        else status.HTTP_400_BAD_REQUEST
    )
    return HTTPException(status_code=code, detail=str(exc))


@router.post("/recall")
async def recall(
    body: RecallIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        # Facts are the company's; any stored chats that come back are only
        # ones this caller could open on the hub.
        return await conversations.recall_for_person(
            db, current_user.id, body.question, subject=body.subject, limit=body.limit
        )
    except svc.BrainError as exc:
        raise _refused(exc) from exc


@router.post("/conversations/{conv_id}/archive")
async def archive_conversation(
    conv_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Store a hub conversation in the brain now, rather than when it next goes quiet."""
    try:
        stored = await conversations.save_now_for(db, current_user.id, conv_id)
    except svc.BrainError as exc:
        raise _refused(exc) from exc
    await db.commit()
    return {"conversation_id": str(conv_id), "messages": stored}


@router.post("/remember")
async def remember(body: RememberIn, current_user: User = Depends(get_current_user)) -> dict:
    try:
        return await svc.remember(
            body.fact,
            body.subject,
            who=svc.who_label(current_user),
            kind=body.kind,
            origin=body.origin,
            replaces=body.replaces,
        )
    except svc.BrainError as exc:
        raise _refused(exc) from exc


@router.post("/forget")
async def forget(body: ForgetIn, current_user: User = Depends(get_current_user)) -> dict:
    try:
        return await svc.forget(body.fact_id, who=svc.who_label(current_user))
    except svc.BrainError as exc:
        raise _refused(exc) from exc
