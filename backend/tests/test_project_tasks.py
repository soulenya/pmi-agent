"""Editing a task in a project has to be able to take something away.

The tasks tab writes a field at a time as you change it, so a PATCH that
quietly discards nulls means a due date, an assignee or a project can be set
once and never removed. These cover the shape the tab actually sends.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import ProjectMember
from models.db.task import Project


async def _project(db: AsyncSession, owner_id, visibility: str = "private") -> Project:
    project = Project(
        name="Task project",
        goal="",
        visibility=visibility,
        owner_id=owner_id,
        created_by=owner_id,
    )
    db.add(project)
    await db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner_id, role="owner"))
    await db.flush()
    return project


async def _task(client: AsyncClient, headers: dict[str, str], **body) -> dict:
    payload = {"title": "Write the thing"}
    payload.update(body)
    resp = await client.post("/tasks", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_create_in_project_with_a_status(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    project = await _project(db_session, test_user.id)
    task = await _task(
        client,
        auth_headers,
        project_id=str(project.id),
        status="in_progress",
        priority="high",
        is_milestone=True,
    )
    assert task["project_id"] == str(project.id)
    assert task["status"] == "in_progress"
    assert task["priority"] == "high"
    assert task["is_milestone"] is True

    listed = await client.get(
        "/tasks", params={"project_id": str(project.id)}, headers=auth_headers
    )
    assert listed.status_code == 200
    assert [t["id"] for t in listed.json()] == [task["id"]]


@pytest.mark.asyncio
async def test_a_due_date_can_be_cleared(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    project = await _project(db_session, test_user.id)
    task = await _task(
        client,
        auth_headers,
        project_id=str(project.id),
        due_date="2026-10-01T12:00:00Z",
    )
    assert task["due_date"] is not None

    resp = await client.patch(
        f"/tasks/{task['id']}", json={"due_date": None}, headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["due_date"] is None


@pytest.mark.asyncio
async def test_an_assignee_can_be_cleared(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    project = await _project(db_session, test_user.id)
    task = await _task(
        client,
        auth_headers,
        project_id=str(project.id),
        assignee_id=str(test_user.id),
    )
    assert task["assignee_id"] == str(test_user.id)

    resp = await client.patch(
        f"/tasks/{task['id']}", json={"assignee_id": None}, headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["assignee_id"] is None


@pytest.mark.asyncio
async def test_a_patch_leaves_unsent_fields_alone(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    """Sending one field must not blank the rest."""
    project = await _project(db_session, test_user.id)
    task = await _task(
        client,
        auth_headers,
        project_id=str(project.id),
        description="The details",
        priority="critical",
        due_date="2026-10-01T12:00:00Z",
    )

    resp = await client.patch(
        f"/tasks/{task['id']}", json={"status": "done"}, headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    after = resp.json()
    assert after["status"] == "done"
    assert after["description"] == "The details"
    assert after["priority"] == "critical"
    assert after["due_date"] is not None
    assert after["completed_at"] is not None


@pytest.mark.asyncio
async def test_held_work_cannot_be_moved_out_of_its_project(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    """Custody still bites now that a null project_id actually reaches it."""
    project = await _project(db_session, test_user.id, visibility="shared")
    task = await _task(client, auth_headers, project_id=str(project.id))

    resp = await client.patch(
        f"/tasks/{task['id']}", json={"project_id": None}, headers=auth_headers
    )
    assert resp.status_code == 409, resp.text
