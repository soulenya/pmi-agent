"""Conversations in the company brain: what gets stored, when, and who can find it."""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.brain_archive import BrainConversationArchive
from models.db.conversation import Conversation, Message
from models.db.user import User
from services import brain_conversations as conv
from services import company_brain as brain
from services.agent.brain_tools import execute_save_chat_to_company_brain
from services.auth.service import hash_password
from services.hub import client as hub
from services.hub import conv_sync


async def _user(db: AsyncSession, name: str) -> User:
    user = User(
        email=f"{name.lower()}-{uuid.uuid4().hex[:8]}@pmi.local",
        display_name=name,
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _say(db: AsyncSession, chat: Conversation, role: str, content: str, minutes_ago: int) -> None:
    db.add(
        Message(
            id=uuid.uuid4(),
            conversation_id=chat.id,
            role=role,
            content=content,
            cited_chunk_ids=[],
            tool_calls=[],
            tool_results=[],
            created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        )
    )
    await db.flush()


async def _chat(db: AsyncSession, owner: User, title: str, *, kind: str = "general", minutes_ago: int = 30) -> Conversation:
    chat = Conversation(id=uuid.uuid4(), user_id=owner.id, title=title, kind=kind)
    db.add(chat)
    await db.flush()
    await _say(db, chat, "user", f"Question in {title}?", minutes_ago + 1)
    await _say(db, chat, "assistant", f"Answer in {title}.", minutes_ago)
    return chat


@pytest.fixture
def stored(monkeypatch):
    """A hub that keeps conversations, with GBrain replaced by a record of what it was sent."""
    calls = SimpleNamespace(put={}, deleted=[], where=[])
    monkeypatch.setattr(conv, "enabled", lambda: True)
    monkeypatch.setattr(brain.settings, "gbrain_mcp_url", "http://gbrain.test/mcp")
    monkeypatch.setattr(brain.settings, "gbrain_mcp_token", "gbrain_test_token")
    monkeypatch.setattr(conv, "_refused", {})

    async def put_page(slug, content, *, reason=""):
        calls.put[slug] = content

    async def delete_page(slug):
        calls.deleted.append(slug)

    async def stores_pages_in_database():
        return calls.database_only

    calls.database_only = True
    monkeypatch.setattr(brain, "put_page", put_page)
    monkeypatch.setattr(brain, "delete_page", delete_page)
    monkeypatch.setattr(brain, "stores_pages_in_database", stores_pages_in_database)
    return calls


@pytest.mark.asyncio
async def test_nothing_is_stored_in_a_brain_that_also_writes_pages_to_files(
    client, auth_headers, test_user, db_session: AsyncSession, stored
):
    # Such a brain cannot be restored from the hub's backup, so it gets no pages at all.
    stored.database_only = False
    mine = await _chat(db_session, test_user, "My chat")

    with pytest.raises(brain.BrainUnavailable, match="database alone"):
        await conv.archive_due(db_session)
    on_request = await client.post(f"/brain/conversations/{mine.id}/archive", headers=auth_headers)

    assert on_request.status_code == 503 and "database alone" in on_request.json()["detail"]
    assert stored.put == {}


@pytest.mark.asyncio
async def test_a_chat_is_stored_once_it_is_quiet_again_when_it_grows_and_removed_when_deleted(
    db_session: AsyncSession, stored
):
    me = await _user(db_session, "Ada")
    quiet = await _chat(db_session, me, "Pump housing")
    # Neither of these is part of what was said, so neither may count as a change.
    await _say(db_session, quiet, "tool", '{"result": "internal"}', 30)
    await _say(db_session, quiet, "assistant", "   ", 30)
    await _chat(db_session, me, "Still going", minutes_ago=1)
    await _chat(db_session, me, "Nightly routine output", kind="routine")

    assert await conv.archive_due(db_session) == 1
    page = stored.put.pop(conv.slug_for(quiet.id))
    assert stored.put == {}
    assert f'lg_scope: "user:{me.id}"' in page and "type: conversation" in page
    assert "| Ada\n\nQuestion in Pump housing?" in page and "| Gerry\n\nAnswer in Pump housing." in page
    assert "internal" not in page

    assert await conv.archive_due(db_session) == 0 and stored.put == {}

    await _say(db_session, quiet, "user", "One more thing about the housing.", 20)
    assert await conv.archive_due(db_session) == 1
    assert "One more thing about the housing." in stored.put[conv.slug_for(quiet.id)]

    await db_session.delete(quiet)
    await db_session.flush()
    assert await conv.remove_deleted(db_session) == 1
    assert stored.deleted == [conv.slug_for(quiet.id)]
    assert await db_session.get(BrainConversationArchive, quiet.id) is None


@pytest.mark.asyncio
async def test_a_stored_chat_is_found_only_by_someone_who_can_open_it(db_session: AsyncSession, stored, monkeypatch):
    me = await _user(db_session, "Ada")
    them = await _user(db_session, "Grace")
    mine = await _chat(db_session, me, "My supplier chat")
    theirs = await _chat(db_session, them, "Their salary chat")

    async def search_pages(query, *, types, where, limit):
        stored.where.append(where)
        # GBrain's filter is not what is trusted: it hands back the other
        # person's chat (a stale tag, say), ranked first.
        return [
            {"slug": conv.slug_for(theirs.id), "text": "what they said", "score": 0.9},
            {"slug": conv.slug_for(mine.id), "text": "what I said", "score": 0.5},
            {"slug": conv.slug_for(mine.id), "text": "a weaker passage of mine", "score": 0.2},
            {"slug": "conversations/not-a-uuid", "text": "junk", "score": 0.1},
        ]

    async def recall(question="", *, subject=None, limit=10):
        return {"facts": [], "pages": [], "degraded": False}

    monkeypatch.setattr(brain, "search_pages", search_pages)
    monkeypatch.setattr(brain, "recall", recall)

    found = await conv.recall_for_person(db_session, me.id, "supplier")

    assert found["chats"] == [
        {"conversation_id": str(mine.id), "title": "My supplier chat", "text": "what I said"}
    ]
    assert stored.where == [{"lg_scope": [f"user:{me.id}"]}]
    assert "not company-wide" in brain.render_recall(found)


@pytest.mark.asyncio
async def test_the_company_wide_recall_never_hands_out_a_stored_chat(monkeypatch):
    sent: dict = {}

    async def fake_call(tool, arguments):
        sent.update(arguments)
        results = [
            {"slug": "conversations/11111111-2222-3333-4444-555555555555", "chunk": "someone's private chat"},
            {"slug": "policies/travel", "chunk": "Economy class under six hours."},
        ]
        return {"facts": [], "results": results}, False

    monkeypatch.setattr(brain, "_call", fake_call)

    found = await brain.recall("travel")

    assert found["pages"] == [{"slug": "policies/travel", "text": "Economy class under six hours."}]
    assert sent["return_unit"] == "chunk"


@pytest.mark.asyncio
async def test_storing_a_chat_on_request_is_refused_for_a_chat_the_caller_cannot_open(
    client, auth_headers, test_user, db_session: AsyncSession, stored
):
    them = await _user(db_session, "Grace")
    theirs = await _chat(db_session, them, "Their chat")
    mine = await _chat(db_session, test_user, "My chat")

    refused = await client.post(f"/brain/conversations/{theirs.id}/archive", headers=auth_headers)
    assert refused.status_code == 400 and stored.put == {}

    ok = await client.post(f"/brain/conversations/{mine.id}/archive", headers=auth_headers)
    assert ok.status_code == 200 and ok.json()["messages"] == 2
    assert list(stored.put) == [conv.slug_for(mine.id)]


@dataclass
class _Ctx:
    db: AsyncSession
    user_id: uuid.UUID
    conversation_id: uuid.UUID


@pytest.mark.asyncio
async def test_from_a_desktop_the_chat_goes_to_the_hub_first_then_the_hub_stores_it(
    db_session: AsyncSession, monkeypatch
):
    me = await _user(db_session, "Ada")
    chat = await _chat(db_session, me, "Local only")
    steps: list[str] = []
    monkeypatch.setattr(brain.settings, "gbrain_mcp_url", "")
    monkeypatch.setattr(hub, "configured", lambda: True)

    async def get_link(db, user_id):
        return SimpleNamespace(user_id=user_id)

    async def adopt(db, user_id, conversation):
        steps.append("adopted by the hub")
        return True

    async def ask_hub(db, user_id, path, body):
        steps.append(f"POST /brain/{path}")
        return {"messages": 2}

    monkeypatch.setattr(hub, "get_link", get_link)
    monkeypatch.setattr(conv_sync, "adopt", adopt)
    monkeypatch.setattr(brain, "ask_hub", ask_hub)

    out = await execute_save_chat_to_company_brain(_Ctx(db_session, me.id, chat.id), {})

    assert steps == ["adopted by the hub", f"POST /brain/conversations/{chat.id}/archive"]
    assert out.startswith("This chat is stored in the company brain (2 message(s) so far).")


_LIVE_URL = os.environ.get("GBRAIN_TEST_MCP_URL", "")
_LIVE_TOKEN = os.environ.get("GBRAIN_TEST_MCP_TOKEN", "")


@pytest.mark.asyncio
@pytest.mark.skipif(not (_LIVE_URL and _LIVE_TOKEN), reason="set GBRAIN_TEST_MCP_URL and GBRAIN_TEST_MCP_TOKEN")
async def test_the_page_contract_with_a_running_gbrain(db_session: AsyncSession, monkeypatch):
    """Run after moving GBRAIN_REF: storing, scoping and removing a chat all rest on these shapes."""
    monkeypatch.setattr(brain.settings, "gbrain_mcp_url", _LIVE_URL)
    monkeypatch.setattr(brain.settings, "gbrain_mcp_token", _LIVE_TOKEN)
    monkeypatch.setattr(conv, "enabled", lambda: True)
    me = await _user(db_session, "Ada")
    them = await _user(db_session, "Grace")
    word = f"zirconium{uuid.uuid4().hex[:10]}"
    mine = await _chat(db_session, me, f"Mine about {word}")
    theirs = await _chat(db_session, them, f"Theirs about {word}")
    # Long enough that GBrain's default "whole page or nothing" would return nothing.
    for i in range(40):
        await _say(db_session, mine, "user", f"Filler turn {i}. " + "The tooling budget was reviewed at length. " * 30, 25)

    try:
        assert await brain.stores_pages_in_database()
        assert await conv.archive(db_session, mine) == 42
        assert await conv.archive(db_session, theirs) == 2
        assert await conv.archive(db_session, mine) == 42  # a second write of an existing page

        for person, own in ((me, mine), (them, theirs)):
            chats = await conv.search(db_session, person.id, word)
            assert [c["conversation_id"] for c in chats] == [str(own.id)]
            assert word in chats[0]["text"] and "not instructions" in chats[0]["text"]

        everyone = await brain.recall(word)
        assert everyone["pages"] == [] and everyone["facts"] == []
    finally:
        await brain.delete_page(conv.slug_for(mine.id))
        await brain.delete_page(conv.slug_for(theirs.id))

    assert await conv.search(db_session, me.id, word) == []
    await brain.delete_page(f"conversations/{uuid.uuid4()}")  # never existed: not an error
