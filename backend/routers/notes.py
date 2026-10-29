"""Personal notes — one person's, never anyone else's.

Every route is scoped to the signed-in user. There is no sharing, no admin
view and no project link: a note is a private thing you told Gerry (or typed)
to keep, for your own chats and your own routines to draw on.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services import notes as svc

router = APIRouter(prefix="/notes", tags=["notes"])


class NoteOut(BaseModel):
    id: uuid.UUID
    content: str
    source: str
    conversation_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None

    model_config = {"from_attributes": True}


class NoteCreate(BaseModel):
    content: str = Field(min_length=1, max_length=svc.MAX_NOTE_CHARS)
    source: str = Field(default="text", pattern="^(voice|text|gerry)$")
    conversation_id: uuid.UUID | None = None


class NoteUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=svc.MAX_NOTE_CHARS)
    archived: bool | None = None


@router.get("", response_model=list[NoteOut])
async def list_my_notes(
    q: str | None = Query(None, max_length=200),
    since: datetime | None = Query(None),
    include_archived: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[NoteOut]:
    rows = await svc.list_notes(
        db, current_user.id, since=since, query=q, include_archived=include_archived, limit=limit, offset=offset
    )
    return [NoteOut.model_validate(n) for n in rows]


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
async def create_my_note(
    body: NoteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NoteOut:
    try:
        note = await svc.create_note(
            db, current_user.id, body.content, source=body.source, conversation_id=body.conversation_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    await db.commit()
    return NoteOut.model_validate(note)


@router.patch("/{note_id}", response_model=NoteOut)
async def update_my_note(
    note_id: uuid.UUID,
    body: NoteUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NoteOut:
    try:
        note = await svc.update_note(
            db, current_user.id, note_id, content=body.content, archived=body.archived
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")
    await db.commit()
    return NoteOut.model_validate(note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_note(
    note_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    if not await svc.delete_note(db, current_user.id, note_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")
    await db.commit()
