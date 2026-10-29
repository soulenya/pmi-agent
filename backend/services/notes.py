"""Personal notes: one person's, read and written only for that person.

Every function takes the user and never looks past them. The router, the
agent tools and the briefing all come through here so the rule — a note is
visible to its author alone — is written once.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.personal_note import NOTE_SOURCES, PersonalNote

MAX_NOTE_CHARS = 20_000


def _clean(content: str) -> str:
    text = (content or "").strip()
    if not text:
        raise ValueError("A note needs some words in it.")
    return text[:MAX_NOTE_CHARS]


async def create_note(
    db: AsyncSession,
    user_id: uuid.UUID,
    content: str,
    *,
    source: str = "text",
    conversation_id: uuid.UUID | None = None,
) -> PersonalNote:
    """Save a note for this person. Does not commit."""
    note = PersonalNote(
        id=uuid.uuid4(),
        user_id=user_id,
        content=_clean(content),
        source=source if source in NOTE_SOURCES else "text",
        conversation_id=conversation_id,
    )
    db.add(note)
    await db.flush()
    await db.refresh(note)
    return note


async def list_notes(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    since: datetime | None = None,
    query: str | None = None,
    include_archived: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[PersonalNote]:
    """This person's notes, newest first."""
    stmt = select(PersonalNote).where(PersonalNote.user_id == user_id)
    if not include_archived:
        stmt = stmt.where(PersonalNote.archived_at.is_(None))
    if since is not None:
        stmt = stmt.where(PersonalNote.created_at >= since)
    if query and query.strip():
        stmt = stmt.where(PersonalNote.content.ilike(f"%{query.strip()}%"))
    stmt = stmt.order_by(PersonalNote.created_at.desc()).limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars())


async def recent_notes(db: AsyncSession, user_id: uuid.UUID, days: int = 7, limit: int = 50) -> list[PersonalNote]:
    since = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    return await list_notes(db, user_id, since=since, limit=limit)


async def count_notes(db: AsyncSession, user_id: uuid.UUID) -> int:
    return int(
        (
            await db.execute(
                select(func.count(PersonalNote.id)).where(
                    PersonalNote.user_id == user_id, PersonalNote.archived_at.is_(None)
                )
            )
        ).scalar()
        or 0
    )


async def get_note(db: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID) -> PersonalNote | None:
    return (
        await db.execute(
            select(PersonalNote).where(PersonalNote.id == note_id, PersonalNote.user_id == user_id)
        )
    ).scalar_one_or_none()


async def update_note(
    db: AsyncSession,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    *,
    content: str | None = None,
    archived: bool | None = None,
) -> PersonalNote | None:
    """Edit or (un)archive one of this person's notes. Does not commit."""
    note = await get_note(db, user_id, note_id)
    if note is None:
        return None
    if content is not None:
        note.content = _clean(content)
    if archived is not None:
        note.archived_at = datetime.now(timezone.utc) if archived else None
    await db.flush()
    await db.refresh(note)
    return note


async def delete_note(db: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID) -> bool:
    note = await get_note(db, user_id, note_id)
    if note is None:
        return False
    await db.delete(note)
    await db.flush()
    return True


def render_notes(notes: list[PersonalNote], *, max_chars: int = 6_000) -> str:
    """Notes as dated lines for a prompt or a tool result. Newest first."""
    return render_rows(
        [
            {"content": n.content, "created_at": n.created_at.isoformat() if n.created_at else ""}
            for n in notes
        ],
        max_chars=max_chars,
    )


def render_rows(rows: list[dict], *, max_chars: int = 6_000) -> str:
    """Same as ``render_notes`` for plain dicts (hub rows and local rows mixed)."""
    lines: list[str] = []
    used = 0
    for r in rows:
        stamp = _stamp(r.get("created_at"))
        body = " ".join(str(r.get("content") or "").split())
        line = f"- [{stamp}] {body}"
        if used + len(line) > max_chars:
            lines.append(f"- … {len(rows) - len(lines)} more not shown")
            break
        lines.append(line)
        used += len(line) + 1
    return "\n".join(lines)


def _stamp(raw: object) -> str:
    if isinstance(raw, datetime):
        return raw.strftime("%Y-%m-%d %H:%M")
    text = str(raw or "")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return text[:16]


# ── Where a note lives ──────────────────────────────────────────────────────────
#
# A desktop connected to the hub keeps its notes THERE, so a thought dictated
# on the phone and a routine run on the laptop see the same list. Unconnected,
# or on the hub itself, notes are local. Reads merge both so nothing written
# while offline goes missing.


def _as_row(n: PersonalNote, where: str) -> dict:
    return {
        "id": str(n.id),
        "content": n.content,
        "source": n.source,
        "created_at": n.created_at.isoformat() if n.created_at else "",
        "where": where,
    }


async def _hub_link(db: AsyncSession, user_id: uuid.UUID):
    from config import settings

    if settings.hub_mode:
        return None
    from services.hub import client as hub

    if not hub.configured():
        return None
    return await hub.get_link(db, user_id)


async def save_anywhere(
    db: AsyncSession,
    user_id: uuid.UUID,
    content: str,
    *,
    source: str = "text",
    conversation_id: uuid.UUID | None = None,
) -> tuple[dict, str]:
    """Keep a note on the hub when connected, else here. Returns (row, where).

    Falls back to local when the hub cannot be reached, so a note is never lost
    to a network blip; the caller may say where it went.
    """
    content = _clean(content)
    if await _hub_link(db, user_id) is not None:
        from services.hub import client as hub

        try:
            resp = await hub.request(
                db,
                user_id,
                "POST",
                "/notes",
                json_body={
                    "content": content,
                    "source": source,
                    "conversation_id": str(conversation_id) if conversation_id else None,
                },
            )
            if resp.status_code in (200, 201):
                row = resp.json()
                row["where"] = "hub"
                return row, "hub"
        except hub.HubError:
            pass
    note = await create_note(db, user_id, content, source=source, conversation_id=conversation_id)
    return _as_row(note, "local"), "local"


async def list_anywhere(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    since: datetime | None = None,
    query: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """This person's notes from the hub and from here, newest first."""
    rows: list[dict] = [
        _as_row(n, "local") for n in await list_notes(db, user_id, since=since, query=query, limit=limit)
    ]
    if await _hub_link(db, user_id) is not None:
        from services.hub import client as hub

        params = {"limit": str(limit)}
        if since is not None:
            params["since"] = since.isoformat()
        if query:
            params["q"] = query
        try:
            resp = await hub.request(db, user_id, "GET", "/notes", params=params)
            if resp.status_code == 200 and isinstance(resp.json(), list):
                for r in resp.json():
                    r["where"] = "hub"
                    rows.append(r)
        except hub.HubError:
            pass
    rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    return rows[:limit]
