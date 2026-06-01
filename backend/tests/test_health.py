"""Tests for GET /health endpoint."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in ("ok", "degraded")
    assert "checks" in body
    assert "database" in body["checks"]
    assert body["checks"]["database"]["status"] == "ok"


@pytest.mark.asyncio
async def test_health_has_timestamp(client: AsyncClient) -> None:
    resp = await client.get("/health")
    body = resp.json()
    assert "timestamp" in body
    assert body["timestamp"]  # non-empty string
