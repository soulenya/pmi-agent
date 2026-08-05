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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
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
    share_file_id: str | None = None
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
    from services.workroom_context import add_journal_entry, record_goal_change

    room = await _get_owned_room(db, room_id, current_user.id)
    # Journal edits made here: Gerry only ever sees the current row, so an
    # unrecorded goal change leaves her insisting the goal never moved.
    actor = f"{current_user.display_name or current_user.email} (edited directly in the app, not through you)"
    if body.title is not None and body.title.strip() != room.title:
        await add_journal_entry(
            db, room, f'Room renamed by {actor}: "{room.title}" → "{body.title.strip()}"'
        )
        room.title = body.title.strip()
    if body.goal is not None:
        await record_goal_change(db, room, room.goal, body.goal.strip(), actor)
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


@router.post("/{room_id}/upload", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
async def upload_room_file(
    room_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ItemOut:
    """Upload a file into the room: stored in generated_files and pinned as an item."""
    from services.file_uploads import MAX_UPLOAD_BYTES, store_upload

    room = await _get_owned_room(db, room_id, current_user.id)

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "The file is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.")

    safe_name, display = store_upload(raw, file.filename)
    item = WorkroomItem(
        workroom_id=room.id, kind="generated_file", ref_id=safe_name, label=display
    )
    db.add(item)
    db.add(WorkroomJournalEntry(workroom_id=room.id, entry=f"File added: {display}"))
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


# ── Sharing — room manifests on the shared Drive (Phase 4) ────────────────


@router.get("/shared/available")
async def list_shared_rooms(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    from services.workroom_share import ShareError, list_shared_manifests

    try:
        return await list_shared_manifests(db, current_user.id)
    except ShareError as exc:
        raise HTTPException(400, str(exc))


@router.post("/shared/{file_id}/join", response_model=WorkroomOut, status_code=201)
async def join_shared_room(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkroomOut:
    from services.workroom_share import ShareError, join_shared

    try:
        room = await join_shared(db, current_user.id, file_id)
    except ShareError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return WorkroomOut.model_validate(room)


@router.post("/{room_id}/share")
async def share_room(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    from services.workroom_share import ShareError, push_room

    room = await _get_owned_room(db, room_id, current_user.id)
    try:
        result = await push_room(db, room)
    except ShareError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return result


@router.post("/{room_id}/pull")
async def pull_shared_room(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    from services.workroom_share import ShareError, pull_room

    room = await _get_owned_room(db, room_id, current_user.id)
    try:
        result = await pull_room(db, room)
    except ShareError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return result
