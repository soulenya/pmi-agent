"""Team chat — people talking to people.

Runs on the hub; the desktop reaches it through ``/hub/api/team/...``. Four
channel kinds: ``global`` (everyone signed in), ``project`` (everyone with a
role on the project), ``group`` (a named list of people), ``dm`` (two people).

Nothing here pushes to a desktop — the hub cannot call back — so the client
polls: the channel list for unread counts, the open channel for new rows.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from dependencies import get_current_user
from models.db.enums import NotificationType
from models.db.project_member import ProjectMember
from models.db.task import Project
from models.db.team_chat import TeamChannel, TeamChannelMember, TeamMessage
from models.db.user import User
from repositories.conversation_repo import NotificationRepository
from services.projects.access import resolve_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/team", tags=["team"])

GLOBAL_CHANNEL_NAME = "Everyone"
MAX_MESSAGE_CHARS = 20_000
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
PAGE_SIZE = 50

_SAFE_NAME = re.compile(r"^[0-9a-f]{32}_[\w.\-]+$")


def _attachments_dir() -> Path:
    """Beside the document store, so the hub's data volume keeps it."""
    root = Path(settings.storage_root).expanduser()
    d = root.parent / "team_attachments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── schemas ───────────────────────────────────────────────────────────────

class PersonOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str


class ChannelOut(BaseModel):
    id: uuid.UUID
    kind: str
    name: str
    project_id: uuid.UUID | None = None
    members: list[PersonOut] = []
    unread: int = 0
    last_message_at: datetime | None = None
    last_message_preview: str | None = None
    created_by: uuid.UUID | None = None


class ChannelCreate(BaseModel):
    kind: str = Field(pattern="^(group|dm)$")
    name: str = ""
    member_ids: list[uuid.UUID] = []


class ChannelUpdate(BaseModel):
    name: str | None = None
    add_member_ids: list[uuid.UUID] = []
    remove_member_ids: list[uuid.UUID] = []


class AttachmentOut(BaseModel):
    id: str
    name: str
    size: int
    mime: str


class AttachmentIn(BaseModel):
    filename: str
    mime: str = "application/octet-stream"
    data_b64: str


class RefIn(BaseModel):
    kind: str = Field(max_length=40)
    id: str = Field(default="", max_length=255)
    label: str = Field(max_length=200)
    route: str | None = Field(default=None, max_length=500)
    url: str | None = Field(default=None, max_length=2000)


class MessageIn(BaseModel):
    content: str = Field(default="", max_length=MAX_MESSAGE_CHARS)
    attachments: list[AttachmentOut] = []
    refs: list[RefIn] = []
    mention_ids: list[uuid.UUID] = []


