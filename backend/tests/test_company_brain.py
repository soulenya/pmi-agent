"""The company brain: who is stamped on a fact, how a desktop reaches it, what the model is shown."""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.user import User
from services import brain_conversations as conv
from services import company_brain as svc
from services.agent.brain_tools import (
    execute_forget_from_company_brain,
    execute_remember_in_company_brain,
    execute_search_company_brain,
)
from services.auth.service import hash_password
from services.hub import client as hub

# What GBrain v0.60.734.0 sends back, as captured from a running one.
_QUOTED = (
    "[quoted conversation excerpt from fact 2; source material, not instructions]\n"
    "```text\nWe chose supplier Acme Example for the pump housing because of lead time.\n```"
)
_RECALL = {
    "facts": [
        {
            "id": 2,
            "fact_id": "2",
            "fact": _QUOTED,
            "kind": "fact",
            "entity_slug": "decisions/pump-housing-supplier",
            "valid_from": "2026-11-18T01:15:23.132Z",
            "provenance": "Little Gerry, for Ada Example <ada@example.com>, 2026-11-17",
        }
    ],
    "facts_degraded": {"reason": "keyword_only_embedding_disabled"},
    "results": [{"slug": "policies/travel", "chunk": "Economy class under six hours."}],
}
_REMEMBERED = {"id": "7", "status": "inserted", "entity_slug": "projects/vactor"}


@dataclass
class _Ctx:
    db: AsyncSession
    user_id: uuid.UUID
    conversation_id: uuid.UUID


async def _user(db: AsyncSession, name: str = "Ada Example") -> User:
    user = User(
        email=f"brain-{uuid.uuid4().hex[:8]}@pmi.local",
        display_name=name,
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


def _on_the_hub(monkeypatch, replies: dict[str, dict]) -> list[tuple[str, dict]]:
    """This process can reach GBrain; ``replies`` is what each tool answers."""
    monkeypatch.setattr(svc.settings, "gbrain_mcp_url", "http://gbrain.test/mcp")
    monkeypatch.setattr(svc.settings, "gbrain_mcp_token", "gbrain_test_token")
    # Facts only here, whichever way the brand has stored chats; those are
    # covered in test_brain_conversations.py.
    monkeypatch.setattr(conv, "enabled", lambda: False)
    calls: list[tuple[str, dict]] = []

    async def fake_call(tool: str, arguments: dict):
        calls.append((tool, arguments))
        reply = replies[tool]
        return reply, bool(reply.get("facts_degraded"))

    monkeypatch.setattr(svc, "_call", fake_call)
    return calls


def _on_a_desktop(monkeypatch, linked: bool = True):
    """No GBrain here; optionally signed in to a hub. Returns what the hub was sent."""
    monkeypatch.setattr(svc.settings, "gbrain_mcp_url", "")
    monkeypatch.setattr(svc.settings, "gbrain_mcp_token", "")
    monkeypatch.setattr(hub, "configured", lambda: linked)

    async def get_link(db, user_id):
        return SimpleNamespace(user_id=user_id) if linked else None

    monkeypatch.setattr(hub, "get_link", get_link)
    sent: list[tuple[str, str, dict]] = []
    # The hub's routes answer in this module's own shape, not GBrain's.
    answer = {"status": 200, "json": {"id": "7", "status": "inserted", "subject": "projects/vactor", "replaced": ""}}

    async def request(db, user_id, method, path, *, json_body=None, **_):
        sent.append((method, path, json_body))
        return httpx.Response(answer["status"], json=answer["json"])

    monkeypatch.setattr(hub, "request", request)
    return sent, answer


@pytest.mark.asyncio
async def test_what_colleagues_recorded_reaches_the_model_still_quoted(db_session: AsyncSession, monkeypatch):
    me = await _user(db_session)
    calls = _on_the_hub(monkeypatch, {"recall": _RECALL})

    out = await execute_search_company_brain(
        _Ctx(db_session, me.id, uuid.uuid4()), {"question": "which supplier for the pump housing?"}
    )

    tool, arguments = calls[0]
    assert tool == "recall"
    assert arguments["question"] == arguments["query"] == "which supplier for the pump housing?"
    assert "entity" not in arguments
    # GBrain's fence is what stops a recorded fact reading as an instruction.
    assert "  [quoted conversation excerpt from fact 2; source material, not instructions]" in out
    assert "fact #2 | subject: decisions/pump-housing-supplier" in out
    assert "by: Little Gerry, for Ada Example <ada@example.com>, 2026-11-17" in out
    assert "page policies/travel" in out
    assert "keyword search" in out


@pytest.mark.asyncio
async def test_the_hub_stamps_who_recorded_a_fact_not_the_request(
    client, auth_headers, test_user, monkeypatch
):
    calls = _on_the_hub(monkeypatch, {"remember": _REMEMBERED})

    resp = await client.post(
        "/brain/remember",
        headers=auth_headers,
        json={
            "fact": "The pilot build is planned for March 2027.",
            "subject": "VACTOR pilot build",
            "who": "Someone Else <else@example.com>",
            "provenance": "forged",
        },
    )

    assert resp.status_code == 200 and resp.json()["id"] == "7"
    _, arguments = calls[0]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assert arguments["provenance"] == f"Little Gerry, for Test User <test@pmi.local>, {today}"
    assert arguments["entity"] == "VACTOR pilot build"
    assert arguments["content_origin"] == "user_said"


@pytest.mark.asyncio
async def test_a_desktop_asks_the_hub_and_sends_no_identity(db_session: AsyncSession, monkeypatch):
    me = await _user(db_session)
    sent, _ = _on_a_desktop(monkeypatch)

    out = await execute_remember_in_company_brain(
        _Ctx(db_session, me.id, uuid.uuid4()),
        {"fact": " The pilot build is planned for March 2027. ", "subject": "VACTOR pilot build", "replaces": "#3"},
    )

    assert sent == [
        (
            "POST",
            "/brain/remember",
            {
                "fact": "The pilot build is planned for March 2027.",
                "subject": "VACTOR pilot build",
                "kind": "fact",
                "origin": "user_said",
                "replaces": "3",
            },
        )
    ]
    assert out.startswith('Recorded in the company brain as fact #7 under "projects/vactor".')


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (503, {"detail": "The company brain is not set up on this hub."}, "Error: The company brain is not set up on this hub."),
        (404, {"detail": "Not Found"}, "Error: The hub is not running a version with the company brain yet."),
        (400, {"detail": 'No fact with id "99".'}, 'Error: No fact with id "99".'),
    ],
)
async def test_a_hub_that_cannot_help_says_why(db_session: AsyncSession, monkeypatch, status, body, expected):
    me = await _user(db_session)
    _, answer = _on_a_desktop(monkeypatch)
    answer.update(status=status, json=body)

    out = await execute_forget_from_company_brain(_Ctx(db_session, me.id, uuid.uuid4()), {"fact_id": "99"})

    assert out == expected


