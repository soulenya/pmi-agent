"""Canvas geometry survives a round trip.

The board saves in debounced batches, so anything the batch drops is a change
the user watches snap back. These cover what the whiteboard actually sends.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_member import ProjectMember
from models.db.task import Project, Task


async def _project(db: AsyncSession, owner_id) -> Project:
    project = Project(
        name="Canvas project",
        goal="",
        visibility="private",
        owner_id=owner_id,
        created_by=owner_id,
    )
    db.add(project)
    await db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner_id, role="owner"))
    await db.flush()
    return project


async def _canvas(client: AsyncClient, headers: dict[str, str], project_id) -> dict:
    resp = await client.get(f"/projects/{project_id}/canvas/default", headers=headers)
    assert resp.status_code == 200
    return resp.json()


async def _node(
    client: AsyncClient, headers: dict[str, str], project_id, canvas_id, **body
) -> dict:
    payload = {"kind": "shape", "x": 0, "y": 0, "width": 140, "height": 100}
    payload.update(body)
    resp = await client.post(
        f"/projects/{project_id}/canvas/{canvas_id}/nodes", json=payload, headers=headers
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_batch_saves_size_and_depth(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    project = await _project(db_session, test_user.id)
    canvas = await _canvas(client, auth_headers, project.id)
    node = await _node(client, auth_headers, project.id, canvas["id"])

    resp = await client.patch(
        f"/projects/{project.id}/canvas/{canvas['id']}/nodes",
        json={"nodes": [{"id": node["id"], "width": 420, "height": 260, "z": 7}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text

    fresh = await _canvas(client, auth_headers, project.id)
    saved = next(n for n in fresh["nodes"] if n["id"] == node["id"])
    assert saved["width"] == 420
    assert saved["height"] == 260
    assert saved["z"] == 7


@pytest.mark.asyncio
async def test_batch_saves_style_and_text(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    project = await _project(db_session, test_user.id)
    canvas = await _canvas(client, auth_headers, project.id)
    node = await _node(
        client, auth_headers, project.id, canvas["id"], style={"color": "#fde68a"}
    )

    style = {"color": "#bfdbfe", "shape": "ellipse", "fill": "none", "autoHeight": False}
    resp = await client.patch(
        f"/projects/{project.id}/canvas/{canvas['id']}/nodes",
        json={"nodes": [{"id": node["id"], "style": style, "content": "In the shape"}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text

    fresh = await _canvas(client, auth_headers, project.id)
    saved = next(n for n in fresh["nodes"] if n["id"] == node["id"])
    assert saved["style"] == style
    assert saved["content"] == "In the shape"


@pytest.mark.asyncio
async def test_batch_leaves_untouched_fields_alone(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    project = await _project(db_session, test_user.id)
    canvas = await _canvas(client, auth_headers, project.id)
    node = await _node(
        client,
        auth_headers,
        project.id,
        canvas["id"],
        content="Keep me",
        style={"color": "#fde68a"},
    )

    resp = await client.patch(
        f"/projects/{project.id}/canvas/{canvas['id']}/nodes",
        json={"nodes": [{"id": node["id"], "x": 55, "y": 66}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text

    fresh = await _canvas(client, auth_headers, project.id)
    saved = next(n for n in fresh["nodes"] if n["id"] == node["id"])
    assert saved["x"] == 55
    assert saved["y"] == 66
    assert saved["content"] == "Keep me"
    assert saved["style"] == {"color": "#fde68a"}


@pytest.mark.asyncio
async def test_batch_ignores_nodes_from_another_canvas(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    first = await _project(db_session, test_user.id)
    second = await _project(db_session, test_user.id)
    canvas_one = await _canvas(client, auth_headers, first.id)
    canvas_two = await _canvas(client, auth_headers, second.id)
    stranger = await _node(client, auth_headers, second.id, canvas_two["id"])

    resp = await client.patch(
        f"/projects/{first.id}/canvas/{canvas_one['id']}/nodes",
        json={"nodes": [{"id": stranger["id"], "width": 999}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []

    fresh = await _canvas(client, auth_headers, second.id)
    saved = next(n for n in fresh["nodes"] if n["id"] == stranger["id"])
    assert saved["width"] == 140


@pytest.mark.asyncio
async def test_a_task_card_says_which_task_it_sits_under(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, test_user
):
    """The board folds a family away, so it has to be told there is one."""
    project = await _project(db_session, test_user.id)
    parent = Task(title="Dig the trench", project_id=project.id, created_by=test_user.id)
    db_session.add(parent)
    await db_session.flush()
    child = Task(
        title="Call for locates",
        project_id=project.id,
        created_by=test_user.id,
        parent_task_id=parent.id,
    )
    db_session.add(child)
    await db_session.flush()

    canvas = await _canvas(client, auth_headers, project.id)
    top = await _node(
        client, auth_headers, project.id, canvas["id"], kind="task", ref_id=str(parent.id)
    )
    under = await _node(
        client, auth_headers, project.id, canvas["id"], kind="task", ref_id=str(child.id)
    )

    resp = await client.post(
        f"/projects/{project.id}/canvas/{canvas['id']}/resolve",
        json={"node_ids": [top["id"], under["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    by_node = {item["node_id"]: item for item in resp.json()["items"]}
    assert by_node[under["id"]]["parent_ref_id"] == str(parent.id)
    assert by_node[top["id"]]["parent_ref_id"] is None
