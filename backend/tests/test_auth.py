"""Tests for authentication endpoints."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, test_user) -> None:
    resp = await client.post(
        "/auth/login",
        json={"email": "test@pmi.local", "password": "TestPassword1!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "test@pmi.local"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, test_user) -> None:
    resp = await client.post(
        "/auth/login",
        json={"email": "test@pmi.local", "password": "WrongPassword!"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_email(client: AsyncClient) -> None:
    resp = await client.post(
        "/auth/login",
        json={"email": "nobody@pmi.local", "password": "TestPassword1!"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_me(client: AsyncClient, auth_headers: dict) -> None:
    resp = await client.get("/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "test@pmi.local"


@pytest.mark.asyncio
async def test_get_me_unauthenticated(client: AsyncClient) -> None:
    resp = await client.get("/auth/me")
    assert resp.status_code == 401  # no credentials at all is not authenticated


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient, test_user) -> None:
    login_resp = await client.post(
        "/auth/login",
        json={"email": "test@pmi.local", "password": "TestPassword1!"},
    )
    assert login_resp.status_code == 200
    refresh_token = login_resp.json()["refresh_token"]

    refresh_resp = await client.post(
        "/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_resp.status_code == 200
    assert "access_token" in refresh_resp.json()


@pytest.mark.asyncio
async def test_logout(client: AsyncClient, test_user) -> None:
    login_resp = await client.post(
        "/auth/login",
        json={"email": "test@pmi.local", "password": "TestPassword1!"},
    )
    tokens = login_resp.json()

    logout_resp = await client.post(
        "/auth/logout",
        json={"refresh_token": tokens["refresh_token"]},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert logout_resp.status_code == 204

    # After logout the refresh token must be invalid
    refresh_resp = await client.post(
        "/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert refresh_resp.status_code == 401
