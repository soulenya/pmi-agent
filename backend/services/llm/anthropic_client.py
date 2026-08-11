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

DEFAULT_MODEL = "claude-sonnet-5"
# Streaming calls (chat + tool use, incl. file generation) — generous so long
# documents produced inside a single tool-call argument are not truncated.
MAX_TOKENS_STREAM = 32768
# Non-streaming utility calls; kept lower because the SDK discourages large
# max_tokens on non-streaming requests (10-minute limit heuristics).
MAX_TOKENS = 8192

# Some newer Claude models reject the `temperature` parameter ("temperature is
# deprecated for this model"). We learn which models those are at runtime — the
# first call that hits the error records the model here so subsequent calls omit
# the parameter automatically. This self-heals without a hard-coded model list.
_TEMP_UNSUPPORTED_MODELS: set[str] = set()


def _is_temperature_deprecated_error(exc: Exception) -> bool:
    """True when the API rejected the request because `temperature` is deprecated."""
    msg = str(getattr(exc, "message", "") or exc).lower()
    return "temperature" in msg and "deprecated" in msg



class AnthropicClient:
    """Async Anthropic client matching OllamaClient's interface."""

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model or DEFAULT_MODEL

    def _split_messages(self, messages: list[dict]) -> tuple[str | None, list[dict]]:
        """
        Anthropic requires system prompt separate from messages array.
        Also converts tool-result and assistant-with-tool-calls messages to
        the Anthropic content-block format.
        Returns (system_prompt, user_assistant_messages).
        """
        system: str | None = None
        filtered: list[dict] = []
        for m in messages:
            role = m.get("role", "")
            if role == "system":
                system = (system or "") + m.get("content", "")

            elif role == "tool":
                # Convert OpenAI-style tool result to Anthropic tool_result block
                # (executor uses role=tool for non-prompt-tools providers)
                # We use tc_id stored in the message; fall back to empty string
                tc_id = m.get("tool_use_id") or m.get("tool_call_id") or ""
                filtered.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tc_id,
                        "content": m.get("content", ""),
                    }],
                })

            elif role == "assistant" and m.get("tool_calls"):
                # Convert internal tool_calls list to Anthropic content blocks
                content_blocks: list[dict] = []
                text = m.get("content") or ""
                if text:
                    content_blocks.append({"type": "text", "text": text})
                for tc in m["tool_calls"]:
                    fn = tc.get("function", {})
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tc.get("id", f"toolu_{fn.get('name', 'fn')}"),
                        "name": fn.get("name", ""),
                        "input": fn.get("arguments", {}),
                    })
                filtered.append({"role": "assistant", "content": content_blocks})

            else:
                # NOTE: content may be a string OR a list of Anthropic content
                # blocks (image / document / text) — vision document extraction
                # relies on list-form content passing through untouched.
                filtered.append({"role": role, "content": m.get("content", "")})
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
        base_kwargs: dict = {
            "model": self._model,
            "max_tokens": MAX_TOKENS_STREAM,
            "messages": filtered,
        }
        if system:
            base_kwargs["system"] = system
        if tools:
            base_kwargs["tools"] = self._convert_tools(tools)

        tool_calls: list[dict] = []
        input_tokens = 0
        output_tokens = 0
        yielded_any = False
        include_temperature = self._model not in _TEMP_UNSUPPORTED_MODELS

        while True:
            kwargs = dict(base_kwargs)
            if include_temperature:
                kwargs["temperature"] = temperature
            try:
                async with self._client.messages.stream(**kwargs) as stream:
                    # stream.text_stream is the SDK's reliable way to get text tokens.
                    # It handles all internal SSE events correctly across SDK versions.
                    async for text_chunk in stream.text_stream:
                        yielded_any = True
                        yield StreamChunk(
                            content=text_chunk,
                            done=False,
                            model=self._model,
                        )

                    # get_final_message() waits for the stream to complete and returns
                    # the full Message object including all tool_use blocks.
                    final = await stream.get_final_message()
                    if final.usage:
                        input_tokens = final.usage.input_tokens
                        output_tokens = final.usage.output_tokens

                    for block in final.content:
                        if block.type == "tool_use":
                            tool_calls.append({
                                "id": block.id,
                                "function": {
                                    "name": block.name,
                                    "arguments": block.input,  # already a dict
                                }
                            })
                break
            except anthropic.BadRequestError as exc:
                # Retry once without temperature if the model deprecated it and we
                # haven't streamed anything yet (the error fires at request time).
                if (
                    include_temperature
                    and not yielded_any
                    and _is_temperature_deprecated_error(exc)
                ):
                    _TEMP_UNSUPPORTED_MODELS.add(self._model)
                    include_temperature = False
                    continue
                raise

        yield StreamChunk(
            content="",
            tool_calls=tool_calls,
            done=True,
            model=self._model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    async def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.3,
    ) -> StreamChunk:
        """Non-streaming single call."""
        system, filtered = self._split_messages(messages)
        base_kwargs: dict = {
            "model": self._model,
            "max_tokens": MAX_TOKENS,
            "messages": filtered,
        }
        if system:
            base_kwargs["system"] = system
        if tools:
            base_kwargs["tools"] = self._convert_tools(tools)

        include_temperature = self._model not in _TEMP_UNSUPPORTED_MODELS
        while True:
            kwargs = dict(base_kwargs)
            if include_temperature:
                kwargs["temperature"] = temperature
            try:
                resp = await self._client.messages.create(**kwargs)
                break
            except anthropic.BadRequestError as exc:
                if include_temperature and _is_temperature_deprecated_error(exc):
                    _TEMP_UNSUPPORTED_MODELS.add(self._model)
                    include_temperature = False
                    continue
                raise

        content = ""
        tool_calls: list[dict] = []
        for block in resp.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append({
                    "id": block.id,
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
            stop_reason=getattr(resp, "stop_reason", "") or "",
        )

    async def is_available(self) -> bool:
        try:
            await self._client.models.list()
            return True
        except Exception:
            return False

    @staticmethod
    def build_tool_result_message(tc_id: str, tool_name: str, result: str) -> dict:
        """Return a properly formatted tool result message for Anthropic."""
        return {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": tc_id or f"toolu_{tool_name}",
                "content": result,
            }],
        }
