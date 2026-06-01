"""
pytest fixtures for test database, test client, and auth utilities.

Uses a separate test database configured via TEST_DATABASE_URL env var.
Each test function gets its own transaction, rolled back at teardown.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from database import get_db
from main import app
from models.db import Base  # ensures all models are imported
from services.auth.service import hash_password

# ── Test DB URL ───────────────────────────────────────────────────────────────

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://pmi_app:pmi_app_password@localhost:5432/pmi_test",
)

# ── Async engine / session factory ───────────────────────────────────────────

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_test_tables():
    """Create all tables once per test session, then drop them at teardown."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Each test gets a transaction that is rolled back at the end."""
    async with test_engine.begin() as conn:
        session = AsyncSession(bind=conn)
        try:
            yield session
        finally:
            await session.close()
            await conn.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient with the test DB session overriding the real one."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession):
    """Create a test user and return it."""
    from models.db.user import User

    user = User(
        email="test@pmi.local",
        display_name="Test User",
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def auth_headers(client: AsyncClient, test_user) -> dict[str, str]:
    """Log in as the test user and return Authorization headers."""
    resp = await client.post(
        "/auth/login",
        json={"email": "test@pmi.local", "password": "TestPassword1!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    return {"Authorization": f"Bearer {data['access_token']}"}
