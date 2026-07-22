"""Workroom context — injected into agent conversations pinned to a workroom.

When a conversation belongs to a Workroom (persistent co-work space), every
agent turn gets a WORKROOM CONTEXT block: the room's goal, its pinned
artifacts, and the latest journal entries — so Gerry always knows what the
user and she are working on across days/weeks, not just one conversation.

Same failure-tolerant pattern as live_document.py / company_context.py:
never raises, returns "" when the conversation is not a room. Wired into BOTH
chat engines (v1 executor._build_history and v2 supervisor).
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.workroom import Workroom, WorkroomItem, WorkroomJournalEntry

logger = logging.getLogger(__name__)

MAX_WORKROOM_CONTEXT_CHARS = 4_000
_JOURNAL_ENTRIES = 5

_KIND_LABELS = {
    "drive_doc": "Drive doc",
    "kb_doc": "KB document",
    "generated_file": "Generated file",
    "note": "Note",
    "email_thread": "Email thread",
    "task": "Task",
    "odoo_record": "Odoo record",
    "regulatory_doc": "Regulatory doc",
    "budget": "Budget",
}


async def get_workroom_for_conversation(
    db: AsyncSession, conversation_id
) -> Workroom | None:
    """The ACTIVE workroom pinned to this conversation, or None."""
    try:
        conv_uuid = uuid.UUID(str(conversation_id))
    except (TypeError, ValueError):
        return None
    return (
        await db.execute(
            select(Workroom).where(
                Workroom.conversation_id == conv_uuid,
                Workroom.status == "active",
            )
        )
    ).scalar_one_or_none()


async def build_workroom_context(db: AsyncSession, conversation_id) -> str:
    """WORKROOM CONTEXT block for injection, or "" (never raises)."""
    try:
        room = await get_workroom_for_conversation(db, conversation_id)
        if room is None:
            return ""
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
                    .limit(_JOURNAL_ENTRIES)
                )
            ).scalars()
        )

        lines = [
            f'\n\nWORKROOM: "{room.title}" — this conversation is a persistent '
            "co-work space shared by you and the user across sessions.",
        ]
        if room.goal.strip():
            lines.append(f"GOAL: {room.goal.strip()}")
        if items:
            lines.append("PINNED ITEMS:")
            for it in items:
                kind = _KIND_LABELS.get(it.kind, it.kind)
                ref = f" (ref: {it.ref_id})" if it.ref_id else ""
                lines.append(f"- [{kind}] {it.label}{ref}")
        if journal:
            lines.append("RECENT PROGRESS (newest first):")
            for j in journal:
                stamp = j.created_at.strftime("%Y-%m-%d") if j.created_at else ""
                lines.append(f"- {stamp}: {j.entry}")
        lines.append(
            "Ground your work in this room's goal and pinned items. Use pinned "
            "Drive/KB references directly (read_drive_file, "
            "read_knowledge_base_document) instead of searching from scratch."
        )
        block = "\n".join(lines) + "\n"
        return block[:MAX_WORKROOM_CONTEXT_CHARS]
    except Exception:  # noqa: BLE001 — context must never break a turn
        logger.exception("Failed to build workroom context for %s", conversation_id)
        return ""


# ── Phase 2 helpers — used by agent tools and auto-journal hooks ─────────


async def list_active_workrooms(db: AsyncSession, user_id: uuid.UUID) -> list[Workroom]:
    return list(
        (
            await db.execute(
                select(Workroom)
                .where(Workroom.user_id == user_id, Workroom.status == "active")
                .order_by(desc(Workroom.updated_at))
            )
        ).scalars()
    )


async def resolve_workroom(
    db: AsyncSession,
    user_id: uuid.UUID,
    conversation_id,
    title_hint: str = "",
) -> tuple[Workroom | None, list[str]]:
    """Find the target workroom: by title hint if given, else the room bound
    to this conversation. Returns (room, active_room_titles) — titles let the
    caller compose a helpful error when no room matches."""
    rooms = await list_active_workrooms(db, user_id)
    titles = [r.title for r in rooms]
    hint = title_hint.strip().lower()
    if hint:
        for r in rooms:
            if hint == r.title.lower():
                return r, titles
        for r in rooms:
            if hint in r.title.lower() or r.title.lower() in hint:
                return r, titles
        return None, titles
    return await get_workroom_for_conversation(db, conversation_id), titles


async def pin_workroom_item(
    db: AsyncSession,
    room: Workroom,
    kind: str,
    label: str,
    ref_id: str = "",
) -> tuple[WorkroomItem, bool]:
    """Pin an item, deduplicating on kind + ref_id (or label when no ref).
    Returns (item, created)."""
    stmt = select(WorkroomItem).where(
        WorkroomItem.workroom_id == room.id, WorkroomItem.kind == kind
    )
    if ref_id:
        stmt = stmt.where(WorkroomItem.ref_id == ref_id)
    else:
        stmt = stmt.where(WorkroomItem.label == label)
    existing = (await db.execute(stmt)).scalars().first()
    if existing is not None:
        return existing, False
    item = WorkroomItem(workroom_id=room.id, kind=kind, ref_id=ref_id, label=label)
    db.add(item)
    await db.flush()
    return item, True


async def add_journal_entry(
    db: AsyncSession, room: Workroom, entry: str
) -> WorkroomJournalEntry:
    j = WorkroomJournalEntry(workroom_id=room.id, entry=entry.strip())
    db.add(j)
    await db.flush()
    return j


async def log_room_event(db: AsyncSession, conversation_id, entry: str) -> None:
    """Auto-journal a significant action IF this conversation is a workroom.
    Silent no-op otherwise; never raises."""
    try:
        room = await get_workroom_for_conversation(db, conversation_id)
        if room is not None:
            await add_journal_entry(db, room, entry)
    except Exception:  # noqa: BLE001 — journaling must never break a tool
        logger.exception("Failed to auto-journal room event for %s", conversation_id)


async def auto_pin_if_room(
    db: AsyncSession, conversation_id, kind: str, label: str, ref_id: str = ""
) -> None:
    """Auto-pin an artifact IF this conversation is a workroom. Never raises."""
    try:
        room = await get_workroom_for_conversation(db, conversation_id)
        if room is not None:
            await pin_workroom_item(db, room, kind, label, ref_id)
    except Exception:  # noqa: BLE001 — pinning must never break a tool
        logger.exception("Failed to auto-pin room item for %s", conversation_id)
