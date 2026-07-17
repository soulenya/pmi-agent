"""Workrooms API — persistent per-user co-work spaces with Gerry.

A Workroom bundles a goal, pinned artifacts, a dedicated conversation, and a
progress journal. Creating a room also creates its conversation; chatting in
that conversation gets the WORKROOM CONTEXT block injected on every turn
(services/workroom_context.py).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from models.db.workroom import (
    WORKROOM_ITEM_KINDS,
    Workroom,
    WorkroomItem,
    WorkroomJournalEntry,
)
from repositories.conversation_repo import ConversationRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workrooms", tags=["workrooms"])


# ── Schemas ──────────────────────────────────────────────────────────────


class WorkroomCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    goal: str = Field("", max_length=4000)


class WorkroomUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    goal: str | None = Field(None, max_length=4000)
    status: str | None = Field(None, pattern="^(active|archived)$")


class ItemCreate(BaseModel):
    kind: str
    ref_id: str = Field("", max_length=500)
    label: str = Field(..., min_length=1, max_length=300)


class JournalCreate(BaseModel):
    entry: str = Field(..., min_length=1, max_length=4000)


class ItemOut(BaseModel):
    id: uuid.UUID
    kind: str
    ref_id: str
    label: str
    created_at: datetime

    model_config = {"from_attributes": True}


class JournalOut(BaseModel):
    id: uuid.UUID
    entry: str
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkroomOut(BaseModel):
    id: uuid.UUID
    title: str
    goal: str
    status: str
    conversation_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    item_count: int = 0

    model_config = {"from_attributes": True}


class WorkroomDetailOut(WorkroomOut):
    items: list[ItemOut] = []
    journal: list[JournalOut] = []


# ── Helpers ──────────────────────────────────────────────────────────────


async def _get_owned_room(db: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> Workroom:
    room = (
        await db.execute(
            select(Workroom).where(Workroom.id == room_id, Workroom.user_id == user_id)
        )
    ).scalar_one_or_none()
    if room is None:
        raise HTTPException(404, "Workroom not found")
    return room


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("", response_model=list[WorkroomOut])
async def list_workrooms(
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WorkroomOut]:
    stmt = (
        select(Workroom, func.count(WorkroomItem.id))
        .outerjoin(WorkroomItem, WorkroomItem.workroom_id == Workroom.id)
        .where(Workroom.user_id == current_user.id)
        .group_by(Workroom.id)
        .order_by(desc(Workroom.updated_at))
    )
    if not include_archived:
        stmt = stmt.where(Workroom.status == "active")
    rows = (await db.execute(stmt)).all()
    out = []
    for room, count in rows:
        item = WorkroomOut.model_validate(room)
        item.item_count = int(count or 0)
        out.append(item)
    return out


@router.post("", response_model=WorkroomOut, status_code=status.HTTP_201_CREATED)
async def create_workroom(
    body: WorkroomCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkroomOut:
    # Every room gets its own conversation — chatting there carries the
    # WORKROOM CONTEXT block on every turn.
    conv = await ConversationRepository(db).create(
        user_id=current_user.id, title=f"Workroom: {body.title.strip()}"
    )
    room = Workroom(
        user_id=current_user.id,
        title=body.title.strip(),
        goal=body.goal.strip(),
        conversation_id=conv.id,
    )
    db.add(room)
    await db.flush()
    await db.refresh(room)
    await db.commit()
    return WorkroomOut.model_validate(room)


@router.get("/{room_id}", response_model=WorkroomDetailOut)
async def get_workroom(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkroomDetailOut:
    room = await _get_owned_room(db, room_id, current_user.id)
    items = list(
        (
            await db.execute(
                select(WorkroomItem)
                .where(WorkroomItem.workroom_id == room.id)
                .order_by(WorkroomItem.created_at)
            )
        ).scalars()
    )
    journal = list(
        (
            await db.execute(
                select(WorkroomJournalEntry)
                .where(WorkroomJournalEntry.workroom_id == room.id)
                .order_by(desc(WorkroomJournalEntry.created_at))
                .limit(50)
            )
        ).scalars()
    )
    out = WorkroomDetailOut.model_validate(room)
    out.item_count = len(items)
    out.items = [ItemOut.model_validate(i) for i in items]
    out.journal = [JournalOut.model_validate(j) for j in journal]
    return out


@router.patch("/{room_id}", response_model=WorkroomOut)
async def update_workroom(
    room_id: uuid.UUID,
    body: WorkroomUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkroomOut:
    room = await _get_owned_room(db, room_id, current_user.id)
    if body.title is not None:
        room.title = body.title.strip()
    if body.goal is not None:
        room.goal = body.goal.strip()
    if body.status is not None:
        room.status = body.status
    await db.flush()
    await db.refresh(room)
    await db.commit()
    return WorkroomOut.model_validate(room)


@router.delete("/{room_id}")
async def delete_workroom(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    room = await _get_owned_room(db, room_id, current_user.id)
    await db.delete(room)
    await db.commit()
    return {"deleted": str(room_id)}


@router.post("/{room_id}/items", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
async def add_item(
    room_id: uuid.UUID,
    body: ItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ItemOut:
    room = await _get_owned_room(db, room_id, current_user.id)
    kind = body.kind.strip().lower()
    if kind not in WORKROOM_ITEM_KINDS:
        raise HTTPException(422, f"kind must be one of: {', '.join(WORKROOM_ITEM_KINDS)}")
    item = WorkroomItem(
        workroom_id=room.id, kind=kind, ref_id=body.ref_id.strip(), label=body.label.strip()
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    await db.commit()
    return ItemOut.model_validate(item)


@router.delete("/{room_id}/items/{item_id}")
async def remove_item(
    room_id: uuid.UUID,
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    room = await _get_owned_room(db, room_id, current_user.id)
    item = (
        await db.execute(
            select(WorkroomItem).where(
                WorkroomItem.id == item_id, WorkroomItem.workroom_id == room.id
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Item not found")
    await db.delete(item)
    await db.commit()
    return {"deleted": str(item_id)}


@router.post(
    "/{room_id}/journal", response_model=JournalOut, status_code=status.HTTP_201_CREATED
)
async def add_journal_entry(
    room_id: uuid.UUID,
    body: JournalCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JournalOut:
    room = await _get_owned_room(db, room_id, current_user.id)
    entry = WorkroomJournalEntry(workroom_id=room.id, entry=body.entry.strip())
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    await db.commit()
    return JournalOut.model_validate(entry)