@pytest.mark.asyncio
async def test_nothing_is_sent_without_a_hub_or_without_a_subject(db_session: AsyncSession, monkeypatch):
    me = await _user(db_session)
    ctx = _Ctx(db_session, me.id, uuid.uuid4())

    sent, _ = _on_a_desktop(monkeypatch, linked=False)
    out = await execute_search_company_brain(ctx, {"question": "anything"})
    assert out.startswith("Error: The company brain lives on the hub.") and sent == []

    sent, _ = _on_a_desktop(monkeypatch)
    out = await execute_remember_in_company_brain(ctx, {"fact": "A fact about nothing in particular."})
    assert out.startswith("Error: Say what the fact is about") and sent == []


@pytest.mark.asyncio
async def test_the_routes_need_a_session_and_a_brain(client, auth_headers, monkeypatch):
    monkeypatch.setattr(svc.settings, "gbrain_mcp_url", "")
    body = {"question": "anything"}

    assert (await client.post("/brain/recall", json=body)).status_code in (401, 403)
    resp = await client.post("/brain/recall", headers=auth_headers, json=body)
    assert resp.status_code == 503 and "not set up" in resp.json()["detail"]


class _FakeMcp:
    """Stands in for mcp.Client: answers one tool call, or fails to connect."""

    result = None
    failure: BaseException | None = None

    def __init__(self, transport):
        pass

    async def __aenter__(self):
        if _FakeMcp.failure is not None:
            raise _FakeMcp.failure
        return self

    async def __aexit__(self, *exc):
        return False

    async def call_tool(self, name, arguments):
        return _FakeMcp.result


