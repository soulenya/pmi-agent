"""Hub conversations kept in the company brain, so a past chat can be found by what was said in it.

Each conversation on the hub becomes one GBrain page, re-written a few minutes
after the conversation goes quiet. That is a searchable copy, not a move: the
conversation itself stays where it is and loads as before.

Unlike a recorded fact, a stored conversation is not company-wide. It is
returned only to someone who could open that conversation on the hub, and that
is enforced here rather than in GBrain, in two steps: the search is limited to
pages tagged with a scope the person holds (their own id, their projects), and
every hit is then checked against the hub's own access rule before it is
shown. The tag narrows the search; the check is what decides.

Only the hub runs any of this. A desktop reaches it through the hub's /brain
routes like the rest of the company brain.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from brand import get_brand
from config import settings
from models.db.brain_archive import BrainConversationArchive
from models.db.conversation import Conversation, Message
from models.db.enums import MessageRole
from services import company_brain as brain

logger = logging.getLogger(__name__)

SLUG_PREFIX = brain.CONVERSATION_PREFIX
# A conversation is written once it has been quiet this long, so a chat in
# progress is not re-written (and re-versioned in GBrain) on every message.
IDLE_SECONDS = 600
# Per pass, so a first run over years of chats is spread out, not one burst.
BATCH = 20
# Beyond this the oldest messages are left out of the page (GBrain stores a
# page of up to 1 MiB in one piece).
MAX_PAGE_CHARS = 600_000
# One excerpt per chat, and each is a whole passage, so a few go a long way.
MAX_CHATS = 3

# What a person would recognise as the conversation; tool traffic is not.
_SHARED_ROLES = (MessageRole.USER, MessageRole.ASSISTANT)
# Scheduled-task output is a log, not a conversation (the hub does not hold it either).
_UNSHARED_KINDS = ("routine",)
# GBrain accepts at most this many values for one frontmatter key in a search.
_WHERE_MAX = 32

# Conversations GBrain refused, by the message count it refused them at, so a
# page it will not take is not offered again every pass. Forgotten on restart.
_refused: dict[uuid.UUID, int] = {}

_NOT_DATABASE_ONLY = (
    "The company brain is not set up to hold conversations: it must keep pages in its "
    "database alone, and this one also writes them to files that are not backed up. "
    "See 'Conversations in the brain' in docs/GBRAIN.md."
)


async def _require_database_only() -> None:
    """Refuse to write a page to a brain the hub's backup could not bring back."""
    if not await brain.stores_pages_in_database():
        raise brain.BrainUnavailable(_NOT_DATABASE_ONLY)


def enabled() -> bool:
    """Whether this process keeps conversations in the brain: a hub, with the brand's say-so."""
    return get_brand().feature("brain_conversations") and brain.configured()


def slug_for(conv_id: uuid.UUID) -> str:
    return f"{SLUG_PREFIX}{conv_id}"


def conversation_id_of(slug: str) -> uuid.UUID | None:
    if not slug.startswith(SLUG_PREFIX):
        return None
    try:
        return uuid.UUID(slug[len(SLUG_PREFIX):])
    except ValueError:
        return None


# ── Writing ─────────────────────────────────────────────────────────────────────


def _said() -> Any:
    """The messages that count: a person's or the assistant's, with words in them."""
    return (Message.role.in_(_SHARED_ROLES)) & (func.length(func.btrim(Message.content)) > 0)


async def _project_id(db: AsyncSession, conv: Conversation) -> uuid.UUID | None:
    if conv.project_id is not None:
        return conv.project_id
    # Project chats from before conversations named their project (migration 042).
    from models.db.workroom import Workroom

    return (
        await db.execute(select(Workroom.project_id).where(Workroom.conversation_id == conv.id).limit(1))
    ).scalar_one_or_none()


