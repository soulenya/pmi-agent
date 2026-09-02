"""A project's workroom belongs to the project, not to whoever opened it."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import ProjectMember
from models.db.task import Project
from models.db.user import User
from models.db.workroom import Workroom
from routers.workrooms import _get_room
from services.auth.service import hash_password


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


async def _project(db: AsyncSession, owner: User, visibility: str) -> Project:
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


async def _room(db: AsyncSession, creator: User, project: Project | None) -> Workroom:
    room = Workroom(
        user_id=creator.id,
        project_id=project.id if project is not None else None,
        title="Room",
        goal="",
    )
    db.add(room)
    await db.flush()
    return room


async def _member(db: AsyncSession, project: Project, user: User, role: str) -> None:
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role=role))
    await db.flush()


@pytest.mark.asyncio
async def test_personal_room_stays_personal(db_session: AsyncSession):
    owner = await _user(db_session, "wr-owner@pmi.local")
    other = await _user(db_session, "wr-other@pmi.local")
    room = await _room(db_session, owner, None)

    assert await _get_room(db_session, room.id, owner.id, "editor") is room
    with pytest.raises(HTTPException) as err:
        await _get_room(db_session, room.id, other.id, "viewer")
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_project_member_may_use_a_room_someone_else_created(
    db_session: AsyncSession,
):
    creator = await _user(db_session, "wr-creator@pmi.local")
    editor = await _user(db_session, "wr-editor@pmi.local")
    project = await _project(db_session, creator, "shared")
    await _member(db_session, project, editor, "editor")
    room = await _room(db_session, creator, project)

    assert await _get_room(db_session, room.id, editor.id, "editor") is room


@pytest.mark.asyncio
async def test_viewer_may_read_but_not_change(db_session: AsyncSession):
    creator = await _user(db_session, "wr-creator2@pmi.local")
    viewer = await _user(db_session, "wr-viewer@pmi.local")
    project = await _project(db_session, creator, "shared")
    await _member(db_session, project, viewer, "viewer")
    room = await _room(db_session, creator, project)

    assert await _get_room(db_session, room.id, viewer.id, "viewer") is room
    with pytest.raises(HTTPException) as err:
        await _get_room(db_session, room.id, viewer.id, "editor")
    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_commenter_may_journal_but_not_edit(db_session: AsyncSession):
    creator = await _user(db_session, "wr-creator3@pmi.local")
    commenter = await _user(db_session, "wr-commenter@pmi.local")
    project = await _project(db_session, creator, "shared")
    await _member(db_session, project, commenter, "commenter")
    room = await _room(db_session, creator, project)

    assert await _get_room(db_session, room.id, commenter.id, "commenter") is room
    with pytest.raises(HTTPException) as err:
        await _get_room(db_session, room.id, commenter.id, "editor")
    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_only_a_project_owner_may_delete_the_room(db_session: AsyncSession):
    creator = await _user(db_session, "wr-creator4@pmi.local")
    editor = await _user(db_session, "wr-editor2@pmi.local")
    project = await _project(db_session, creator, "shared")
    await _member(db_session, project, editor, "editor")
    room = await _room(db_session, creator, project)

    with pytest.raises(HTTPException) as err:
        await _get_room(db_session, room.id, editor.id, "owner")
    assert err.value.status_code == 403
    assert await _get_room(db_session, room.id, creator.id, "owner") is room


@pytest.mark.asyncio
async def test_outsider_cannot_see_a_private_projects_room(db_session: AsyncSession):
    creator = await _user(db_session, "wr-creator5@pmi.local")
    outsider = await _user(db_session, "wr-outsider@pmi.local")
    project = await _project(db_session, creator, "private")
    room = await _room(db_session, creator, project)

    with pytest.raises(HTTPException) as err:
        await _get_room(db_session, room.id, outsider.id, "viewer")
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_company_project_room_is_readable_by_anyone_signed_in(
    db_session: AsyncSession,
):
    creator = await _user(db_session, "wr-creator6@pmi.local")
    passer_by = await _user(db_session, "wr-passerby@pmi.local")
    project = await _project(db_session, creator, "company")
    room = await _room(db_session, creator, project)

    assert await _get_room(db_session, room.id, passer_by.id, "viewer") is room
    with pytest.raises(HTTPException) as err:
        await _get_room(db_session, room.id, passer_by.id, "editor")
    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_missing_room_is_404(db_session: AsyncSession):
    user = await _user(db_session, "wr-nobody@pmi.local")
    with pytest.raises(HTTPException) as err:
        await _get_room(db_session, uuid.uuid4(), user.id, "viewer")
    assert err.value.status_code == 404