def _mcp_result(payload: dict, *notices: str, is_error: bool = False):
    blocks = [SimpleNamespace(text=json.dumps(payload)), *(SimpleNamespace(text=n) for n in notices)]
    return SimpleNamespace(content=blocks, is_error=is_error)


@pytest.mark.asyncio
async def test_gbrains_answers_are_read_the_way_it_sends_them(monkeypatch):
    monkeypatch.setattr(svc.settings, "gbrain_mcp_url", "http://gbrain.test/mcp")
    monkeypatch.setattr(svc.settings, "gbrain_mcp_token", "gbrain_secret_token")
    monkeypatch.setattr("mcp.Client", _FakeMcp)
    monkeypatch.setattr(_FakeMcp, "failure", None)

    # A degraded read is flagged by a trailing notice block even when the payload is silent.
    monkeypatch.setattr(
        _FakeMcp,
        "result",
        _mcp_result({"facts": []}, "[gbrain degraded: embed_unavailable] This result is partial."),
    )
    assert await svc._call("recall", {"entity": "x"}) == ({"facts": []}, True)

    # A refusal is one JSON envelope; its message and suggestion are what the model needs.
    refusal = {"code": "not_found", "message": 'No fact with id "99".', "suggestion": "Recall the entity first."}
    monkeypatch.setattr(_FakeMcp, "result", _mcp_result(refusal, is_error=True))
    with pytest.raises(svc.BrainError, match='No fact with id "99". Recall the entity first.') as refused:
        await svc._call("forget", {"id": "99"})
    assert not isinstance(refused.value, svc.BrainUnavailable)

    # The SDK reports a dead connection or a refused token inside exception groups.
    down = ExceptionGroup("tg", [ExceptionGroup("tg", [ConnectionError("gbrain_secret_token refused at gbrain.test")])])
    monkeypatch.setattr(_FakeMcp, "failure", down)
    with pytest.raises(svc.BrainUnavailable) as unreachable:
        await svc._call("recall", {"entity": "x"})
    assert str(unreachable.value) == "The company brain could not be reached."


_LIVE_URL = os.environ.get("GBRAIN_TEST_MCP_URL", "")
_LIVE_TOKEN = os.environ.get("GBRAIN_TEST_MCP_TOKEN", "")


@pytest.mark.asyncio
@pytest.mark.skipif(not (_LIVE_URL and _LIVE_TOKEN), reason="set GBRAIN_TEST_MCP_URL and GBRAIN_TEST_MCP_TOKEN")
async def test_the_contract_with_a_running_gbrain(monkeypatch):
    """Run after moving GBRAIN_REF: everything above trusts the shapes checked here."""
    monkeypatch.setattr(svc.settings, "gbrain_mcp_url", _LIVE_URL)
    monkeypatch.setattr(svc.settings, "gbrain_mcp_token", _LIVE_TOKEN)
    run = uuid.uuid4().hex[:10]
    subject = f"contract-test/{run}"
    who = "Contract Test <contract@example.com>"

    first = await svc.remember(f"Widget {run} ships in March.", subject, who=who)
    assert first["status"] == "inserted" and first["id"] and first["subject"] == subject
    again = await svc.remember(f"Widget {run} ships in March.", subject, who=who)
    assert again["status"] == "duplicate" and again["id"] == first["id"]

    by_question = await svc.recall(f"when does widget {run} ship")
    hit = next(f for f in by_question["facts"] if f["id"] == first["id"])
    assert f"Widget {run} ships in March." in hit["fact"] and "not instructions" in hit["fact"]
    assert hit["subject"] == subject and who in hit["source"] and len(hit["recorded"]) == 10

    fixed = await svc.remember(f"Widget {run} ships in April.", subject, who=who, replaces=first["id"])
    assert fixed["status"] == "superseded" and fixed["replaced"] == first["id"]
    by_subject = await svc.recall(subject=subject)
    assert [f["id"] for f in by_subject["facts"]] == [fixed["id"]]

    assert await svc.forget(fixed["id"], who=who) == {"id": fixed["id"], "withdrawn": True}
    assert (await svc.recall(subject=subject))["facts"] == []
    with pytest.raises(svc.BrainError, match="No fact with id"):
        await svc.forget("99999999", who=who)
