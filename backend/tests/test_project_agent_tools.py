"""Gerry finding projects, and filing a task under one.

Both were impossible until now: there was no tool that could name a project, so
a project mentioned by name could not be resolved to anything, and `create_task`
had nowhere to put a project even if it had one. What is exercised here is the
local half. The hub half needs a hub, and is covered by refusing to invent one:
with no link configured, the shared lookup must come back empty rather than
raise, because a tool that throws ends the user's turn.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import ProjectMember
from models.db.task import Project, Task
from models.db.user import User
from services.agent.project_tools import (
    execute_list_projects,
    find_hub_project,
    hub_projects,
)
from services.agent.tools import execute_create_task
from services.auth.service import hash_password


@dataclass
class _Ctx:
    """Only what these tools reach for out of the real ToolContext."""

    db: AsyncSession
    user_id: UUID
    conversation_id: None = None


async def _user(db: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        display_name=email,
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _project(
    db: AsyncSession, owner: User, name: str, visibility: str = "private"
) -> Project:
    project = Project(
        name=name,
        goal="",
        visibility=visibility,
        owner_id=owner.id,
        created_by=owner.id,
    )
    db.add(project)
    await db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role="owner"))
    await db.flush()
    return project


@pytest.mark.asyncio
async def test_list_projects_names_the_projects_and_their_ids(db_session: AsyncSession):
    owner = await _user(db_session, "lp-owner@pmi.local")
    project = await _project(db_session, owner, "Test 3")

    out = await execute_list_projects(_Ctx(db_session, owner.id), {})

    assert "Test 3" in out
    assert str(project.id) in out


@pytest.mark.asyncio
async def test_list_projects_keeps_someone_elses_private_project_out(
    db_session: AsyncSession,
):
    owner = await _user(db_session, "lp-mine@pmi.local")
    stranger = await _user(db_session, "lp-theirs@pmi.local")
    await _project(db_session, stranger, "Not Yours")

    out = await execute_list_projects(_Ctx(db_session, owner.id), {})

    assert "Not Yours" not in out


@pytest.mark.asyncio
async def test_list_projects_narrows_by_name(db_session: AsyncSession):
    owner = await _user(db_session, "lp-filter@pmi.local")
    await _project(db_session, owner, "Test 3")
    await _project(db_session, owner, "Something Else")

    out = await execute_list_projects(_Ctx(db_session, owner.id), {"query": "test"})

    assert "Test 3" in out
    assert "Something Else" not in out


@pytest.mark.asyncio
async def test_list_projects_hides_the_archived_unless_asked(db_session: AsyncSession):
    owner = await _user(db_session, "lp-arch@pmi.local")
    project = await _project(db_session, owner, "Old Work")
    project.is_archived = True
    await db_session.flush()

    assert "Old Work" not in await execute_list_projects(_Ctx(db_session, owner.id), {})
    assert "Old Work" in await execute_list_projects(
        _Ctx(db_session, owner.id), {"include_archived": True}
    )


@pytest.mark.asyncio
async def test_create_task_files_it_under_the_named_project(db_session: AsyncSession):
    owner = await _user(db_session, "ct-owner@pmi.local")
    project = await _project(db_session, owner, "Test 3")

    out = await execute_create_task(
        _Ctx(db_session, owner.id), {"title": "Draft the CLIN table", "project": "Test 3"}
    )

    assert "Test 3" in out
    task = (
        await db_session.execute(select(Task).where(Task.project_id == project.id))
    ).scalar_one()
    assert task.title == "Draft the CLIN table"


@pytest.mark.asyncio
async def test_create_task_without_a_project_stays_loose(db_session: AsyncSession):
    owner = await _user(db_session, "ct-loose@pmi.local")

    await execute_create_task(_Ctx(db_session, owner.id), {"title": "Just a task"})

    task = (
        await db_session.execute(select(Task).where(Task.title == "Just a task"))
    ).scalar_one()
    assert task.project_id is None


@pytest.mark.asyncio
async def test_create_task_refuses_a_project_that_is_nowhere(db_session: AsyncSession):
    owner = await _user(db_session, "ct-missing@pmi.local")

    out = await execute_create_task(
        _Ctx(db_session, owner.id), {"title": "Orphan", "project": "No Such Thing"}
    )

    assert "Error" in out
    assert (
        await db_session.execute(select(Task).where(Task.title == "Orphan"))
    ).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_create_task_will_not_reach_into_someone_elses_project(
    db_session: AsyncSession,
):
    outsider = await _user(db_session, "ct-out@pmi.local")
    stranger = await _user(db_session, "ct-owner2@pmi.local")
    project = await _project(db_session, stranger, "Private Work")

    out = await execute_create_task(
        _Ctx(db_session, outsider.id), {"title": "Sneaky", "project": "Private Work"}
    )

    assert "Error" in out
    assert (
        await db_session.execute(select(Task).where(Task.project_id == project.id))
    ).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_the_shared_lookup_is_quiet_when_there_is_no_hub(db_session: AsyncSession):
    owner = await _user(db_session, "hub-none@pmi.local")

    assert await hub_projects(db_session, owner.id) == []
    assert await find_hub_project(db_session, owner.id, "Test 3") is None
