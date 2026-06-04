"""
Ollama HTTP client — streaming chat completions with tool-call support.
Calls the local Ollama daemon at settings.ollama_base_url.
No LangChain dependency; uses httpx directly for full control.

For models that don't support native tool calling (e.g. gemma3), falls back
to a prompt-based approach: tools are described in the system message and the
model is asked to emit <tool_call>{...}</tool_call> tags which are parsed here.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

# ── Types ─────────────────────────────────────────────────────────────────────

type OllamaMessage = dict[str, Any]  # {"role": str, "content": str, "tool_calls"?: list}
type ToolDefinition = dict[str, Any]  # Ollama tool schema

_TOOL_CALL_RE = re.compile(r"<tool_call>(.*?)</tool_call>", re.DOTALL)

# Module-level cache: model_name -> supports native tool calling
_tools_support_cache: dict[str, bool] = {}


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


# ── Text-based tool-call helpers ──────────────────────────────────────────────

def _tools_to_system_snippet(tools: list[ToolDefinition]) -> str:
    """
    Convert tool definitions into a system-prompt snippet for models that don't
    support native tool calling.  Instructs the model to output a <tool_call>
    JSON tag when it wants to invoke a tool.
    """
    lines = [
        "\n\n--- TOOL USE INSTRUCTIONS ---",
        "When you need to call a tool, output EXACTLY this on its own line with no surrounding text:",
        '<tool_call>{"name": "TOOL_NAME", "arguments": {ARGS_AS_JSON}}</tool_call>',
        "After outputting the tag, STOP and wait for the tool result.",
        "Do NOT make up tool results. Available tools:\n",
    ]
    for tool in tools:
        fn = tool.get("function", {})
        lines.append(f"- {fn.get('name', '')}: {fn.get('description', '')}")
        props = fn.get("parameters", {}).get("properties", {})
        for pname, pdef in props.items():
            lines.append(f"    {pname} ({pdef.get('type', 'string')}): {pdef.get('description', '')}")
    lines.append("--- END TOOL USE INSTRUCTIONS ---")
    return "\n".join(lines)


def _inject_tools_into_messages(
    messages: list[OllamaMessage],
    tools: list[ToolDefinition],
) -> list[OllamaMessage]:
    """Inject tool descriptions into the system message (or prepend one)."""
    snippet = _tools_to_system_snippet(tools)
    result = list(messages)
    if result and result[0]["role"] == "system":
        result[0] = {**result[0], "content": result[0]["content"] + snippet}
    else:
        result.insert(0, {"role": "system", "content": snippet})
    return result


def _parse_text_tool_calls(text: str) -> tuple[str, list[dict]]:
    """
    Extract <tool_call>...</tool_call> tags from model output.
    Returns (clean_text, tool_calls_list) where tool_calls_list matches
    the native Ollama tool_calls structure.
    """
    tool_calls = []
    for match in _TOOL_CALL_RE.finditer(text):
        try:
            data = json.loads(match.group(1).strip())
            name = data.get("name", "")
            arguments = data.get("arguments", {})
            if name:
                tool_calls.append({"function": {"name": name, "arguments": arguments}})
        except (json.JSONDecodeError, AttributeError):
            pass
    clean = _TOOL_CALL_RE.sub("", text).strip()
    return clean, tool_calls


# ── Client ────────────────────────────────────────────────────────────────────

class OllamaClient:
    """
    Minimal async Ollama client.
    - `chat_stream()`: yields StreamChunk tokens until done
    - `chat()`: single non-streaming call (for tool result follow-ups)
    Automatically falls back to prompt-based tool calling for models that
    don't support the native tools API (e.g. gemma3).
    """

    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self._base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self._model = model or settings.default_llm_model
        self._timeout = httpx.Timeout(connect=5.0, read=180.0, write=10.0, pool=5.0)

    async def _supports_tools(self) -> bool:
        """Return True if the current model supports native tool calling."""
        if self._model in _tools_support_cache:
            return _tools_support_cache[self._model]
        # Probe with a minimal dummy tool call
        payload = {
            "model": self._model,
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            "tools": [{"type": "function", "function": {
                "name": "_probe", "description": "probe",
                "parameters": {"type": "object", "properties": {}, "required": []},
            }}],
        }
        # Limit to 1 token so the probe returns in < 1s regardless of model size
        payload["options"] = {"num_predict": 1}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
                resp = await client.post(f"{self._base_url}/api/chat", json=payload)
                supported = resp.status_code == 200
        except Exception:
            supported = False
        _tools_support_cache[self._model] = supported
        logger.info("Model %s tools_supported=%s", self._model, supported)
        return supported

    async def chat_stream(
        self,
        messages: list[OllamaMessage],
        tools: list[ToolDefinition] | None = None,
        temperature: float = 0.3,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Stream chat completion tokens. Yields StreamChunk per token."""
        use_prompt_tools = False
        effective_messages = messages

        if tools:
            if not await self._supports_tools():
                use_prompt_tools = True
                effective_messages = _inject_tools_into_messages(messages, tools)
                tools = None  # don't send to Ollama API

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": effective_messages,
            "stream": True,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = tools

        full_content = ""

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

                    if use_prompt_tools:
                        # Accumulate content for tool-call parsing
                        full_content += content
                        if not done:
                            # Stream tokens immediately so the frontend stays alive
                            if content:
                                yield StreamChunk(content=content, model=data.get("model", self._model))
                            continue
                        # done=True: parse the full response for tool calls
                        clean, parsed_calls = _parse_text_tool_calls(full_content)
                        if parsed_calls:
                            yield StreamChunk(
                                tool_calls=parsed_calls,
                                done=True,
                                model=data.get("model", self._model),
                                input_tokens=prompt_eval,
                                output_tokens=eval_count,
                            )
                        else:
                            yield StreamChunk(
                                done=True,
                                model=data.get("model", self._model),
                                input_tokens=prompt_eval,
                                output_tokens=eval_count,
                            )
                        break

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
        use_prompt_tools = False
        effective_messages = messages

        if tools:
            if not await self._supports_tools():
                use_prompt_tools = True
                effective_messages = _inject_tools_into_messages(messages, tools)
                tools = None

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": effective_messages,
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
        content = msg.get("content", "")
        tool_calls = msg.get("tool_calls") or []

        if use_prompt_tools:
            content, tool_calls = _parse_text_tool_calls(content)

        return StreamChunk(
            content=content,
            tool_calls=tool_calls,
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


