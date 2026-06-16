"""
Base agent class for the Little Gerry v2 LangGraph multi-agent system.

Each specialist agent subclasses BaseAgent and provides:
  - SYSTEM_PROMPT  — role-specific instructions
  - TOOLS          — subset of tool names this agent can use
  - AGENT_NAME     — display name (used in supervisor routing)
"""
from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from services.agent.guardrails import HONESTY_CONTRACT

logger = logging.getLogger(__name__)


class BaseAgent:
    """Abstract specialist agent. Subclasses define SYSTEM_PROMPT and TOOLS."""

    AGENT_NAME: str = "BaseAgent"
    SYSTEM_PROMPT: str = ""
    # Tool names this agent is allowed to use. Empty list = all tools.
    TOOLS: list[str] = []

    def __init__(self, llm, ctx) -> None:
        """
        Args:
            llm: A LangChain chat model (ChatAnthropic, ChatOpenAI, ChatOllama)
                 already instantiated with the correct credentials.
            ctx: ToolContext with db, user_id, conversation_id, embedding_service.
        """
        self.llm = llm
        self.ctx = ctx
        self._tools = self._build_tools()
        self._llm_with_tools = self.llm.bind_tools(self._tools) if self._tools else self.llm

    def _build_tools(self) -> list:
        from services.agent.v2.lc_tools import make_lc_tools
        all_tools = make_lc_tools(self.ctx)
        if not self.TOOLS:
            return all_tools
        allowed = set(self.TOOLS)
        return [t for t in all_tools if t.name in allowed]

    def _system_message(
        self, today: str, google_connected: bool, extra_context: str = ""
    ) -> SystemMessage:
        google_note = (
            "\nGOOGLE STATUS: Connected. "
            "Call Google tools immediately when the user asks about Drive, Gmail, Calendar, or Contacts."
            if google_connected
            else
            "\nGOOGLE STATUS: NOT CONNECTED. "
            "Do NOT fabricate any Google Workspace data. "
            "Tell the user to connect via Settings → Google Integration."
        )
        return SystemMessage(
            content=self.SYSTEM_PROMPT.format(today=today)
            + google_note
            + HONESTY_CONTRACT
            + (extra_context or "")
        )

    async def run(
        self,
        messages: list[dict[str, Any]],
        today: str,
        google_connected: bool,
        max_rounds: int | None = None,
        extra_system_context: str = "",
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Async generator — yields dicts:
          {"type": "token",   "content": "..."}
          {"type": "tool_running", "tool": "...", "label": "..."}
          {"type": "tool_done",    "tool": "...", "label": "..."}
          {"type": "done"}
          {"type": "error",  "detail": "..."}
        """
        if max_rounds is None:
            from config import settings
            max_rounds = settings.agent_max_tool_rounds
        lc_messages = [self._system_message(today, google_connected, extra_system_context)]
        for m in messages:
            role = m.get("role", "")
            content = m.get("content", "")
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
            # tool/system messages are omitted from history conversion

        for _round in range(max_rounds):
            try:
                response = await self._llm_with_tools.ainvoke(lc_messages)
            except Exception as exc:
                yield {"type": "error", "detail": str(exc)}
                return

            # Stream the text content
            if isinstance(response.content, str) and response.content:
                yield {"type": "token", "content": response.content}
            elif isinstance(response.content, list):
                for block in response.content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        yield {"type": "token", "content": block["text"]}

            # Check for tool calls
            tool_calls = getattr(response, "tool_calls", []) or []
            if not tool_calls:
                lc_messages.append(response)
                break

            lc_messages.append(response)

            # Execute each tool call
            for tc in tool_calls:
                tool_name = tc.get("name", "")
                tc_id = tc.get("id", tool_name)
                tc_args = tc.get("args", {})

                yield {"type": "tool_running", "tool": tool_name, "label": f"Running {tool_name}…"}

                result = await self._call_tool(tool_name, tc_args)
                await self.ctx.db.commit()

                yield {"type": "tool_done", "tool": tool_name, "label": str(result)[:80]}

                lc_messages.append(
                    ToolMessage(content=str(result), tool_call_id=tc_id)
                )

        yield {"type": "done"}

    @staticmethod
    def _normalize_tool_args(args: Any) -> dict[str, Any]:
        """Normalize LLM tool-call args into a plain kwargs dict.

        The lc_tools wrappers advertise a single string parameter "payload"
        carrying a JSON object, but models send many variations:
          {"payload": "{…}"}    the documented shape (JSON object as a string)
          {"payload": {…}}      a real dict instead of a string
          {"v__args": […]}      LangChain's mangled schema for a param named
                                 "args" (the pre-v2.1.5 wrappers) — the value
                                 arrives as a single-element array
          {"args": …}           older envelope name
          {"field": …}          the fields at the top level, no envelope
          "{…}" / ""            a bare string instead of a dict
        """
        import json

        def _from_string(raw: str) -> dict[str, Any]:
            raw = raw.strip()
            if not raw:
                return {}
            if raw[0] in "{[":
                try:
                    parsed = json.loads(raw)
                except ValueError:
                    return {"input": raw}
                return parsed if isinstance(parsed, dict) else {"input": parsed}
            return {"input": raw}

        if isinstance(args, str):
            return _from_string(args)
        if not isinstance(args, dict):
            return {}
        if len(args) == 1:
            key, inner = next(iter(args.items()))
            if key in ("payload", "args", "v__args", "input"):
                # v__args arrives as a list — unwrap a single element
                if isinstance(inner, list):
                    if not inner:
                        return {}
                    inner = inner[0] if len(inner) == 1 else inner
                if isinstance(inner, dict):
                    return inner
                if isinstance(inner, str):
                    return _from_string(inner)
                if inner is None:
                    return {}
                return {"input": inner}
        return args

    async def _call_tool(self, tool_name: str, args: Any) -> str:
        from services.agent.tools import dispatch_tool
        args = self._normalize_tool_args(args)
        try:
            return await dispatch_tool(self.ctx, tool_name, args)
        except Exception as exc:
            logger.exception("Tool %s failed", tool_name)
            return f"Tool error: {exc}"
