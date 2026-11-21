"""More AI providers: one registry, a stand-in service that speaks OpenAI's API, and embeddings that follow."""

from __future__ import annotations

import dataclasses
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.document import Document, DocumentChunk
from models.db.settings import SystemSetting
from models.db.user import User
from services import secret_store
from services.auth.service import hash_password
from services.embeddings.service import CompatibleEmbeddingService, get_embedding_service_for_db
from services.llm import providers
from services.llm.catalog import refresh_model_catalog
from services.llm.router import get_llm_client

GOOD_KEY = "stand-in-key"


class _StandIn(BaseHTTPRequestHandler):
    """Answers the three calls the app makes, the way Gemini's OpenAI-compatible address does."""

    def log_message(self, *args):
        pass

    def _send(self, code: int, body: bytes, content_type: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _allowed(self) -> bool:
        if self.headers.get("Authorization") == f"Bearer {GOOD_KEY}":
            return True
        self._send(401, b'{"error": {"message": "API key not valid"}}')
        return False

    def do_GET(self):
        if not self._allowed():
            return
        ids = [
            "models/gemini-9-pro", "models/gemini-9-flash", "models/gemini-embedding-001",
            "models/gemini-9-flash-image", "models/imagen-9", "models/gemini-9-flash-tts",
        ]
        self._send(200, json.dumps({"object": "list", "data": [{"id": i, "object": "model"} for i in ids]}).encode())

    def do_POST(self):
        if not self._allowed():
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.append((self.path, body))
        if self.path.endswith("/embeddings"):
            # 3072 numbers each, answered out of order. The first number says which text it was.
            rows = [
                {"object": "embedding", "index": i, "embedding": [10.0 * (i + 1)] + [1.0] * 3071}
                for i in range(len(body["input"]))
            ]
            self._send(200, json.dumps({"object": "list", "data": rows[::-1], "model": body["model"]}).encode())
            return

        def chunk(delta: dict, finish: str | None = None) -> bytes:
            return b"data: " + json.dumps({
                "id": "c1", "object": "chat.completion.chunk", "created": 0, "model": body["model"],
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }).encode() + b"\n\n"

        if any(m["role"] == "tool" for m in body["messages"]):
            out = chunk({"role": "assistant", "content": "Done."}, "stop")
        else:
            # Two calls, each sent whole, both under index 0, the first carrying
            # the signature Gemini insists on getting back.
            out = chunk({"role": "assistant", "tool_calls": [{
                "index": 0, "id": "call_a", "type": "function",
                "function": {"name": "read_bank", "arguments": '{"account": "1"}'},
                "extra_content": {"google": {"thought_signature": "sig-a"}},
            }]}) + chunk({"tool_calls": [{
                "index": 0, "id": "call_b", "type": "function",
                "function": {"name": "list_leads", "arguments": "{}"},
            }]}, "tool_calls")
        self._send(200, out + b"data: [DONE]\n\n", "text/event-stream")


@pytest.fixture
def stand_in(monkeypatch):
    """Gemini's entry in the registry pointed at a local server."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StandIn)
    server.requests = []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setitem(
        providers.PROVIDERS, "gemini",
        dataclasses.replace(providers.PROVIDERS["gemini"], base_url=f"http://127.0.0.1:{server.server_port}/v1"),
    )
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture(autouse=True)
def _no_keys_from_this_computer(monkeypatch):
    for name in secret_store.PROVIDERS:
        monkeypatch.delenv(f"{name.upper()}_API_KEY", raising=False)
    monkeypatch.setattr("config._keyring_get", lambda key: None)
    monkeypatch.setattr(secret_store, "_cache", {})


async def _set(db: AsyncSession, **values: str) -> None:
    for key, value in values.items():
        db.add(SystemSetting(key=key.replace("__", "."), value=value))
    await db.flush()


async def _embedded_document(db: AsyncSession, model: str) -> None:
    doc = Document(title="Quality manual", source_type="upload", status="ready")
    db.add(doc)
    await db.flush()
    db.add(DocumentChunk(
        document_id=doc.id, content="text", content_hash=uuid.uuid4().hex, chunk_index=0,
        embedding=[0.1, 0.2, 0.3], embedding_model=model, embedding_dimension=3,
    ))
    await db.flush()


@pytest.mark.asyncio
async def test_a_compatible_service_answers_through_the_shared_client(db_session, stand_in, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", GOOD_KEY)
    await _set(db_session, llm__provider="gemini", llm__model="gemini-9-pro")

    client = await get_llm_client(db_session)
    messages = [{"role": "user", "content": "What is in the bank?"}]
    calls = [c async for chunk in client.chat_stream(messages, tools=[]) for c in chunk.tool_calls]

    # Two whole calls under one index stay two calls.
    assert [(c["id"], c["function"]["name"], c["function"]["arguments"]) for c in calls] == [
        ("call_a", "read_bank", {"account": "1"}),
        ("call_b", "list_leads", {}),
    ]

    # The agent's next turn: the calls go back as sent, signature included.
    messages.append({"role": "assistant", "content": "", "tool_calls": calls})
    messages += [client.build_tool_result_message(c["id"], c["function"]["name"], "ok") for c in calls]
    text = "".join([chunk.content async for chunk in client.chat_stream(messages)])

    assert text == "Done."
    path, sent = stand_in.requests[-1]
    assert path == "/v1/chat/completions" and sent["model"] == "gemini-9-pro"
    returned = sent["messages"][1]["tool_calls"]
    assert returned[0]["extra_content"] == {"google": {"thought_signature": "sig-a"}}
    assert "extra_content" not in returned[1]
    assert [m["tool_call_id"] for m in sent["messages"][2:]] == ["call_a", "call_b"]


@pytest.mark.asyncio
async def test_a_provider_without_a_key_says_which_key_is_missing(db_session):
    await _set(db_session, llm__provider="xai", llm__model="grok-9")

    with pytest.raises(RuntimeError, match=r"xAI \(Grok\) API key"):
        await get_llm_client(db_session)


@pytest.mark.asyncio
async def test_long_vectors_are_cut_to_a_size_the_database_can_index(db_session, stand_in, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", GOOD_KEY)
    await _set(db_session, llm__embedding_provider="gemini", llm__embedding_model="voyage-3")

    service = await get_embedding_service_for_db(db_session)
    vectors = await service.embed_batch(["first", "second"])

    assert isinstance(service, CompatibleEmbeddingService)
    # A model from another provider's list became this provider's default.
    assert stand_in.requests[-1][1]["model"] == "gemini-embedding-001"
    assert [len(v) for v in vectors] == [1536, 1536]
    assert all(abs(sum(x * x for x in v) - 1.0) < 1e-6 for v in vectors)
    # Each text got its own vector back, whatever order they were answered in.
    assert [round(v[0] / v[1]) for v in vectors] == [10, 20]


@pytest.mark.asyncio
async def test_the_catalog_lists_only_chat_models_under_their_plain_names(db_session, stand_in, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", GOOD_KEY)

    catalog = await refresh_model_catalog(db_session)

    assert [m["id"] for m in catalog["llm"]["gemini"]] == ["gemini-9-flash", "gemini-9-pro"]
    assert [m["id"] for m in catalog["embedding"]["gemini"]] == ["gemini-embedding-001", "gemini-embedding-2"]
    # No key, no models.
    assert "xai" not in catalog["llm"] and "mistral" not in catalog["embedding"]


@pytest.mark.asyncio
async def test_settings_describe_every_provider(client, auth_headers, monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "xai-example")

    body = (await client.get("/settings/ai-providers", headers=auth_headers)).json()
    by_key = {p["key"]: p for p in body["providers"]}

    assert {"anthropic", "openai", "gemini", "xai", "mistral", "deepseek", "groq", "openrouter", "ollama"} <= set(by_key)
    assert by_key["gemini"]["default_embedding"] == "gemini-embedding-001"
    assert by_key["gemini"]["embedding_models"][0]["dimension"] == 1536
    assert by_key["xai"]["embedding_models"] == [] and by_key["xai"]["key_set"] is True
    assert by_key["anthropic"]["reads_documents"] is True and by_key["gemini"]["reads_documents"] is False
    assert by_key["voyage"]["chat"] is False
    assert body["embedded_documents"] == 0

    settings_out = (await client.get("/settings", headers=auth_headers)).json()
    assert settings_out["keys_set"]["xai"] is True and settings_out["keys_set"]["gemini"] is False


@pytest.mark.asyncio
async def test_embeddings_follow_the_provider_while_nothing_is_embedded(client, auth_headers, db_session):
    await _set(db_session, llm__provider="anthropic", llm__embedding_provider="voyage", llm__embedding_model="voyage-3")

    out = (await client.put(
        "/settings", headers=auth_headers, json={"llm_provider": "gemini", "llm_model": "gemini-9-pro"},
    )).json()

    assert out["embeddings_followed"] is True
    assert (out["embedding_provider"], out["embedding_model"]) == ("gemini", "gemini-embedding-001")
    assert out["reindex_required"] is False

    # Grok has no embedding model: embeddings stay where they are.
    out = (await client.put(
        "/settings", headers=auth_headers, json={"llm_provider": "xai", "llm_model": "grok-9"},
    )).json()
    assert out["embeddings_followed"] is False
    assert (out["llm_provider"], out["embedding_provider"]) == ("xai", "gemini")


@pytest.mark.asyncio
async def test_a_knowledge_base_is_never_orphaned_by_choosing_a_chat_model(client, auth_headers, db_session):
    await _set(db_session, llm__provider="anthropic", llm__embedding_provider="voyage", llm__embedding_model="voyage-3")
    await _embedded_document(db_session, "voyage-3")

    out = (await client.put(
        "/settings", headers=auth_headers, json={"llm_provider": "mistral", "llm_model": "mistral-large"},
    )).json()

    assert out["embeddings_followed"] is False
    assert (out["embedding_provider"], out["embedding_model"]) == ("voyage", "voyage-3")
    assert (await client.get("/settings/ai-providers", headers=auth_headers)).json()["embedded_documents"] == 1

    # Asked for outright, the switch is made and says a re-index is due: both
    # models give 1024 numbers, and they still cannot be compared.
    out = (await client.put(
        "/settings", headers=auth_headers,
        json={"embedding_provider": "mistral", "embedding_model": "mistral-embed"},
    )).json()
    assert out["reindex_required"] is True

    # Changing back before re-indexing leaves nothing to redo.
    out = (await client.put(
        "/settings", headers=auth_headers,
        json={"embedding_provider": "voyage", "embedding_model": "voyage-3"},
    )).json()
    assert out["reindex_required"] is False


@pytest.mark.asyncio
async def test_any_providers_key_is_saved_and_tested(client, db_session, stand_in, monkeypatch):
    monkeypatch.setattr(settings, "hub_mode", True)
    db_session.add(User(
        email="owner@pmi.local", display_name="Olive Owner",
        hashed_password=hash_password("TestPassword1!"), role="admin", is_active=True,
    ))
    await db_session.flush()
    login = await client.post("/auth/login", json={"email": "owner@pmi.local", "password": "TestPassword1!"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    refused = await client.put("/settings", headers=headers, json={"api_keys": {"nobody": "x"}})
    assert refused.status_code == 422

    out = (await client.put("/settings", headers=headers, json={"api_keys": {"gemini": "  wrong-key "}})).json()
    assert out["keys_set"]["gemini"] is True and settings.get_api_key("gemini") == "wrong-key"
    test = (await client.post("/settings/test-connection", headers=headers, json={"provider": "gemini"})).json()
    assert test == {"ok": False, "message": "Google Gemini refused this API key."}

    await client.put("/settings/api-key", headers=headers, json={"provider": "gemini", "api_key": GOOD_KEY})
    test = (await client.post("/settings/test-connection", headers=headers, json={"provider": "gemini"})).json()
    assert test["ok"] is True and "2 chat model(s)" in test["message"]
    # Saving the key was enough to find its models.
    options = (await client.get("/settings/ai-options", headers=headers)).json()
    assert options["llm"]["gemini"] == ["gemini-9-flash", "gemini-9-pro"]
