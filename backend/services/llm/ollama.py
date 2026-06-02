"""
Ollama HTTP client — streaming chat completions with tool-call support.
Calls the local Ollama daemon at settings.ollama_base_url.
No LangChain dependency; uses httpx directly for full control.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

# ── Types ─────────────────────────────────────────────────────────────────────

type OllamaMessage = dict[str, Any]  # {"role": str, "content": str, "tool_calls"?: list}
type ToolDefinition = dict[str, Any]  # Ollama tool schema


class StreamChunk:
    """One chunk from a streaming response."""
    __slots__ = ("content", "tool_calls", "done", "model", "input_tokens", "output_tokens")

    def __init__(
        self,
        content: str = "",
        tool_calls: list[dict] | None = None,
        done: bool = False,
        model: str = "",
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        self.content = content
        self.tool_calls = tool_calls or []
        self.done = done
        self.model = model
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


# ── Client ────────────────────────────────────────────────────────────────────

class OllamaClient:
    """
    Minimal async Ollama client.
    - `chat_stream()`: yields StreamChunk tokens until done
    - `chat()`: single non-streaming call (for tool result follow-ups)
    """

    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self._base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self._model = model or settings.default_llm_model
        self._timeout = httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)

    async def chat_stream(
        self,
        messages: list[OllamaMessage],
        tools: list[ToolDefinition] | None = None,
        temperature: float = 0.3,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Stream chat completion tokens. Yields StreamChunk per token."""
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "stream": True,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/api/chat",
                json=payload,
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise OllamaError(f"Ollama returned {resp.status_code}: {body.decode()}")

                async for raw_line in resp.aiter_lines():
                    if not raw_line:
                        continue
                    try:
                        data = json.loads(raw_line)
                    except json.JSONDecodeError:
                        continue

                    msg = data.get("message", {})
                    content = msg.get("content", "")
                    tool_calls = msg.get("tool_calls") or []
                    done = data.get("done", False)

                    prompt_eval = data.get("prompt_eval_count", 0)
                    eval_count = data.get("eval_count", 0)

                    yield StreamChunk(
                        content=content,
                        tool_calls=tool_calls,
                        done=done,
                        model=data.get("model", self._model),
                        input_tokens=prompt_eval,
                        output_tokens=eval_count,
                    )

                    if done:
                        break

    async def chat(
        self,
        messages: list[OllamaMessage],
        tools: list[ToolDefinition] | None = None,
        temperature: float = 0.3,
    ) -> StreamChunk:
        """Non-streaming single call. Returns one StreamChunk with full content."""
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base_url}/api/chat", json=payload)
            if resp.status_code != 200:
                raise OllamaError(f"Ollama returned {resp.status_code}: {resp.text}")
            data = resp.json()

        msg = data.get("message", {})
        return StreamChunk(
            content=msg.get("content", ""),
            tool_calls=msg.get("tool_calls") or [],
            done=True,
            model=data.get("model", self._model),
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
        )

    async def is_available(self) -> bool:
        """Quick liveness check."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
                resp = await client.get(f"{self._base_url}/api/tags")
                return resp.status_code == 200
        except Exception:
            return False


class OllamaError(RuntimeError):
    """Raised when the Ollama server returns an error."""


# ── Singleton dependency ──────────────────────────────────────────────────────

_client: OllamaClient | None = None


def get_ollama_client() -> OllamaClient:
    global _client
    if _client is None:
        _client = OllamaClient()
    return _client
