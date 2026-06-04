"""
Anthropic (Claude) chat client — streaming and non-streaming.
Implements the same StreamChunk interface as OllamaClient.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator

import anthropic

from services.llm.ollama import StreamChunk

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 4096


class AnthropicClient:
    """Async Anthropic client matching OllamaClient's interface."""

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model or DEFAULT_MODEL

    def _split_messages(self, messages: list[dict]) -> tuple[str | None, list[dict]]:
        """
        Anthropic requires system prompt separate from messages array.
        Returns (system_prompt, user_assistant_messages).
        """
        system: str | None = None
        filtered: list[dict] = []
        for m in messages:
            if m.get("role") == "system":
                system = (system or "") + m.get("content", "")
            else:
                filtered.append({"role": m["role"], "content": m.get("content", "")})
        return system, filtered

    def _convert_tools(self, tools: list[dict]) -> list[dict]:
        """Convert Ollama/OpenAI tool format to Anthropic format."""
        result = []
        for t in tools:
            fn = t.get("function", {})
            result.append({
                "name": fn.get("name", ""),
                "description": fn.get("description", ""),
                "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
            })
        return result

    async def chat_stream(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.3,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Stream chat completion tokens."""
        system, filtered = self._split_messages(messages)
        kwargs = {
            "model": self._model,
            "max_tokens": MAX_TOKENS,
            "messages": filtered,
            "temperature": temperature,
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        accumulated_content = ""
        tool_calls: list[dict] = []
        input_tokens = 0
        output_tokens = 0

        async with self._client.messages.stream(**kwargs) as stream:
            async for event in stream:
                event_type = type(event).__name__

                if event_type == "RawContentBlockDeltaEvent":
                    delta = getattr(event, "delta", None)
                    if delta and hasattr(delta, "text"):
                        chunk_text = delta.text
                        accumulated_content += chunk_text
                        yield StreamChunk(
                            content=chunk_text,
                            done=False,
                            model=self._model,
                        )
                    elif delta and hasattr(delta, "partial_json"):
                        # Tool use input delta — accumulate silently
                        pass

                elif event_type == "RawMessageStopEvent":
                    final = await stream.get_final_message()
                    if final.usage:
                        input_tokens = final.usage.input_tokens
                        output_tokens = final.usage.output_tokens
                    # Extract any tool use blocks
                    for block in final.content:
                        if block.type == "tool_use":
                            tool_calls.append({
                                "function": {
                                    "name": block.name,
                                    "arguments": block.input,
                                }
                            })
                    yield StreamChunk(
                        content="",
                        tool_calls=tool_calls,
                        done=True,
                        model=self._model,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                    )
                    return

    async def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.3,
    ) -> StreamChunk:
        """Non-streaming single call."""
        system, filtered = self._split_messages(messages)
        kwargs = {
            "model": self._model,
            "max_tokens": MAX_TOKENS,
            "messages": filtered,
            "temperature": temperature,
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        resp = await self._client.messages.create(**kwargs)

        content = ""
        tool_calls: list[dict] = []
        for block in resp.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append({
                    "function": {
                        "name": block.name,
                        "arguments": block.input,
                    }
                })

        return StreamChunk(
            content=content,
            tool_calls=tool_calls,
            done=True,
            model=self._model,
            input_tokens=resp.usage.input_tokens if resp.usage else 0,
            output_tokens=resp.usage.output_tokens if resp.usage else 0,
        )

    async def is_available(self) -> bool:
        try:
            await self._client.models.list()
            return True
        except Exception:
            return False