async def _page(db: AsyncSession, conv: Conversation) -> tuple[str, int]:
    """The conversation as a GBrain page, and how many messages it was made from."""
    from models.db.user import User

    project_id = await _project_id(db, conv)
    scope = f"project:{project_id}" if project_id else f"user:{conv.user_id}"
    owner = await db.get(User, conv.user_id)
    # A project chat does not record which member wrote a message.
    asker = "A project member" if project_id else (getattr(owner, "display_name", None) or "User")
    assistant = get_brand().assistant_name

    rows = (
        await db.execute(
            select(Message.role, Message.content, Message.created_at)
            .where(Message.conversation_id == conv.id, _said())
            .order_by(Message.created_at.asc(), Message.id.asc())
        )
    ).all()
    turns: list[str] = []
    for role, content, at in rows:
        who = assistant if getattr(role, "value", role) == MessageRole.ASSISTANT.value else asker
        stamp = at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if at else "undated"
        turns.append(f"## {stamp} | {who}\n\n{content.strip()}\n")

    # Newest first into the budget: what was said lately is what gets looked for.
    kept: list[str] = []
    used = 0
    for turn in reversed(turns):
        if kept and used + len(turn) > MAX_PAGE_CHARS:
            break
        kept.append(turn)
        used += len(turn)
    kept.reverse()
    omitted = len(turns) - len(kept)

    title = " ".join((conv.title or "Untitled chat").split())
    head = [
        "---",
        "type: conversation",
        f"title: {json.dumps(title)}",
        f'lg_scope: "{scope}"',
        f'lg_conversation: "{conv.id}"',
        "---",
        f"# {title}",
        "",
    ]
    if omitted:
        head += [f"The first {omitted} message(s) are not kept here; the conversation itself has them.", ""]
    return "\n".join(head) + "\n".join(kept), len(turns)


async def archive(db: AsyncSession, conv: Conversation) -> int:
    """Write this conversation's page now. Returns the messages stored. Does not commit."""
    content, count = await _page(db, conv)
    if count == 0:
        return 0
    await brain.put_page(slug_for(conv.id), content, reason=f"{count} message(s)")
    row = await db.get(BrainConversationArchive, conv.id)
    if row is None:
        db.add(BrainConversationArchive(conversation_id=conv.id, message_count=count))
    else:
        row.message_count = count
        row.archived_at = datetime.now(timezone.utc)
    await db.flush()
    return count


async def archive_due(db: AsyncSession, *, limit: int = BATCH, idle_seconds: int = IDLE_SECONDS) -> int:
    """Write the pages of conversations that have changed and gone quiet. Commits as it goes."""
    said = (
        select(
            Message.conversation_id.label("cid"),
            func.count(Message.id).label("n"),
            func.max(Message.created_at).label("last"),
        )
        .where(_said())
        .group_by(Message.conversation_id)
        .subquery()
    )
    quiet_since = datetime.now(timezone.utc) - timedelta(seconds=idle_seconds)
    due = (
        await db.execute(
            select(Conversation, said.c.n)
            .join(said, said.c.cid == Conversation.id)
            .outerjoin(
                BrainConversationArchive, BrainConversationArchive.conversation_id == Conversation.id
            )
            .where(
                Conversation.kind.notin_(_UNSHARED_KINDS),
                said.c.last <= quiet_since,
                or_(
                    BrainConversationArchive.conversation_id.is_(None),
                    BrainConversationArchive.message_count != said.c.n,
                ),
            )
            .order_by(said.c.last.asc())
            .limit(limit + len(_refused))
        )
    ).all()

    if not due:
        return 0
    await _require_database_only()

    done = 0
    for conv, n in due:
        if done >= limit:
            break
        if _refused.get(conv.id) == n:
            continue
        try:
            await archive(db, conv)
            await db.commit()
            done += 1
        except brain.BrainUnavailable:
            await db.rollback()
            raise  # nothing else will get through either; try again next pass
        except brain.BrainError as exc:
            await db.rollback()
            _refused[conv.id] = n
            logger.warning("The company brain refused conversation %s: %s", conv.id, exc)
    return done