class MessageEdit(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class MessageOut(BaseModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    author: PersonOut | None = None
    mine: bool = False
    content: str
    attachments: list[dict] = []
    refs: list[dict] = []
    mentions: list[uuid.UUID] = []
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    created_at: datetime


class UnreadOut(BaseModel):
    total: int
    channels: dict[str, int]


# ── access ────────────────────────────────────────────────────────────────

def _person(u: User) -> PersonOut:
    return PersonOut(id=u.id, email=u.email, display_name=u.display_name or u.email)


async def _people_by_id(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, User]:
    if not ids:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {u.id: u for u in rows}


async def _channel_or_404(db: AsyncSession, channel_id: uuid.UUID) -> TeamChannel:
    ch = (
        await db.execute(select(TeamChannel).where(TeamChannel.id == channel_id))
    ).scalar_one_or_none()
    if ch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such channel.")
    return ch


async def _is_member_row(db: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    row = (
        await db.execute(
            select(TeamChannelMember.user_id).where(
                TeamChannelMember.channel_id == channel_id,
                TeamChannelMember.user_id == user_id,
            )
        )
    ).first()
    return row is not None


async def _can_read(db: AsyncSession, ch: TeamChannel, user: User) -> bool:
    if ch.kind == "global":
        return True
    if ch.kind == "project":
        if ch.project_id is None:
            return False
        project = (
            await db.execute(select(Project).where(Project.id == ch.project_id))
        ).scalar_one_or_none()
        if project is None:
            return False
        return await resolve_role(db, project, user.id) is not None
    return await _is_member_row(db, ch.id, user.id)


async def _require_read(db: AsyncSession, channel_id: uuid.UUID, user: User) -> TeamChannel:
    ch = await _channel_or_404(db, channel_id)
    if not await _can_read(db, ch, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not in that channel.")
    return ch


async def _ensure_marker(db: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID) -> TeamChannelMember:
    """The read-marker row for this person in this channel, created if missing."""
    row = (
        await db.execute(
            select(TeamChannelMember).where(
                TeamChannelMember.channel_id == channel_id,
                TeamChannelMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = TeamChannelMember(channel_id=channel_id, user_id=user_id)
        db.add(row)
        await db.flush()
    return row


async def _ensure_global(db: AsyncSession) -> TeamChannel:
    ch = (
        await db.execute(select(TeamChannel).where(TeamChannel.kind == "global"))
    ).scalar_one_or_none()
    if ch is None:
        ch = TeamChannel(kind="global", name=GLOBAL_CHANNEL_NAME)
        db.add(ch)
        await db.flush()
    return ch


async def _channel_people(db: AsyncSession, ch: TeamChannel) -> list[PersonOut]:
    """Who is in a channel. Global/project channels list everyone who can read."""
    if ch.kind == "global":
        rows = (
            await db.execute(select(User).where(User.is_active.is_(True)).order_by(User.display_name))
        ).scalars().all()
        return [_person(u) for u in rows]
    if ch.kind == "project" and ch.project_id is not None:
        project = (
            await db.execute(select(Project).where(Project.id == ch.project_id))
        ).scalar_one_or_none()
        if project is None:
            return []
        if project.visibility == "company":
            rows = (
                await db.execute(
                    select(User).where(User.is_active.is_(True)).order_by(User.display_name)
                )
            ).scalars().all()
            return [_person(u) for u in rows]
        ids = set(
            (
                await db.execute(
                    select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)
                )
            ).scalars().all()
        )
        for legacy in (project.owner_id, project.created_by):
            if legacy:
                ids.add(legacy)
        people = await _people_by_id(db, ids)
        return [_person(u) for u in sorted(people.values(), key=lambda u: u.display_name or "")]
    ids = set(
        (
            await db.execute(
                select(TeamChannelMember.user_id).where(TeamChannelMember.channel_id == ch.id)
            )
        ).scalars().all()
    )
    people = await _people_by_id(db, ids)
    return [_person(u) for u in sorted(people.values(), key=lambda u: u.display_name or "")]


def _display_name(ch: TeamChannel, people: list[PersonOut], me: User) -> str:
    if ch.kind == "dm":
        others = [p.display_name for p in people if p.id != me.id]
        return others[0] if others else (me.display_name or "Just you")
    return ch.name


async def _unread_for(
    db: AsyncSession, channel_ids: list[uuid.UUID], user_id: uuid.UUID
) -> dict[uuid.UUID, int]:
    """Messages by other people after this person's read marker, per channel."""
    if not channel_ids:
        return {}
    markers = dict(
        (
            await db.execute(
                select(TeamChannelMember.channel_id, TeamChannelMember.last_read_at).where(
                    TeamChannelMember.user_id == user_id,
                    TeamChannelMember.channel_id.in_(channel_ids),
                )
            )
        ).all()
    )
    out: dict[uuid.UUID, int] = {}
    for cid in channel_ids:
        since = markers.get(cid)
        conds = [
            TeamMessage.channel_id == cid,
            TeamMessage.deleted_at.is_(None),
            or_(TeamMessage.user_id.is_(None), TeamMessage.user_id != user_id),
        ]
        if since is not None:
            conds.append(TeamMessage.created_at > since)
        n = (await db.execute(select(func.count()).select_from(TeamMessage).where(and_(*conds)))).scalar_one()
        out[cid] = int(n or 0)
    return out


async def _last_messages(
    db: AsyncSession, channel_ids: list[uuid.UUID]
) -> dict[uuid.UUID, TeamMessage]:
    if not channel_ids:
        return {}
    ranked = (
        select(
            TeamMessage,
            func.row_number()
            .over(partition_by=TeamMessage.channel_id, order_by=TeamMessage.created_at.desc())
            .label("rn"),
        )
        .where(TeamMessage.channel_id.in_(channel_ids), TeamMessage.deleted_at.is_(None))
        .subquery()
    )
    msg_alias = select(TeamMessage).join(ranked, ranked.c.id == TeamMessage.id).where(ranked.c.rn == 1)
    rows = (await db.execute(msg_alias)).scalars().all()
    return {m.channel_id: m for m in rows}


async def _channel_out(db: AsyncSession, ch: TeamChannel, me: User, unread: int, last: TeamMessage | None) -> ChannelOut:
    people = await _channel_people(db, ch)
    preview = None
    if last is not None:
        author = next((p.display_name for p in people if p.id == last.user_id), None)
        text = (last.content or "").strip().replace("\n", " ")
        if not text and last.attachments:
            text = f"{len(last.attachments)} file(s)"
        preview = f"{author}: {text}"[:140] if author else text[:140]
    return ChannelOut(
        id=ch.id,
        kind=ch.kind,
        name=_display_name(ch, people, me),
        project_id=ch.project_id,
        members=people,
        unread=unread,
        last_message_at=last.created_at if last else None,
        last_message_preview=preview,
        created_by=ch.created_by,
    )


async def _visible_channels(db: AsyncSession, me: User) -> list[TeamChannel]:
    out: list[TeamChannel] = [await _ensure_global(db)]
    # Groups and DMs I am in.
    member_of = (
        await db.execute(
            select(TeamChannel)
            .join(TeamChannelMember, TeamChannelMember.channel_id == TeamChannel.id)
            .where(
                TeamChannelMember.user_id == me.id,
                TeamChannel.kind.in_(("group", "dm")),
                TeamChannel.is_archived.is_(False),
            )
        )
    ).scalars().all()
    out.extend(member_of)
    # Project channels for projects I hold a role on.
    project_channels = (
        await db.execute(
            select(TeamChannel, Project)
            .join(Project, Project.id == TeamChannel.project_id)
            .where(TeamChannel.kind == "project", TeamChannel.is_archived.is_(False))
        )
    ).all()
    for ch, project in project_channels:
        if await resolve_role(db, project, me.id) is not None:
            out.append(ch)
    return out


def _to_out(m: TeamMessage, people: dict[uuid.UUID, User], me: User) -> MessageOut:
    author = people.get(m.user_id) if m.user_id else None
    return MessageOut(
        id=m.id,
        channel_id=m.channel_id,
        author=_person(author) if author else None,
        mine=m.user_id == me.id,
        content="" if m.deleted_at else (m.content or ""),
        attachments=[] if m.deleted_at else list(m.attachments or []),
        refs=[] if m.deleted_at else list(m.refs or []),
        mentions=[uuid.UUID(str(x)) for x in (m.mentions or []) if x],
        edited_at=m.edited_at,
        deleted_at=m.deleted_at,
        created_at=m.created_at,
    )


# ── people ────────────────────────────────────────────────────────────────

@router.get("/people", response_model=list[PersonOut])
async def list_people(
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> list[PersonOut]:
    rows = (
        await db.execute(select(User).where(User.is_active.is_(True)).order_by(User.display_name))
    ).scalars().all()
    return [_person(u) for u in rows]


# ── channels ──────────────────────────────────────────────────────────────

@router.get("/channels", response_model=list[ChannelOut])
async def list_channels(
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> list[ChannelOut]:
    channels = await _visible_channels(db, me)
    ids = [c.id for c in channels]
    unread = await _unread_for(db, ids, me.id)
    last = await _last_messages(db, ids)
    out = [await _channel_out(db, c, me, unread.get(c.id, 0), last.get(c.id)) for c in channels]
    await db.commit()
    order = {"global": 0, "project": 1, "group": 2, "dm": 3}
    out.sort(key=lambda c: (order.get(c.kind, 9), -(c.last_message_at.timestamp() if c.last_message_at else 0), c.name.lower()))
    return out


@router.get("/unread", response_model=UnreadOut)
async def unread_summary(
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> UnreadOut:
    channels = await _visible_channels(db, me)
    unread = await _unread_for(db, [c.id for c in channels], me.id)
    await db.commit()
    return UnreadOut(total=sum(unread.values()), channels={str(k): v for k, v in unread.items() if v})


@router.post("/channels", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(
    body: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> ChannelOut:
    member_ids = {mid for mid in body.member_ids if mid != me.id}
    people = await _people_by_id(db, member_ids)
    if len(people) != len(member_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "One of those people does not have an account here.")

    if body.kind == "dm":
        if len(member_ids) != 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A direct message is with exactly one other person.")
        other = next(iter(member_ids))
        # One DM per pair: reuse it.
        mine = select(TeamChannelMember.channel_id).where(TeamChannelMember.user_id == me.id)
        theirs = select(TeamChannelMember.channel_id).where(TeamChannelMember.user_id == other)
        existing = (
            await db.execute(
                select(TeamChannel).where(
                    TeamChannel.kind == "dm",
                    TeamChannel.id.in_(mine),
                    TeamChannel.id.in_(theirs),
                )
            )
        ).scalars().first()
        if existing is not None:
            unread = await _unread_for(db, [existing.id], me.id)
            last = await _last_messages(db, [existing.id])
            return await _channel_out(db, existing, me, unread.get(existing.id, 0), last.get(existing.id))
        ch = TeamChannel(kind="dm", name="", created_by=me.id)
    else:
        name = body.name.strip()
        if not name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give the group a name.")
        ch = TeamChannel(kind="group", name=name[:200], created_by=me.id)

    db.add(ch)
    await db.flush()
    for uid in member_ids | {me.id}:
        db.add(TeamChannelMember(channel_id=ch.id, user_id=uid, last_read_at=_now() if uid == me.id else None))
    await db.commit()
    return await _channel_out(db, ch, me, 0, None)


@router.post("/channels/project/{project_id}", response_model=ChannelOut)
async def ensure_project_channel(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> ChannelOut:
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if project is None or await resolve_role(db, project, me.id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such project, or you are not on it.")
    ch = (
        await db.execute(select(TeamChannel).where(TeamChannel.project_id == project_id))
    ).scalar_one_or_none()
    if ch is None:
        ch = TeamChannel(kind="project", name=project.name[:200], project_id=project.id, created_by=me.id)
        db.add(ch)
        await db.flush()
    elif ch.name != project.name[:200]:
        ch.name = project.name[:200]
    await _ensure_marker(db, ch.id, me.id)
    unread = await _unread_for(db, [ch.id], me.id)
    last = await _last_messages(db, [ch.id])
    out = await _channel_out(db, ch, me, unread.get(ch.id, 0), last.get(ch.id))
    await db.commit()
    return out


@router.get("/channels/{channel_id}", response_model=ChannelOut)
async def get_channel(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> ChannelOut:
    ch = await _require_read(db, channel_id, me)
    unread = await _unread_for(db, [ch.id], me.id)
    last = await _last_messages(db, [ch.id])
    return await _channel_out(db, ch, me, unread.get(ch.id, 0), last.get(ch.id))


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(
    channel_id: uuid.UUID,
    body: ChannelUpdate,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> ChannelOut:
    ch = await _require_read(db, channel_id, me)
    if ch.kind != "group":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only a group can be renamed or have its members changed.")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A group needs a name.")
        ch.name = name[:200]
    add = {uid for uid in body.add_member_ids}
    if add:
        people = await _people_by_id(db, add)
        if len(people) != len(add):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "One of those people does not have an account here.")
        for uid in add:
            if not await _is_member_row(db, ch.id, uid):
                db.add(TeamChannelMember(channel_id=ch.id, user_id=uid))
    for uid in body.remove_member_ids:
        row = (
            await db.execute(
                select(TeamChannelMember).where(
                    TeamChannelMember.channel_id == ch.id, TeamChannelMember.user_id == uid
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            await db.delete(row)
    await db.flush()
    # A group nobody is left in is archived rather than left orphaned.
    remaining = (
        await db.execute(
            select(func.count()).select_from(TeamChannelMember).where(TeamChannelMember.channel_id == ch.id)
        )
    ).scalar_one()
    if not remaining:
        ch.is_archived = True
    unread = await _unread_for(db, [ch.id], me.id)
    last = await _last_messages(db, [ch.id])
    out = await _channel_out(db, ch, me, unread.get(ch.id, 0), last.get(ch.id))
    await db.commit()
    return out


@router.post("/channels/{channel_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_channel_read(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> None:
    ch = await _require_read(db, channel_id, me)
    marker = await _ensure_marker(db, ch.id, me.id)
    marker.last_read_at = _now()
    await db.commit()


# ── messages ──────────────────────────────────────────────────────────────

@router.get("/channels/{channel_id}/messages", response_model=list[MessageOut])
async def list_messages(
    channel_id: uuid.UUID,
    after: datetime | None = Query(None, description="Only rows created after this instant (polling)."),
    before: datetime | None = Query(None, description="Only rows created before this instant (history)."),
    limit: int = Query(PAGE_SIZE, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> list[MessageOut]:
    ch = await _require_read(db, channel_id, me)
    stmt = select(TeamMessage).where(TeamMessage.channel_id == ch.id)
    if after is not None:
        # Edits and deletions of older rows ride along too, so the client's
        # copy converges without a full reload.
        stmt = stmt.where(
            or_(
                TeamMessage.created_at > after,
                TeamMessage.edited_at > after,
                TeamMessage.deleted_at > after,
            )
        ).order_by(TeamMessage.created_at.asc()).limit(limit)
        rows = (await db.execute(stmt)).scalars().all()
    else:
        if before is not None:
            stmt = stmt.where(TeamMessage.created_at < before)
        rows = list((await db.execute(stmt.order_by(TeamMessage.created_at.desc()).limit(limit))).scalars().all())
        rows.reverse()
    people = await _people_by_id(db, {m.user_id for m in rows if m.user_id})
    return [_to_out(m, people, me) for m in rows]


@router.post("/channels/{channel_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def post_message(
    channel_id: uuid.UUID,
    body: MessageIn,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> MessageOut:
    ch = await _require_read(db, channel_id, me)
    content = body.content.strip()
    if not content and not body.attachments and not body.refs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say something, attach a file, or link something.")
    # Only files this channel actually holds may be referenced.
    att_dir = _attachments_dir()
    attachments = []
    for a in body.attachments[:10]:
        if not _SAFE_NAME.match(a.id) or not (att_dir / a.id).is_file():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Attachment {a.name!r} was not uploaded.")
        attachments.append(a.model_dump())

    readers = {p.id for p in await _channel_people(db, ch)}
    mentions = [str(uid) for uid in dict.fromkeys(body.mention_ids) if uid in readers and uid != me.id]

    now = _now()
    msg = TeamMessage(
        channel_id=ch.id,
        user_id=me.id,
        content=content,
        attachments=attachments,
        refs=[r.model_dump(exclude_none=True) for r in body.refs[:10]],
        mentions=mentions,
        created_at=now,
    )
    db.add(msg)
    ch.updated_at = now
    marker = await _ensure_marker(db, ch.id, me.id)
    marker.last_read_at = now
    await db.flush()

    if mentions:
        people = await _channel_people(db, ch)
        where = _display_name(ch, people, me)
        repo = NotificationRepository(db)
        for uid in mentions:
            try:
                await repo.create(
                    user_id=uuid.UUID(uid),
                    type=NotificationType.CHAT_MENTION.value,
                    title=f"{me.display_name or me.email} mentioned you in {where}",
                    message=content[:300],
                    entity_type="team_channel",
                    entity_id=ch.id,
                )
            except Exception:  # noqa: BLE001 — a failed ping must not lose the message
                logger.exception("chat mention notification failed")
    await db.commit()
    await db.refresh(msg)
    return _to_out(msg, {me.id: me}, me)


async def _own_message(db: AsyncSession, message_id: uuid.UUID, me: User) -> TeamMessage:
    msg = (await db.execute(select(TeamMessage).where(TeamMessage.id == message_id))).scalar_one_or_none()
    if msg is None or msg.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such message.")
    if msg.user_id != me.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who wrote a message can change it.")
    return msg


@router.patch("/messages/{message_id}", response_model=MessageOut)
async def edit_message(
    message_id: uuid.UUID,
    body: MessageEdit,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> MessageOut:
    msg = await _own_message(db, message_id, me)
    msg.content = body.content.strip()
    msg.edited_at = _now()
    await db.commit()
    await db.refresh(msg)
    return _to_out(msg, {me.id: me}, me)


@router.delete("/messages/{message_id}", response_model=MessageOut)
async def delete_message(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> MessageOut:
    msg = await _own_message(db, message_id, me)
    att_dir = _attachments_dir()
    for a in msg.attachments or []:
        name = str(a.get("id") or "")
        if _SAFE_NAME.match(name):
            try:
                (att_dir / name).unlink(missing_ok=True)
            except OSError:
                logger.warning("could not remove chat attachment %s", name)
    msg.content = ""
    msg.attachments = []
    msg.refs = []
    msg.deleted_at = _now()
    await db.commit()
    await db.refresh(msg)
    return _to_out(msg, {me.id: me}, me)


# ── attachments ───────────────────────────────────────────────────────────

@router.post("/channels/{channel_id}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    channel_id: uuid.UUID,
    body: AttachmentIn,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> AttachmentOut:
    """Bytes arrive base64 in JSON because the desktop→hub proxy carries JSON only."""
    await _require_read(db, channel_id, me)
    try:
        raw = base64.b64decode(body.data_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file data was not valid base64.") from exc
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file is empty.")
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Files up to 15 MB can be attached here.")
    display = Path(body.filename or "file").name or "file"
    cleaned = re.sub(r"[^\w.\-]", "_", display).strip("._") or "file"
    stored = f"{uuid.uuid4().hex}_{cleaned}"[:200]
    (_attachments_dir() / stored).write_bytes(raw)
    return AttachmentOut(id=stored, name=display[:200], size=len(raw), mime=(body.mime or "application/octet-stream")[:100])


@router.get("/files/{stored_name}")
async def download_attachment(
    stored_name: str,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
) -> FileResponse:
    if not _SAFE_NAME.match(stored_name):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such file.")
    # The file must belong to a message in a channel this person can read.
    msg = (
        await db.execute(
            select(TeamMessage).where(
                TeamMessage.deleted_at.is_(None),
                TeamMessage.attachments.contains([{"id": stored_name}]),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if msg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such file.")
    await _require_read(db, msg.channel_id, me)
    path = _attachments_dir() / stored_name
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That file is no longer on the hub.")
    meta = next((a for a in msg.attachments if a.get("id") == stored_name), {})
    return FileResponse(
        path,
        media_type=str(meta.get("mime") or "application/octet-stream"),
        filename=str(meta.get("name") or stored_name),
    )
