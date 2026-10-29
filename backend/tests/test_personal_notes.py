"""A note is its author's and no one else's — through the service and the tools."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.user import User
from services import notes as svc
from services.agent.notes_tools import execute_list_notes, execute_save_note
from services.auth.service import hash_password


async def _user(db: AsyncSession) -> User:
    user = User(
        email=f"notes-{uuid.uuid4().hex[:8]}@pmi.local",
        display_name="Note taker",
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


@dataclass
class _Ctx:
    db: AsyncSession
    user_id: uuid.UUID
    conversation_id: uuid.UUID


@pytest.mark.asyncio
async def test_notes_are_private_to_their_author(db_session: AsyncSession):
    me = await _user(db_session)
    them = await _user(db_session)
    mine = await svc.create_note(db_session, me.id, "Call the supplier about the lead time", source="voice")
    await svc.create_note(db_session, them.id, "Their secret")

    assert [n.id for n in await svc.list_notes(db_session, me.id)] == [mine.id]
    assert await svc.get_note(db_session, them.id, mine.id) is None
    assert await svc.update_note(db_session, them.id, mine.id, content="tampered") is None
    assert await svc.delete_note(db_session, them.id, mine.id) is False
    assert (await svc.get_note(db_session, me.id, mine.id)).content == "Call the supplier about the lead time"


@pytest.mark.asyncio
async def test_gerry_saves_and_reads_back_for_the_same_person_only(db_session: AsyncSession):
    me = await _user(db_session)
    them = await _user(db_session)
    conv = uuid.uuid4()
    ctx_me = _Ctx(db_session, me.id, conv)
    ctx_them = _Ctx(db_session, them.id, uuid.uuid4())

    out = await execute_save_note(ctx_me, {"content": "  Lindsey wants the Hatch numbers by Friday ", "spoken": True})
    assert out.startswith("Noted (") and "Hatch numbers" in out

    saved = (await svc.list_notes(db_session, me.id))[0]
    assert saved.source == "voice" and saved.conversation_id == conv

    mine = await execute_list_notes(ctx_me, {"since_days": 7})
    assert "Hatch numbers" in mine and mine.startswith("1 note(s)")
    theirs = await execute_list_notes(ctx_them, {})
    assert theirs == "The user has no notes."


@pytest.mark.asyncio
async def test_list_filters_by_window_and_text(db_session: AsyncSession):
    me = await _user(db_session)
    old = await svc.create_note(db_session, me.id, "Old thought about budgets")
    old.created_at = datetime.now(timezone.utc) - timedelta(days=30)
    await db_session.flush()
    await svc.create_note(db_session, me.id, "Fresh thought about budgets")
    await svc.create_note(db_session, me.id, "Fresh thought about hiring")

    week = await svc.recent_notes(db_session, me.id, days=7)
    assert {n.content for n in week} == {"Fresh thought about budgets", "Fresh thought about hiring"}
    budgets = await svc.list_notes(db_session, me.id, query="BUDGETS")
    assert {n.content for n in budgets} == {"Old thought about budgets", "Fresh thought about budgets"}

    out = await execute_list_notes(_Ctx(db_session, me.id, uuid.uuid4()), {"since_days": 7, "query": "hiring"})
    assert "hiring" in out and "budgets" not in out


@pytest.mark.asyncio
async def test_archive_hides_without_deleting(db_session: AsyncSession):
    me = await _user(db_session)
    note = await svc.create_note(db_session, me.id, "Keep this around")
    await svc.update_note(db_session, me.id, note.id, archived=True)
    assert await svc.list_notes(db_session, me.id) == []
    assert len(await svc.list_notes(db_session, me.id, include_archived=True)) == 1
    await svc.update_note(db_session, me.id, note.id, archived=False)
    assert len(await svc.list_notes(db_session, me.id)) == 1


@pytest.mark.asyncio
async def test_empty_note_is_refused(db_session: AsyncSession):
    me = await _user(db_session)
    with pytest.raises(ValueError):
        await svc.create_note(db_session, me.id, "   ")
    out = await execute_save_note(_Ctx(db_session, me.id, uuid.uuid4()), {"content": ""})
    assert out.startswith("Error:")
