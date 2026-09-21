"""Reconciling a shared project's chat with the copy Gerry actually works on.

Chat in a shared project used to run on the hub. That put the conversation in
the one place with no knowledge base, no Drive token and no Gmail, so Gerry
answered from an empty desk and said so. She runs on the member's own machine
now, against a local copy of the conversation that carries the hub's ids, and
this module keeps the two the same: pull before a turn so she has read what
colleagues wrote, push after it so they can read her answer.

Sharing ids between the copy and the original is what makes that safe. A push
that is retried after a dropped reply is recognised rather than duplicated, and
a pull can tell a message it already has from one it has not seen.

Nothing here is allowed to fail a turn. A hub that is unreachable costs the
conversation its freshness, which the caller can survive; raising would cost the
user their answer, which they cannot.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.conversation import Conversation, Message
from models.db.enums import MessageRole
from services.hub import client as hub

logger = logging.getLogger(__name__)

# Tool calls and system scaffolding are local mechanics, not the record of what
# was said. Only what a person would recognise as the conversation travels.
_SHARED_ROLES = (MessageRole.USER, MessageRole.ASSISTANT)


async def ensure_mirror(
    db: AsyncSession, user_id: uuid.UUID, conv_id: uuid.UUID
) -> Conversation | None:
    """The local copy of a hub conversation, made if it is not here yet.

    None means the hub would not give it to us, which for our purposes is the
    same as it not existing: the caller has no business opening it.
    """
    local = await db.get(Conversation, conv_id)
    if local is not None and local.hub_mirror:
        return local

    try:
        resp = await hub.request(db, user_id, "GET", f"/conversations/{conv_id}")
    except hub.HubError as exc:
        logger.warning("Hub conversation %s unreachable: %s", conv_id, exc)
        return local if local is not None and local.hub_mirror else None
    if resp.status_code != 200:
        return None
    remote = resp.json()

    if local is None:
        local = Conversation(
            id=conv_id,
            user_id=user_id,
            title=remote.get("title"),
            agent_type=remote.get("agent_type"),
            hub_mirror=True,
            project_id=_uuid_or_none(remote.get("project_id")),
            kind=remote.get("kind") or "project",
        )
        db.add(local)
    else:
        # A conversation that already existed locally under this id and is not a
        # mirror would be someone else's row entirely; refuse rather than adopt.
        if not local.hub_mirror:
            return None
        local.title = remote.get("title") or local.title
        if local.project_id is None:
            local.project_id = _uuid_or_none(remote.get("project_id"))
    await db.flush()
    return local


def _uuid_or_none(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


async def pull(db: AsyncSession, user_id: uuid.UUID, conv_id: uuid.UUID) -> int:
    """Bring down anything said on the hub that we do not have. Does not commit."""
    try:
        resp = await hub.request(
            db, user_id, "GET", f"/conversations/{conv_id}/messages",
            params={"limit": 200},
        )
    except hub.HubError as exc:
        logger.warning("Could not read hub conversation %s: %s", conv_id, exc)
        return 0
    if resp.status_code != 200:
        logger.warning("Hub refused conversation %s: %s", conv_id, resp.status_code)
        return 0

    remote = resp.json()
    if not remote:
        return 0
    ids = [uuid.UUID(str(m["id"])) for m in remote]
    here = set(
        (await db.execute(select(Message.id).where(Message.id.in_(ids)))).scalars().all()
    )

    added = 0
    latest = None
    for item in remote:
        mid = uuid.UUID(str(item["id"]))
        if mid in here:
            continue
        try:
            role = MessageRole(item.get("role"))
        except ValueError:
            continue
        if role not in _SHARED_ROLES:
            continue
        msg = Message(
            id=mid,
            conversation_id=conv_id,
            role=role,
            content=item.get("content") or "",
            agent_type=item.get("agent_type"),
            model_name=item.get("model_name"),
            cited_chunk_ids=[],
            tool_calls=[],
            tool_results=[],
            hub_synced=True,
        )
        stamp = _dt_or_none(item.get("created_at"))
        if stamp is not None:
            msg.created_at = stamp
            if latest is None or stamp > latest:
                latest = stamp
        db.add(msg)
        added += 1
    if added:
        if latest is not None:
            conv = await db.get(Conversation, conv_id)
            if conv is not None and (conv.updated_at is None or latest > conv.updated_at):
                conv.updated_at = latest
        await db.flush()
    return added


def _dt_or_none(value: object):
    from datetime import datetime

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


async def push_pending(
    db: AsyncSession, user_id: uuid.UUID, conv_id: uuid.UUID
) -> int:
    """Offer the hub everything said here that it has not got. Does not commit."""
    pending = (
        (
            await db.execute(
                select(Message)
                .where(
                    Message.conversation_id == conv_id,
                    Message.hub_synced.is_(False),
                    Message.role.in_(_SHARED_ROLES),
                )
                .order_by(Message.created_at)
            )
        )
        .scalars()
        .all()
    )
    sent = 0
    for msg in pending:
        if not (msg.content or "").strip():
            msg.hub_synced = True  # nothing to say; stop reconsidering it
            continue
        body = {
            "id": str(msg.id),
            "role": getattr(msg.role, "value", msg.role),
            "content": msg.content,
            "agent_type": getattr(msg.agent_type, "value", msg.agent_type),
            "model_name": msg.model_name,
            "created_at": msg.created_at.isoformat() if msg.created_at else None,
        }
        try:
            resp = await hub.request(
                db, user_id, "POST", f"/conversations/{conv_id}/messages",
                json_body=body,
            )
        except hub.HubError as exc:
            logger.warning("Could not send message %s to the hub: %s", msg.id, exc)
            break  # order matters; stop rather than push a later one past it
        if resp.status_code in (200, 201):
            msg.hub_synced = True
            sent += 1
        else:
            logger.warning(
                "Hub refused message %s: %s %s", msg.id, resp.status_code, resp.text[:200]
            )
            break
    if sent:
        await db.flush()
    return sent


async def sync(
    db: AsyncSession, user_id: uuid.UUID, conv_id: uuid.UUID
) -> Conversation | None:
    """Make the local copy current in both directions. Commits.

    A conversation that began here and is not on the hub yet is put there
    first, so it can be picked up from any other device.
    """
    local = await db.get(Conversation, conv_id)
    if local is not None and not local.hub_mirror:
        if local.user_id != user_id:
            return None
        if syncable(local) and await hub.get_link(db, user_id) is not None:
            await adopt(db, user_id, local)
        await db.commit()
        return local
    conv = await ensure_mirror(db, user_id, conv_id)
    if conv is None:
        return None
    await push_pending(db, user_id, conv_id)
    await pull(db, user_id, conv_id)
    await db.commit()
    return conv


# ── Conversations that began here ────────────────────────────────────────────
# The hub is the record for shared projects; for a person's own chats it is the
# way to carry one from the desk to the phone and back. Every conversation a
# linked person has is offered to the hub under its own id, at the end of each
# turn and once when opened, so either device can continue it.

# Scheduled-task output is a log, not a conversation anyone continues.
_UNSHARED_KINDS = ("routine",)
_ADOPT_MESSAGE_CAP = 500


def syncable(conv: Conversation) -> bool:
    return not conv.is_archived and (conv.kind or "general") not in _UNSHARED_KINDS


async def adopt(db: AsyncSession, user_id: uuid.UUID, conv: Conversation) -> bool:
    """Put a conversation that began here onto the hub, under the same id.

    Marks it a mirror on success, so later turns pull and push like any other
    hub conversation. Does not commit.
    """
    msgs = (
        (
            await db.execute(
                select(Message)
                .where(
                    Message.conversation_id == conv.id,
                    Message.role.in_(_SHARED_ROLES),
                )
                .order_by(Message.created_at.desc())
                .limit(_ADOPT_MESSAGE_CAP)
            )
        )
        .scalars()
        .all()
    )
    msgs.reverse()
    body = {
        "id": str(conv.id),
        "title": conv.title,
        "agent_type": getattr(conv.agent_type, "value", conv.agent_type),
        "kind": conv.kind or "general",
        # A local project's id means nothing on the hub; a hub project's
        # conversation is already a mirror and never comes through here.
        "project_id": None,
        "created_at": conv.created_at.isoformat() if conv.created_at else None,
        "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
        "messages": [
            {
                "id": str(m.id),
                "role": getattr(m.role, "value", m.role),
                "content": m.content,
                "agent_type": getattr(m.agent_type, "value", m.agent_type),
                "model_name": m.model_name,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in msgs
            if (m.content or "").strip()
        ],
    }
    try:
        resp = await hub.request(db, user_id, "POST", "/conversations/import", json_body=body)
    except hub.HubError as exc:
        logger.warning("Could not offer conversation %s to the hub: %s", conv.id, exc)
        return False
    if resp.status_code not in (200, 201):
        logger.warning(
            "Hub refused conversation %s: %s %s", conv.id, resp.status_code, resp.text[:200]
        )
        return False
    for m in msgs:
        m.hub_synced = True
    stamp = conv.updated_at
    conv.hub_mirror = True
    await db.flush()
    # Going up is bookkeeping, not activity: keep the list order. (onupdate
    # stamped now here, which is what buried the hub's own conversations.)
    if stamp is not None:
        from sqlalchemy import update

        await db.execute(
            update(Conversation).where(Conversation.id == conv.id).values(updated_at=stamp)
        )
        await db.refresh(conv, ["updated_at"])
    return True


async def after_turn(db: AsyncSession, user_id: uuid.UUID, conv_id: uuid.UUID) -> None:
    """End of a turn on the desktop: push what was said, adopting first if needed."""
    conv = await db.get(Conversation, conv_id)
    if conv is None:
        return
    await db.refresh(conv)  # another request may have adopted it meanwhile
    if conv.user_id != user_id or not syncable(conv):
        return
    if conv.hub_mirror:
        await push_pending(db, user_id, conv_id)
        return
    if await hub.get_link(db, user_id) is None:
        return
    await adopt(db, user_id, conv)


async def mirror_update(
    db: AsyncSession, user_id: uuid.UUID, conv_id: uuid.UUID, updates: dict
) -> None:
    """Carry a rename / pin / archive to the hub copy. Never raises."""
    try:
        await hub.request(db, user_id, "PATCH", f"/conversations/{conv_id}", json_body=updates)
    except hub.HubError as exc:
        logger.warning("Could not update hub conversation %s: %s", conv_id, exc)


async def adopt_all(get_db, user_id: uuid.UUID) -> int:
    """Offer every conversation this person has not yet put on the hub. Commits each."""
    async for db in get_db():
        if await hub.get_link(db, user_id) is None:
            return 0
        rows = (
            (
                await db.execute(
                    select(Conversation)
                    .where(
                        Conversation.user_id == user_id,
                        Conversation.hub_mirror.is_(False),
                        Conversation.is_archived.is_(False),
                        Conversation.kind.notin_(_UNSHARED_KINDS),
                    )
                    .order_by(Conversation.updated_at.desc())
                )
            )
            .scalars()
            .all()
        )
        done = 0
        with_messages = set(
            (
                await db.execute(
                    select(Message.conversation_id)
                    .where(Message.conversation_id.in_([c.id for c in rows]))
                    .distinct()
                )
            )
            .scalars()
            .all()
        ) if rows else set()
        for conv in rows:
            if conv.id not in with_messages:
                continue  # an empty "New conversation" is not worth a row anywhere
            if await adopt(db, user_id, conv):
                await db.commit()
                done += 1
            else:
                await db.rollback()
                break  # the hub is not answering; try again next start
        return done
    return 0
