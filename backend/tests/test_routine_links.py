"""A routine's Drive link reaches Today even when the model never repeated it.

The weekly report of 2026-10-29 uploaded to Drive — the tool's answer carried
the address and the run kept it as an "Open in Drive" chip — but the closing
text had no URL, so Today showed the report with nothing to open. Links are
now recorded from the whole run, and runs from before that are read back from
the chip they left.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.conversation import Conversation, Message
from models.db.scheduled_task import ScheduledTask
from models.db.user import User
from routers.scheduled_tasks import _backfill_links
from services.auth.service import hash_password

DRIVE = "https://docs.google.com/document/d/1MHw-P8nZ/edit?usp=drivesdk"


async def _user(db: AsyncSession) -> User:
    user = User(
        email=f"routine-{uuid.uuid4().hex[:8]}@pmi.local",
        display_name="Routine owner",
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _run(db: AsyncSession, user: User, *, chips: list[dict], text: str) -> ScheduledTask:
    conv = Conversation(user_id=user.id, title="[Scheduled] Weekly report", kind="routine")
    db.add(conv)
    await db.flush()
    db.add(Message(conversation_id=conv.id, role="user", content="Write the weekly report"))
    db.add(Message(conversation_id=conv.id, role="assistant", content=text, tool_results=chips))
    task = ScheduledTask(
        user_id=user.id,
        title="Weekly report",
        prompt="Write the weekly report and upload it to Drive",
        conversation_id=conv.id,
        last_run_status="success",
        last_run_output=text,
        run_count=1,
    )
    db.add(task)
    await db.flush()
    return task


@pytest.mark.asyncio
async def test_link_is_read_back_from_the_upload_chip(db_session: AsyncSession):
    me = await _user(db_session)
    task = await _run(
        db_session,
        me,
        chips=[{"url": DRIVE, "tool": "upload_to_drive", "type": "artifact_link", "label": "Open in Drive"}],
        text="# Weekly Executive Update\n\nAll on track.",  # no address in the text
    )
    assert task.last_run_links is None
    await _backfill_links(db_session, task)
    assert task.last_run_links == [DRIVE]


@pytest.mark.asyncio
async def test_text_links_are_kept_too_and_nothing_is_looked_up_twice(db_session: AsyncSession):
    me = await _user(db_session)
    task = await _run(
        db_session,
        me,
        chips=[],
        text="Done — see https://example.com/report and /api/files/abc_report.docx",
    )
    await _backfill_links(db_session, task)
    assert task.last_run_links == ["https://example.com/report"]

    bare = await _run(db_session, me, chips=[], text="Nothing produced.")
    await _backfill_links(db_session, bare)
    assert bare.last_run_links == []  # recorded as "looked, nothing", not left null


@pytest.mark.asyncio
async def test_failed_runs_are_left_alone(db_session: AsyncSession):
    me = await _user(db_session)
    task = await _run(db_session, me, chips=[{"url": DRIVE}], text="RUN REJECTED")
    task.last_run_status = "failed"
    await _backfill_links(db_session, task)
    assert task.last_run_links is None
