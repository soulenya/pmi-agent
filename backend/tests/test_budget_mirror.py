"""Mirroring a budget to where a shared project lives.

The hub runs the same image as the desktop but has no Google account, so any
budget call that touches Drive fails there — which is exactly what happened
when the Budget tab of a shared project posted straight to the hub. The sheet
is made on the owner's computer and only the finished figures travel. These
tests hold the mirror endpoint to that: no Google, and no duplicate budget when
the same sheet is sent twice.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from database import get_db
from dependencies import get_current_user
from main import app
from models.db.budget import Budget
from models.db.user import User


@pytest.fixture
def sheet() -> dict:
    return {
        "title": "CLIN 001",
        "drive_file_id": "1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "drive_url": "https://docs.google.com/spreadsheets/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "allotment": 5000.0,
        "currency": "USD",
        "cached_ledger": [{"row": 2, "description": "Deposit", "amount": 100.0}],
        "cached_categories": [{"name": "Labour"}],
        "cached_summary": {"total_spent": 100.0},
    }


@pytest.fixture
async def as_user(db_session, test_user: User):
    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: test_user
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
    app.dependency_overrides.clear()


class TestMirror:
    async def test_mirroring_needs_no_google(self, as_user, sheet, monkeypatch):
        """The whole point: this must work on a machine with no Drive access."""
        import services.google_service as gs

        def explode(*args, **kwargs):
            raise AssertionError("the mirror endpoint must not call Google")

        monkeypatch.setattr(gs, "get_credentials", explode, raising=False)
        monkeypatch.setattr(gs, "drive_get_metadata", explode, raising=False)

        r = await as_user.post("/budgets/mirror", json=sheet)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["title"] == "CLIN 001"
        assert body["cached_ledger"] == sheet["cached_ledger"]
        assert body["cached_summary"] == {"total_spent": 100.0}

    async def test_sending_the_same_sheet_twice_updates_it(
        self, as_user, db_session, test_user, sheet
    ):
        """Otherwise a second visit to the tab would stack up duplicates."""
        first = (await as_user.post("/budgets/mirror", json=sheet)).json()

        moved = dict(sheet, title="CLIN 001 revised", cached_summary={"total_spent": 250.0})
        second = (await as_user.post("/budgets/mirror", json=moved)).json()

        assert second["id"] == first["id"]
        assert second["title"] == "CLIN 001 revised"
        assert second["cached_summary"] == {"total_spent": 250.0}

        rows = (
            await db_session.execute(
                select(Budget).where(Budget.user_id == test_user.id)
            )
        ).scalars().all()
        assert len(rows) == 1

    async def test_another_persons_sheet_is_a_separate_budget(
        self, as_user, db_session, test_user, sheet
    ):
        """One person mirroring a sheet must not overwrite someone else's row."""
        from services.auth.service import hash_password

        stranger = User(
            email="stranger@pmi.local",
            display_name="Stranger",
            hashed_password=hash_password("TestPassword1!"),
            role="user",
            is_active=True,
        )
        db_session.add(stranger)
        await db_session.flush()
        other = Budget(
            user_id=stranger.id,
            title="Theirs",
            drive_file_id=sheet["drive_file_id"],
            drive_url="",
        )
        db_session.add(other)
        await db_session.flush()

        made = (await as_user.post("/budgets/mirror", json=sheet)).json()

        assert made["id"] != str(other.id)
        assert other.title == "Theirs"
