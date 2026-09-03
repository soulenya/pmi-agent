"""Deleting a project takes its own work with it, and nothing else's."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.budget import Budget
from models.db.conversation import Conversation
from models.db.project_member import ProjectMember
from models.db.task import Project, Task
from models.db.user import User
from models.db.workroom import Workroom
from services.auth.service import hash_password
from services.projects.access import resolve_role, role_at_least
from services.projects.removal import delete_project
from services.projects.workroom import ensure_workroom


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


async def _project(db: AsyncSession, owner: User, visibility: str = "private") -> Project:
    project = Project(
        name="Doomed",
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
async def test_delete_takes_the_project_tasks_workroom_and_conversation(
    db_session: AsyncSession,
):
    owner = await _user(db_session, "del-owner@pmi.local")
    project = await _project(db_session, owner)
    room = await ensure_workroom(db_session, project, owner.id)
    conv_id = room.conversation_id
    task = Task(title="Only mine", project_id=project.id, created_by=owner.id)
    db_session.add(task)
    await db_session.flush()
    task_id, project_id, room_id = task.id, project.id, room.id

    await delete_project(db_session, project)
    await db_session.flush()

    assert await db_session.get(Project, project_id) is None
    assert await db_session.get(Task, task_id) is None
    assert await db_session.get(Workroom, room_id) is None
    assert await db_session.get(Conversation, conv_id) is None


@pytest.mark.asyncio
async def test_delete_lets_go_of_a_budget_without_destroying_it(
    db_session: AsyncSession,
):
    """The budget is a Google Sheet that outlives any project claiming it."""
    owner = await _user(db_session, "del-budget@pmi.local")
    project = await _project(db_session, owner)
    budget = Budget(
        user_id=owner.id,
        project_id=project.id,
        title="Programme spend",
        drive_file_id="sheet-123",
        currency="USD",
    )
    db_session.add(budget)
    await db_session.flush()
    budget_id = budget.id

    await delete_project(db_session, project)
    await db_session.flush()
    db_session.expire_all()

    kept = await db_session.get(Budget, budget_id)
    assert kept is not None
    assert kept.project_id is None


@pytest.mark.asyncio
async def test_delete_leaves_another_projects_task_alone(db_session: AsyncSession):
    owner = await _user(db_session, "del-neighbour@pmi.local")
    doomed = await _project(db_session, owner)
    keeper = await _project(db_session, owner)
    task = Task(title="Not yours", project_id=keeper.id, created_by=owner.id)
    db_session.add(task)
    await db_session.flush()
    task_id = task.id

    await delete_project(db_session, doomed)
    await db_session.flush()

    survivor = await db_session.get(Task, task_id)
    assert survivor is not None
    assert survivor.project_id == keeper.id


@pytest.mark.asyncio
async def test_only_the_owner_reaches_the_delete_route(db_session: AsyncSession):
    """A company project makes everyone an editor; deleting is not editing."""
    owner = await _user(db_session, "del-boss@pmi.local")
    passer_by = await _user(db_session, "del-passer@pmi.local")
    project = await _project(db_session, owner, visibility="company")

    assert await resolve_role(db_session, project, passer_by.id) == "editor"
    assert not role_at_least("editor", "owner")
    assert role_at_least(
        await resolve_role(db_session, project, owner.id) or "", "owner"
    )


@pytest.mark.asyncio
async def test_deleting_a_project_with_no_workroom_is_fine(db_session: AsyncSession):
    owner = await _user(db_session, "del-bare@pmi.local")
    project = await _project(db_session, owner)
    project_id = project.id

    await delete_project(db_session, project)
    await db_session.flush()

    assert await db_session.get(Project, project_id) is None
    rooms = (
        await db_session.execute(
            select(Workroom).where(Workroom.project_id == project_id)
        )
    ).scalars().all()
    assert rooms == []
