"""Gerry writing a batch of tasks, and reading a whole project back.

The batch is all-or-nothing on purpose: a contract pasted in as twenty line
items should not leave eleven tasks behind and a complaint about the twelfth.
Reading is the other half of the same complaint - `get_tasks` used to filter on
"tasks I made or was given", which inside a shared project shows almost nothing.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import ProjectMember
from models.db.task import Project, Task
from models.db.user import User
from services.agent import project_tools as pt
from services.agent.tools import execute_get_tasks
from services.auth.service import hash_password


@dataclass
class _Ctx:
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


async def _project(db: AsyncSession, owner: User, name: str) -> Project:
    project = Project(
        name=name,
        goal="",
        visibility="private",
        owner_id=owner.id,
        created_by=owner.id,
    )
    db.add(project)
    await db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role="owner"))
    await db.flush()
    return project


async def _tasks(db: AsyncSession, project: Project) -> list[Task]:
    rows = await db.execute(select(Task).where(Task.project_id == project.id))
    return list(rows.scalars().all())


def test_every_advertised_tool_has_a_working_executor():
    """A tool the model can see but the app cannot run is a dead end mid-turn."""
    for definition in pt.TOOL_DEFINITIONS:
        name = definition["function"]["name"]
        fn = pt.TOOL_EXECUTORS.get(name)
        assert fn is not None, f"{name} is advertised with no executor"
        assert inspect.iscoroutinefunction(fn), f"{name} is not a coroutine"
        assert name in pt.TOOL_DOCS, f"{name} is missing from the v2 documentation"


@pytest.mark.asyncio
async def test_create_tasks_writes_the_whole_batch(db_session: AsyncSession):
    owner = await _user(db_session, "batch-owner@pmi.local")
    project = await _project(db_session, owner, "SO/LIC CLIN 001")

    out = await pt.execute_create_tasks(
        _Ctx(db_session, owner.id),
        {
            "project": "SO/LIC CLIN 001",
            "tasks": [
                {"title": "CLIN 003", "is_milestone": True, "due_date": "2026-03-01"},
                {"title": "CLIN 004", "priority": "high"},
                "CLIN 005",
            ],
        },
    )

    assert "3" in out
    made = await _tasks(db_session, project)
    assert {t.title for t in made} == {"CLIN 003", "CLIN 004", "CLIN 005"}
    assert next(t for t in made if t.title == "CLIN 003").is_milestone is True
    assert next(t for t in made if t.title == "CLIN 004").priority == "high"


@pytest.mark.asyncio
async def test_create_tasks_accepts_a_pasted_list(db_session: AsyncSession):
    owner = await _user(db_session, "paste-owner@pmi.local")
    project = await _project(db_session, owner, "Contract A")

    await pt.execute_create_tasks(
        _Ctx(db_session, owner.id),
        {"project": "Contract A", "tasks": "- Line item one\n- Line item two\n"},
    )

    assert {t.title for t in await _tasks(db_session, project)} == {
        "Line item one",
        "Line item two",
    }


@pytest.mark.asyncio
async def test_one_bad_row_writes_nothing(db_session: AsyncSession):
    owner = await _user(db_session, "strict-owner@pmi.local")
    project = await _project(db_session, owner, "Contract B")

    out = await pt.execute_create_tasks(
        _Ctx(db_session, owner.id),
        {
            "project": "Contract B",
            "tasks": [
                {"title": "Good one"},
                {"title": "Bad one", "status": "nearly done"},
            ],
        },
    )

    assert "Nothing was created" in out
    assert await _tasks(db_session, project) == []


@pytest.mark.asyncio
async def test_a_row_can_name_a_parent_from_the_same_batch(db_session: AsyncSession):
    owner = await _user(db_session, "nest-owner@pmi.local")
    project = await _project(db_session, owner, "Contract C")

    await pt.execute_create_tasks(
        _Ctx(db_session, owner.id),
        {
            "project": "Contract C",
            "tasks": [
                {"title": "Deliver the report"},
                {"title": "Draft it", "parent": "Deliver the report"},
            ],
        },
    )

    by_title = {t.title: t for t in await _tasks(db_session, project)}
    assert by_title["Draft it"].parent_task_id == by_title["Deliver the report"].id


@pytest.mark.asyncio
async def test_get_tasks_reads_the_whole_project(db_session: AsyncSession):
    """Everyone on a project sees all of it, not only the rows with their name."""
    owner = await _user(db_session, "read-owner@pmi.local")
    other = await _user(db_session, "read-other@pmi.local")
    project = await _project(db_session, owner, "Contract D")
    db_session.add(
        Task(
            title="Someone else's task",
            project_id=project.id,
            created_by=other.id,
            status="todo",
            priority="medium",
        )
    )
    await db_session.flush()

    out = await execute_get_tasks(_Ctx(db_session, owner.id), {"project": "Contract D"})

    assert "Someone else's task" in out


@pytest.mark.asyncio
async def test_get_tasks_indents_sub_tasks(db_session: AsyncSession):
    owner = await _user(db_session, "tree-owner@pmi.local")
    await _project(db_session, owner, "Contract E")
    ctx = _Ctx(db_session, owner.id)
    await pt.execute_create_tasks(
        ctx,
        {
            "project": "Contract E",
            "tasks": [
                {"title": "Parent job"},
                {"title": "Child job", "parent": "Parent job"},
            ],
        },
    )

    out = await execute_get_tasks(ctx, {"project": "Contract E"})

    child = next(line for line in out.splitlines() if "Child job" in line)
    parent = next(line for line in out.splitlines() if "Parent job" in line)
    assert len(child) - len(child.lstrip(" -")) > len(parent) - len(parent.lstrip(" -"))
