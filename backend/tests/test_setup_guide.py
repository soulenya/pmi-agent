"""Keys saved in the app, and the setup guide's state: who may set a key, where it is kept, who sees what."""

from __future__ import annotations

import pytest
from pywebpush import Vapid01
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.app_secret import AppSecret
from models.db.user import User
from services import secret_store
from services.auth.service import hash_password

KEY = "sk-ant-example-key-0123456789abcdef"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """No key from this computer's environment or keyring, and an empty store."""
    for provider in secret_store.PROVIDERS:
        monkeypatch.delenv(f"{provider.upper()}_API_KEY", raising=False)
    monkeypatch.setattr("config._keyring_get", lambda key: None)
    monkeypatch.setattr(secret_store, "_cache", {})


@pytest.fixture
def on_the_hub(monkeypatch):
    monkeypatch.setattr(settings, "hub_mode", True)


async def _admin_headers(client, db: AsyncSession) -> dict[str, str]:
    db.add(
        User(
            email="owner@pmi.local",
            display_name="Olive Owner",
            hashed_password=hash_password("TestPassword1!"),
            role="admin",
            is_active=True,
        )
    )
    await db.flush()
    resp = await client.post("/auth/login", json={"email": "owner@pmi.local", "password": "TestPassword1!"})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_a_hub_administrator_saves_a_key_in_the_app_and_it_is_used(client, db_session, on_the_hub):
    headers = await _admin_headers(client, db_session)

    resp = await client.put("/settings", headers=headers, json={"anthropic_api_key": f"  {KEY}\n"})

    assert resp.status_code == 200
    assert resp.json()["anthropic_key_set"] is True
    assert settings.get_api_key("anthropic") == KEY
    # At rest it is encrypted, and it comes back after a restart.
    row = (await db_session.execute(select(AppSecret).where(AppSecret.name == "anthropic_api_key"))).scalar_one()
    assert KEY not in row.value_encrypted
    secret_store._cache.clear()
    assert settings.get_api_key("anthropic") is None
    await secret_store.load(db_session)
    assert settings.get_api_key("anthropic") == KEY

    guide = (await client.get("/setup-guide", headers=headers)).json()
    assert guide["keys"]["anthropic"] == "app" and guide["keys"]["voyage"] is None
    assert guide["can_set_keys"] is True and guide["on_hub"] is True


@pytest.mark.asyncio
async def test_a_hub_member_cannot_set_the_company_key(client, auth_headers, db_session, on_the_hub):
    for call in (
        client.put("/settings", headers=auth_headers, json={"anthropic_api_key": KEY, "theme": "dark"}),
        client.put("/settings/api-key", headers=auth_headers, json={"provider": "anthropic", "api_key": KEY}),
    ):
        resp = await call
        assert resp.status_code == 403
    assert settings.get_api_key("anthropic") is None
    assert (await db_session.execute(select(AppSecret))).scalars().all() == []
    assert (await client.get("/setup-guide", headers=auth_headers)).json()["can_set_keys"] is False


@pytest.mark.asyncio
async def test_a_key_from_the_server_wins_over_one_saved_in_the_app(client, db_session, on_the_hub, monkeypatch):
    headers = await _admin_headers(client, db_session)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-from-secret-manager")

    await client.put("/settings", headers=headers, json={"anthropic_api_key": KEY})

    assert settings.get_api_key("anthropic") == "sk-ant-from-secret-manager"
    assert (await client.get("/setup-guide", headers=headers)).json()["keys"]["anthropic"] == "server"


@pytest.mark.asyncio
async def test_a_desktop_still_keeps_its_key_in_the_keyring(client, auth_headers, db_session, monkeypatch):
    kept: dict[str, str] = {}
    monkeypatch.setattr(type(settings), "set_api_key", lambda self, provider, key: kept.update({provider: key}))

    resp = await client.put("/settings", headers=auth_headers, json={"voyage_api_key": "pa-example-0123456789"})

    assert resp.status_code == 200
    assert kept == {"voyage": "pa-example-0123456789"}
    assert (await db_session.execute(select(AppSecret))).scalars().all() == []


@pytest.mark.asyncio
async def test_the_guide_is_put_away_per_person(client, auth_headers, db_session):
    assert (await client.get("/setup-guide", headers=auth_headers)).json()["dismissed"] is False

    resp = await client.put("/setup-guide", headers=auth_headers, json={"dismissed": True})

    assert resp.json()["dismissed"] is True
    other = await _admin_headers(client, db_session)
    assert (await client.get("/setup-guide", headers=other)).json()["dismissed"] is False


@pytest.mark.asyncio
async def test_a_hub_without_push_keys_makes_a_pair_once_that_can_sign(db_session, on_the_hub, monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "")
    monkeypatch.setattr(settings, "vapid_private_key", "")

    assert await secret_store.ensure_push_keys(db_session) is True

    public, private = settings.vapid_public_key, settings.vapid_private_key
    assert len(public) == 87 and len(private) == 43
    # The private half is what pywebpush signs with, and it matches the public half.
    signer = Vapid01.from_string(private)
    assert signer.sign({"sub": "mailto:owner@example.com", "aud": "https://push.example.com"})["Authorization"]
    from cryptography.hazmat.primitives import serialization
    import base64

    point = signer.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    assert base64.urlsafe_b64encode(point).rstrip(b"=").decode() == public
    # A restart reads the same pair back instead of making a new one.
    monkeypatch.setattr(settings, "vapid_public_key", "")
    monkeypatch.setattr(settings, "vapid_private_key", "")
    secret_store._cache.clear()
    await secret_store.load(db_session)
    await secret_store.ensure_push_keys(db_session)
    assert (settings.vapid_public_key, settings.vapid_private_key) == (public, private)
