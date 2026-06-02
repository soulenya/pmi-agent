"""
OpenAI chat client — streaming and non-streaming.
Implements the same StreamChunk interface as OllamaClient.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from openai import AsyncOpenAI

from services.llm.ollama import StreamChunk

logger = logging.getLogger(__name__)

# Default model used when none is specified in settings
DEFAULT_MODEL = "gpt-4o-mini"


class OpenAIClient:
    """Async OpenAI client matching OllamaClient's interface."""

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model or DEFAULT_MODEL

    def _convert_messages(self, messages: list[dict]) -> list[dict]:
        """Pass messages through — OpenAI format matches our internal format."""
        return messages

    async def chat_stream(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.3,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Stream chat completion tokens."""
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": self._convert_messages(messages),
            "temperature": temperature,
            "stream": True,
        }
        if tools:
            # Convert Ollama tool format to OpenAI format if needed
            kwargs["tools"] = [_to_openai_tool(t) for t in tools]
            kwargs["tool_choice"] = "auto"

        accumulated_tool_calls: dict[int, dict] = {}

        stream = await self._client.chat.completions.create(**kwargs)
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None:
                continue

            content = delta.content or ""
            tool_calls: list[dict] = []

            # Accumulate tool call deltas
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in accumulated_tool_calls:
                        accumulated_tool_calls[idx] = {
                            "id": tc.id or "",
                            "type": "function",
                            "function": {"name": "", "arguments": ""},
                        }
                    if tc.function:
                        if tc.function.name:
                            accumulated_tool_calls[idx]["function"]["name"] += tc.function.name
                        if tc.function.arguments:
                            accumulated_tool_calls[idx]["function"]["arguments"] += tc.function.arguments

            done = chunk.choices[0].finish_reason is not None

            if done and accumulated_tool_calls:
                tool_calls = _convert_openai_tool_calls(list(accumulated_tool_calls.values()))

            usage = chunk.usage
            yield StreamChunk(
                content=content,
                tool_calls=tool_calls,
                done=done,
                model=chunk.model,
                input_tokens=usage.prompt_tokens if usage else 0,
                output_tokens=usage.completion_tokens if usage else 0,
            )

    async def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.3,
    ) -> StreamChunk:
        """Non-streaming single call."""
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": self._convert_messages(messages),
            "temperature": temperature,
        }
        if tools:
            kwargs["tools"] = [_to_openai_tool(t) for t in tools]
            kwargs["tool_choice"] = "auto"

        resp = await self._client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        usage = resp.usage

        tool_calls: list[dict] = []
        if msg.tool_calls:
            tool_calls = _convert_openai_tool_calls(
                [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in msg.tool_calls]
            )

        return StreamChunk(
            content=msg.content or "",
            tool_calls=tool_calls,
            done=True,
            model=resp.model,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )

    async def is_available(self) -> bool:
        try:
            await self._client.models.list()
            return True
        except Exception:
            return False


# ── Format converters ─────────────────────────────────────────────────────────

def _to_openai_tool(ollama_tool: dict) -> dict:
    """Convert Ollama tool definition to OpenAI format."""
    # Ollama format: {"type": "function", "function": {"name": ..., "description": ..., "parameters": ...}}
    # OpenAI format: same — pass through
    return ollama_tool


def _convert_openai_tool_calls(raw_calls: list[dict]) -> list[dict]:
    """Convert OpenAI tool call dicts to Ollama-compatible format."""
    import json
    result = []
    for tc in raw_calls:
        try:
            args = json.loads(tc["function"]["arguments"])
        except (json.JSONDecodeError, KeyError):
            args = {}
        result.append({
            "function": {
                "name": tc["function"]["name"],
                "arguments": args,
            }
        })
    return result
