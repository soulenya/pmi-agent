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
        )
        db.add(local)
    else:
        # A conversation that already existed locally under this id and is not a
        # mirror would be someone else's row entirely; refuse rather than adopt.
        if not local.hub_mirror:
            return None
        local.title = remote.get("title") or local.title
    await db.flush()
    return local


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
        db.add(
            Message(
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
        )
        added += 1
    if added:
        await db.flush()
    return added


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
    """Make the local copy current in both directions. Commits."""
    conv = await ensure_mirror(db, user_id, conv_id)
    if conv is None:
        return None
    await push_pending(db, user_id, conv_id)
    await pull(db, user_id, conv_id)
    await db.commit()
    return conv
