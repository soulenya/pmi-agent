"""Custody: work made in a shared project stays there until it is released."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import ProjectMember
from models.db.task import Project, Task
from models.db.user import User
from services.auth.service import hash_password
from services.projects import custody


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
    db: AsyncSession, owner: User, visibility: str
) -> Project:
    project = Project(
        name=f"{visibility} project",
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


async def _task(db: AsyncSession, project: Project, creator: User) -> Task:
    task = Task(title="Draft the protocol", project_id=project.id, created_by=creator.id)
    db.add(task)
    await db.flush()
    return task


@pytest.mark.asyncio
async def test_private_project_holds_nothing(db_session: AsyncSession):
    owner = await _user(db_session, "owner-private@pmi.local")
    project = await _project(db_session, owner, "private")
    task = await _task(db_session, project, owner)

    assert await custody.take(db_session, project, "task", task.id, owner.id) is None
    assert await custody.holder(db_session, "task", task.id) is None


@pytest.mark.asyncio
async def test_shared_project_takes_custody_once(db_session: AsyncSession):
    owner = await _user(db_session, "owner-shared@pmi.local")
    project = await _project(db_session, owner, "shared")
    task = await _task(db_session, project, owner)

    first = await custody.take(db_session, project, "task", task.id, owner.id)
    await db_session.flush()
    second = await custody.take(db_session, project, "task", task.id, owner.id)

    assert first is not None
    assert second is first


@pytest.mark.asyncio
async def test_outsider_cannot_change_held_work(db_session: AsyncSession):
    owner = await _user(db_session, "owner-outsider@pmi.local")
    stranger = await _user(db_session, "stranger@pmi.local")
    project = await _project(db_session, owner, "shared")
    task = await _task(db_session, project, owner)
    await custody.take(db_session, project, "task", task.id, owner.id)
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await custody.assert_may_change(db_session, "task", task.id, stranger.id)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_viewer_cannot_change_held_work(db_session: AsyncSession):
    owner = await _user(db_session, "owner-viewer@pmi.local")
    viewer = await _user(db_session, "viewer@pmi.local")
    project = await _project(db_session, owner, "shared")
    db_session.add(
        ProjectMember(project_id=project.id, user_id=viewer.id, role="viewer")
    )
    task = await _task(db_session, project, owner)
    await custody.take(db_session, project, "task", task.id, owner.id)
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await custody.assert_may_change(db_session, "task", task.id, viewer.id)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_editor_may_change_held_work(db_session: AsyncSession):
    owner = await _user(db_session, "owner-editor@pmi.local")
    editor = await _user(db_session, "editor@pmi.local")
    project = await _project(db_session, owner, "shared")
    db_session.add(
        ProjectMember(project_id=project.id, user_id=editor.id, role="editor")
    )
    task = await _task(db_session, project, owner)
    await custody.take(db_session, project, "task", task.id, owner.id)
    await db_session.flush()

    held = await custody.assert_may_change(db_session, "task", task.id, editor.id)
    assert held is not None
    assert held.project_id == project.id


@pytest.mark.asyncio
async def test_held_work_cannot_be_moved(db_session: AsyncSession):
    owner = await _user(db_session, "owner-move@pmi.local")
    project = await _project(db_session, owner, "shared")
    task = await _task(db_session, project, owner)
    held = await custody.take(db_session, project, "task", task.id, owner.id)
    await db_session.flush()

    custody.assert_stays_put(held, project.id)  # staying put is fine
    with pytest.raises(HTTPException) as exc:
        custody.assert_stays_put(held, uuid.uuid4())
    assert exc.value.status_code == 409

    with pytest.raises(HTTPException):
        custody.assert_stays_put(held, None)


@pytest.mark.asyncio
async def test_release_lets_the_work_go(db_session: AsyncSession):
    owner = await _user(db_session, "owner-release@pmi.local")
    stranger = await _user(db_session, "stranger-release@pmi.local")
    project = await _project(db_session, owner, "shared")
    task = await _task(db_session, project, owner)
    held = await custody.take(db_session, project, "task", task.id, owner.id)
    await db_session.flush()

    await custody.release(db_session, held, owner.id, note="handed back")
    await db_session.flush()

    assert await custody.holder(db_session, "task", task.id) is None
    # Once released, the project no longer speaks for it.
    assert await custody.assert_may_change(db_session, "task", task.id, stranger.id) is None
