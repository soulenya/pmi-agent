"""AnthropicClient must only pass arguments the installed SDK accepts.

SDK 2.x removed `temperature` from messages.create()/stream(); the wrapper
used to forward it and every chat failed with a TypeError. These tests bind the
exact kwargs the wrapper builds against the real signatures, so an SDK upgrade
that drops or renames a parameter fails here instead of in a user's chat.
"""
from __future__ import annotations

import inspect
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from anthropic.resources.messages import AsyncMessages

from services.llm.anthropic_client import AnthropicClient

MESSAGES = [
    {"role": "system", "content": "Be brief."},
    {"role": "user", "content": "hi"},
]
TOOLS = [{"type": "function", "function": {"name": "f", "description": "d", "parameters": {"type": "object", "properties": {}}}}]


def _final_message():
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text="ok")],
        usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        stop_reason="end_turn",
    )


@pytest.mark.asyncio
async def test_chat_kwargs_bind_to_sdk_create_signature():
    captured: dict = {}

    async def fake_create(**kwargs):
        captured.update(kwargs)
        return _final_message()

    c = AnthropicClient(api_key="x")
    c._client = SimpleNamespace(messages=SimpleNamespace(create=fake_create))
    await c.chat(MESSAGES, tools=TOOLS, temperature=0.0)

    inspect.signature(AsyncMessages.create).bind(None, **captured)  # raises TypeError on an unknown kwarg
    assert "temperature" not in captured
    assert captured["system"] == "Be brief." and captured["tools"][0]["name"] == "f"


@pytest.mark.asyncio
async def test_chat_stream_kwargs_bind_to_sdk_stream_signature():
    captured: dict = {}

    @asynccontextmanager
    async def fake_stream(**kwargs):
        captured.update(kwargs)

        async def text_stream():
            yield "o"
            yield "k"

        async def get_final_message():
            return _final_message()

        yield SimpleNamespace(text_stream=text_stream(), get_final_message=get_final_message)

    c = AnthropicClient(api_key="x")
    c._client = SimpleNamespace(messages=SimpleNamespace(stream=fake_stream))
    chunks = [ch async for ch in c.chat_stream(MESSAGES, temperature=0.7)]

    inspect.signature(AsyncMessages.stream).bind(None, **captured)
    assert "temperature" not in captured
    assert "".join(ch.content for ch in chunks) == "ok" and chunks[-1].done