async def remove_deleted(db: AsyncSession, *, limit: int = BATCH) -> int:
    """Take the pages of conversations that no longer exist out of the brain. Commits."""
    orphans = (
        (
            await db.execute(
                select(BrainConversationArchive)
                .outerjoin(Conversation, Conversation.id == BrainConversationArchive.conversation_id)
                .where(Conversation.id.is_(None))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    for row in orphans:
        await brain.delete_page(slug_for(row.conversation_id))
        await db.delete(row)
        await db.commit()
    return len(orphans)


async def run_once(db: AsyncSession) -> tuple[int, int]:
    """One background pass: (pages written, pages removed)."""
    return await archive_due(db), await remove_deleted(db)


# ── Reading ─────────────────────────────────────────────────────────────────────


async def search(db: AsyncSession, user_id: uuid.UUID, question: str, *, limit: int = MAX_CHATS) -> list[dict]:
    """Passages from stored conversations this person may open, best first, one per chat."""
    from routers.conversations import conversation_for
    from services.projects.access import visible_project_ids

    scopes = [f"user:{user_id}"] + [f"project:{p}" for p in await visible_project_ids(db, user_id)]
    hits: list[dict[str, Any]] = []
    for start in range(0, len(scopes), _WHERE_MAX):
        hits += await brain.search_pages(
            question,
            types=["conversation"],
            where={"lg_scope": scopes[start:start + _WHERE_MAX]},
            limit=limit * 3,
        )
    hits.sort(key=lambda h: h["score"], reverse=True)

    chats: list[dict] = []
    seen: set[uuid.UUID] = set()
    for hit in hits:
        conv_id = conversation_id_of(hit["slug"])
        if conv_id is None or conv_id in seen:
            continue
        seen.add(conv_id)
        # The tag on the page is only as fresh as its last write. This is the rule.
        conv = await conversation_for(db, conv_id, user_id)
        if conv is None:
            continue
        chats.append(
            {"conversation_id": str(conv_id), "title": conv.title or "Untitled chat", "text": hit["text"]}
        )
        if len(chats) >= limit:
            break
    return chats


async def recall_for_person(
    db: AsyncSession, user_id: uuid.UUID, question: str = "", *, subject: str | None = None, limit: int = 10
) -> dict[str, Any]:
    """The company's facts, plus this person's own matching chats when those are kept."""
    found = await brain.recall(question, subject=subject, limit=limit)
    if enabled() and (question or "").strip():
        try:
            found["chats"] = await search(db, user_id, question)
        except brain.BrainError as exc:
            # The facts are still an answer; say nothing of chats rather than fail.
            logger.warning("Searching stored conversations failed: %s", exc)
    return found


async def save_now_for(db: AsyncSession, user_id: uuid.UUID, conv_id: uuid.UUID) -> int:
    """Store this conversation in the brain now, from wherever the agent runs. Returns messages stored."""
    if brain.configured():
        if not enabled():
            raise brain.BrainUnavailable("Keeping chats in the company brain is not switched on for this hub.")
        from routers.conversations import conversation_for

        conv = await conversation_for(db, conv_id, user_id)
        if conv is None:
            raise brain.BrainError("That chat is not one this user can open.")
        await _require_database_only()
        return await archive(db, conv)

    # A desktop: the brain only stores what the hub holds, so the chat goes
    # there first (as it would at the end of the turn anyway).
    from services.hub import client as hub
    from services.hub import conv_sync

    conv = await db.get(Conversation, conv_id)
    if conv is None or conv.user_id != user_id:
        raise brain.BrainError("This chat was not found.")
    if settings.hub_mode or not hub.configured() or await hub.get_link(db, user_id) is None:
        raise brain.BrainUnavailable(
            "The company brain lives on the hub. Connect this computer to the hub in "
            "Settings → Connections to use it."
        )
    if not conv_sync.syncable(conv):
        raise brain.BrainError("This kind of chat is not kept on the hub, so it cannot go into the company brain.")
    if conv.hub_mirror:
        await conv_sync.push_pending(db, user_id, conv_id)
    elif not await conv_sync.adopt(db, user_id, conv):
        raise brain.BrainUnavailable("The hub would not take this chat just now. Try again in a moment.")
    stored = await brain.ask_hub(db, user_id, f"conversations/{conv_id}/archive", {})
    return int(stored.get("messages") or 0)
