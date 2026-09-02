"""The desktop's hub link: what it stores, and what it refuses to proxy."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.user import User
from routers.hub import _check_path
from services.auth.service import hash_password
from services.hub import client as hub


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


@pytest.mark.parametrize(
    "path",
    ["projects", "/projects", "projects/123/space", "tasks", "workrooms/1/items"],
)
def test_shared_workspace_paths_are_allowed(path: str):
    assert _check_path(path).startswith("/")


@pytest.mark.parametrize(
    "path",
    [
        "auth/iap",
        "users",
        "documents",
        "conversations",
        "projectsecret",
        "../auth/iap",
        "backups",
    ],
)
def test_everything_else_is_refused(path: str):
    with pytest.raises(HTTPException) as err:
        _check_path(path)
    assert err.value.status_code in (400, 403)


@pytest.mark.asyncio
async def test_link_round_trips_and_hides_the_token(db_session: AsyncSession):
    user = await _user(db_session, "hub-link@pmi.local")
    link = await hub.save_link(
        db_session, user.id, "https://hub.example.com/", "person@pmi-llc.com", "rt-secret"
    )

    assert link.hub_url == "https://hub.example.com"
    assert "rt-secret" not in link.refresh_token_encrypted
    assert hub.decrypt(link.refresh_token_encrypted) == "rt-secret"

    again = await hub.get_link(db_session, user.id)
    assert again is not None
    assert again.email == "person@pmi-llc.com"


@pytest.mark.asyncio
async def test_connecting_again_replaces_the_old_credential(db_session: AsyncSession):
    user = await _user(db_session, "hub-again@pmi.local")
    await hub.save_link(db_session, user.id, "https://a.example.com", "a@pmi-llc.com", "first")
    link = await hub.save_link(
        db_session, user.id, "https://b.example.com", "b@pmi-llc.com", "second"
    )

    assert hub.decrypt(link.refresh_token_encrypted) == "second"
    assert link.hub_url == "https://b.example.com"


@pytest.mark.asyncio
async def test_disconnect_removes_the_link(db_session: AsyncSession):
    user = await _user(db_session, "hub-bye@pmi.local")
    await hub.save_link(db_session, user.id, "https://a.example.com", "a@pmi-llc.com", "rt")

    assert await hub.disconnect(db_session, user.id) is True
    assert await hub.get_link(db_session, user.id) is None
    assert await hub.disconnect(db_session, user.id) is False


@pytest.mark.asyncio
async def test_a_request_without_a_link_says_so(db_session: AsyncSession):
    user = await _user(db_session, "hub-none@pmi.local")
    with pytest.raises(hub.HubNotConnected):
        await hub.request(db_session, user.id, "GET", "/projects")


def test_the_sign_in_client_is_read_from_the_dropped_in_file(tmp_path, monkeypatch):
    client_file = tmp_path / "hub_client.json"
    client_file.write_text(
        json.dumps({"installed": {"client_id": "cid.apps.googleusercontent.com",
                                  "client_secret": "csecret"}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(hub, "_CLIENT_FILE", client_file)
    monkeypatch.setattr(hub.settings, "hub_desktop_client_id", "")
    monkeypatch.setenv("HUB_DESKTOP_CLIENT_SECRET", "")

    assert hub.desktop_client() == ("cid.apps.googleusercontent.com", "csecret")
    assert hub.configured() is True


def test_without_a_client_the_feature_says_it_is_unconfigured(tmp_path, monkeypatch):
    monkeypatch.setattr(hub, "_CLIENT_FILE", tmp_path / "absent.json")
    monkeypatch.setattr(hub.settings, "hub_desktop_client_id", "")
    monkeypatch.setenv("HUB_DESKTOP_CLIENT_SECRET", "")

    with pytest.raises(hub.HubError):
        hub.desktop_client()
    assert hub.configured() is False
