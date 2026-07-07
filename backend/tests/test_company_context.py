"""Tests for the Drive-backed company-context feature."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

import services.company_context as cc
from models.db.settings import SystemSetting


async def _seed(db, key: str, value: str) -> None:
    db.add(SystemSetting(key=key, value=value))
    await db.flush()


async def _setting(db, key: str) -> str | None:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return None if row is None else str(row.value)


# ── get_company_context (fast local-cache read path) ──────────────────────────

@pytest.mark.asyncio
async def test_get_company_context_empty_when_nothing_cached(db_session, monkeypatch):
    # Must never touch Drive on the read path — make any Drive call explode.
    import services.google_service as gs

    def _boom(*_a, **_k):  # pragma: no cover - should never run
        raise AssertionError("get_company_context must not hit Drive")

    monkeypatch.setattr(gs, "drive_get_content", _boom)
    assert await cc.get_company_context(db_session) == ""


@pytest.mark.asyncio
async def test_get_company_context_formats_cached_content(db_session):
    await _seed(db_session, cc.KEY_MD, "## Key People\n- Morgan")
    block = await cc.get_company_context(db_session)
    assert "# COMPANY CONTEXT" in block
    assert "## Key People" in block
    assert "search_knowledge_base" in block


@pytest.mark.asyncio
async def test_get_company_context_truncates_over_cap(db_session):
    await _seed(db_session, cc.KEY_MD, "x" * (cc.MAX_COMPANY_CONTEXT_CHARS + 500))
    block = await cc.get_company_context(db_session)
    # The x-run inside the block must be capped even though the source was over.
    longest_x_run = max((len(s) for s in block.split("\n") if set(s) == {"x"}), default=0)
    assert longest_x_run == cc.MAX_COMPANY_CONTEXT_CHARS


# ── sync_company_context_from_drive ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_sync_success_writes_cache_and_returns_true(db_session, monkeypatch):
    import services.google_service as gs

    await _seed(db_session, cc.KEY_DRIVE_FILE_ID, "file123")
    monkeypatch.setattr(gs, "get_credentials", lambda: object())
    monkeypatch.setattr(
        gs,
        "drive_get_content",
        lambda fid: {"content": "# PMI\nfacts", "name": "company-context.md", "type": "md", "url": "u"},
    )

    assert await cc.sync_company_context_from_drive(db_session) is True
    assert await _setting(db_session, cc.KEY_MD) == "# PMI\nfacts"
    synced_at = await _setting(db_session, cc.KEY_SYNCED_AT)
    assert synced_at is not None
    datetime.fromisoformat(synced_at)  # parseable ISO timestamp


@pytest.mark.asyncio
async def test_sync_google_not_connected_returns_false_keeps_cache(db_session, monkeypatch):
    import services.google_service as gs

    await _seed(db_session, cc.KEY_MD, "existing cached value")
    await _seed(db_session, cc.KEY_DRIVE_FILE_ID, "file123")
    monkeypatch.setattr(gs, "get_credentials", lambda: None)

    assert await cc.sync_company_context_from_drive(db_session) is False
    assert await _setting(db_session, cc.KEY_MD) == "existing cached value"


@pytest.mark.asyncio
async def test_sync_no_file_id_configured_returns_false(db_session, monkeypatch):
    import services.google_service as gs

    monkeypatch.setattr(gs, "get_credentials", lambda: object())
    assert await cc.sync_company_context_from_drive(db_session) is False


@pytest.mark.asyncio
async def test_sync_drive_fetch_error_returns_false_keeps_cache(db_session, monkeypatch):
    import services.google_service as gs

    await _seed(db_session, cc.KEY_MD, "existing cached value")
    await _seed(db_session, cc.KEY_DRIVE_FILE_ID, "file123")
    monkeypatch.setattr(gs, "get_credentials", lambda: object())

    def _raise(_fid):
        raise RuntimeError("network down")

    monkeypatch.setattr(gs, "drive_get_content", _raise)

    assert await cc.sync_company_context_from_drive(db_session) is False
    assert await _setting(db_session, cc.KEY_MD) == "existing cached value"


@pytest.mark.asyncio
async def test_sync_over_cap_content_returns_false_keeps_cache(db_session, monkeypatch):
    import services.google_service as gs

    await _seed(db_session, cc.KEY_MD, "existing cached value")
    await _seed(db_session, cc.KEY_DRIVE_FILE_ID, "file123")
    monkeypatch.setattr(gs, "get_credentials", lambda: object())
    monkeypatch.setattr(
        gs,
        "drive_get_content",
        lambda fid: {"content": "y" * (cc.MAX_COMPANY_CONTEXT_CHARS + 1), "name": "f", "type": "md", "url": "u"},
    )

    assert await cc.sync_company_context_from_drive(db_session) is False
    assert await _setting(db_session, cc.KEY_MD) == "existing cached value"


# ── base_agent system-message injection ───────────────────────────────────────

def _bare_agent():
    from services.agent.v2.base_agent import BaseAgent

    agent = BaseAgent.__new__(BaseAgent)  # skip __init__ (would build LC tools)
    agent.SYSTEM_PROMPT = "You are a test agent. Today is {today}."
    return agent


def test_system_message_includes_company_context_when_provided():
    from services.agent.guardrails import HONESTY_CONTRACT

    msg = _bare_agent()._system_message(
        "2026-07-06", True, "", "\n\n# COMPANY CONTEXT\nPMI facts\n"
    )
    content = msg.content
    assert "# COMPANY CONTEXT" in content
    assert "PMI facts" in content
    # Company context must come BEFORE the honesty contract.
    assert content.index("# COMPANY CONTEXT") < content.index(HONESTY_CONTRACT[:40])


def test_system_message_omits_company_context_when_empty():
    msg = _bare_agent()._system_message("2026-07-06", True, "", "")
    assert "# COMPANY CONTEXT" not in msg.content


# ── startup hook resilience ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_startup_sync_never_raises_when_google_disconnected(db_session, monkeypatch):
    """The lifespan one-shot must complete without raising even if the sync fails."""
    import main as main_mod
    import services.google_service as gs

    monkeypatch.setattr(gs, "get_credentials", lambda: None)

    async def _fake_get_db():
        yield db_session

    monkeypatch.setattr(main_mod, "get_db", _fake_get_db)
    await main_mod._company_context_sync_once()  # must not raise
