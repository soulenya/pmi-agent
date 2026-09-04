"""A project's room belongs to the project, not to whoever opened it first.

`list_workrooms` filtered on `Workroom.user_id`, the last place the old
personal-workroom assumption survived. A colleague added to a project could
open the room by id but it was missing from every list, so the Material tab had
nothing to show them.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import ProjectMember
from models.db.task import Project
from models.db.user import User
from models.db.workroom import Workroom
from services.auth.service import hash_password


async def _other_user(db: AsyncSession) -> User:
    user = User(
        email="colleague@pmi.local",
        display_name="Colleague",
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _project_with_room(
    db: AsyncSession, owner: User, visibility: str = "shared"
) -> tuple[Project, Workroom]:
    project = Project(
        name="Shared project",
        goal="",
        visibility=visibility,
        owner_id=owner.id,
        created_by=owner.id,
    )
    db.add(project)
    await db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role="owner"))
    room = Workroom(
        user_id=owner.id,
        project_id=project.id,
        title="Shared project",
        goal="Get it done",
        status="active",
    )
    db.add(room)
    await db.flush()
    return project, room


@pytest.mark.asyncio
async def test_a_project_member_sees_the_projects_room(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    owner = await _other_user(db_session)
    project, room = await _project_with_room(db_session, owner)
    db_session.add(ProjectMember(project_id=project.id, user_id=test_user.id, role="editor"))
    await db_session.flush()

    resp = await client.get("/workrooms", headers=auth_headers)
    assert resp.status_code == 200
    assert str(room.id) in [r["id"] for r in resp.json()]


@pytest.mark.asyncio
async def test_a_private_projects_room_stays_hidden(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    owner = await _other_user(db_session)
    _, room = await _project_with_room(db_session, owner, visibility="private")

    resp = await client.get("/workrooms", headers=auth_headers)
    assert resp.status_code == 200
    assert str(room.id) not in [r["id"] for r in resp.json()]


@pytest.mark.asyncio
async def test_a_company_projects_room_is_listed(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    owner = await _other_user(db_session)
    _, room = await _project_with_room(db_session, owner, visibility="company")

    resp = await client.get("/workrooms", headers=auth_headers)
    assert resp.status_code == 200
    assert str(room.id) in [r["id"] for r in resp.json()]


@pytest.mark.asyncio
async def test_a_personal_room_is_still_only_its_owners(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    owner = await _other_user(db_session)
    room = Workroom(user_id=owner.id, title="Personal", goal="", status="active")
    db_session.add(room)
    await db_session.flush()

    resp = await client.get("/workrooms", headers=auth_headers)
    assert resp.status_code == 200
    assert str(room.id) not in [r["id"] for r in resp.json()]


@pytest.mark.asyncio
async def test_a_member_can_pin_and_unpin_in_the_projects_room(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    owner = await _other_user(db_session)
    project, room = await _project_with_room(db_session, owner)
    db_session.add(ProjectMember(project_id=project.id, user_id=test_user.id, role="editor"))
    await db_session.flush()

    created = await client.post(
        f"/workrooms/{room.id}/items",
        json={"kind": "website", "ref_id": "https://example.com", "label": "Example"},
        headers=auth_headers,
    )
    assert created.status_code == 201, created.text
    item_id = created.json()["id"]

    detail = await client.get(f"/workrooms/{room.id}", headers=auth_headers)
    assert detail.status_code == 200
    assert [i["label"] for i in detail.json()["items"]] == ["Example"]

    removed = await client.delete(f"/workrooms/{room.id}/items/{item_id}", headers=auth_headers)
    assert removed.status_code in (200, 204)

    after = await client.get(f"/workrooms/{room.id}", headers=auth_headers)
    assert after.json()["items"] == []


@pytest.mark.asyncio
async def test_a_viewer_cannot_pin(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    owner = await _other_user(db_session)
    project, room = await _project_with_room(db_session, owner)
    db_session.add(ProjectMember(project_id=project.id, user_id=test_user.id, role="viewer"))
    await db_session.flush()

    resp = await client.post(
        f"/workrooms/{room.id}/items",
        json={"kind": "note", "ref_id": "", "label": "No"},
        headers=auth_headers,
    )
    assert resp.status_code == 403
