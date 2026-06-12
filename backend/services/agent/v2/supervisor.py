"""
LangGraph Supervisor — routes user queries to specialist agents.

Architecture:
  1. Supervisor node reads user message, decides which specialist to use.
  2. Specialist runs (with its tool subset) and yields streaming frames.
  3. Frames are forwarded to the WebSocket caller in the same format as v1.

Each streaming frame is a JSON-encoded dict matching the v1 frame schema:
  {"type": "token",       "content": "..."}
  {"type": "tool_running","tool": "...", "label": "..."}
  {"type": "tool_done",   "tool": "...", "label": "..."}
  {"type": "done",        "conversation_id": "..."}
  {"type": "error",       "detail": "..."}
"""
from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Agent name → description used in supervisor routing prompt
_AGENT_DESCRIPTIONS = {
    "executive_assistant": (
        "General queries, daily briefings, email triage, task management, "
        "scheduling, Google Workspace access, communications summaries, and anything "
        "that doesn't fit another specialist."
    ),
    "research": (
        "Web research, market analysis, competitive intelligence, literature review, "
        "FDA/ISO guidance lookup, and cited report generation."
    ),
    "regulatory": (
        "FDA 510(k), Design History File (DHF), IFU, labeling compliance, ISO 13485, "
        "ISO 14971, IEC 60601-1, regulatory strategy, and gap analysis for VACTOR."
    ),
    "qms": (
        "Quality Management System: CAPA, SOPs, non-conformances, internal audits, "
        "document control, and supplier quality."
    ),
    "ir": (
        "Investor relations: pitch decks, financial narratives, due diligence data room, "
        "cap table, investor updates, SBIR/grant research."
    ),
    "engineering": (
        "Hardware, firmware, systems engineering, BOM review, test protocols, "
        "design V&V, design FMEA, and technical documentation for VACTOR."
    ),
    "operations": (
        "Procurement, supply chain, production scheduling, vendor management, "
        "Google Sheets BOM/budget data, and operational logistics."
    ),
}

_SUPERVISOR_PROMPT = """\
You are the routing supervisor for Little Gerry, the AI Executive Assistant for \
Precisian Medical Instruments (PMI).

Your ONLY job is to decide which specialist agent should handle the user's message.

Available agents:
{agent_list}

Respond with ONLY the agent name (e.g. "executive_assistant") — nothing else.
If in doubt, use "executive_assistant".
"""

_ROUTING_QUERY_TEMPLATE = """\
User message: {user_message}

Which agent should handle this?
"""


class LangGraphSupervisor:
    """
    Supervisor that routes to specialist LangGraph-based agents.
    Mirrors the streaming interface of the v1 AgentExecutor.
    """

    def __init__(
        self,
        llm,
        db: AsyncSession,
        user_id: uuid.UUID,
        conversation_id: uuid.UUID,
    ) -> None:
        self.llm = llm
        self.db = db
        self.user_id = user_id
        self.conversation_id = conversation_id
        self._agents: dict = {}  # populated lazily in run()

    # ── Factory ───────────────────────────────────────────────────────────────

    @classmethod
    async def create(
        cls,
        db: AsyncSession,
        user_id: uuid.UUID,
        conversation_id: uuid.UUID,
    ) -> "LangGraphSupervisor":
        llm = await cls._build_chat_model(db)
        return cls(llm=llm, db=db, user_id=user_id, conversation_id=conversation_id)

    @staticmethod
    async def _build_chat_model(db: AsyncSession):
        """Build a LangChain chat model from the configured provider/model.

        The v2 agents need LangChain's `bind_tools` / `astream` interface,
        so we construct ChatAnthropic / ChatOpenAI directly rather than
        reusing the in-house clients from services.llm.router.
        """
        from config import settings as app_settings
        from services.llm.router import resolve_task_llm

        provider, model = await resolve_task_llm(db, task="chat")
        if provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            key = app_settings.get_api_key("anthropic")
            if not key:
                raise RuntimeError("Anthropic API key is not configured.")
            return ChatAnthropic(model=model, api_key=key, max_tokens=4096)
        if provider == "openai":
            from langchain_openai import ChatOpenAI
            key = app_settings.get_api_key("openai")
            if not key:
                raise RuntimeError("OpenAI API key is not configured.")
            return ChatOpenAI(model=model, api_key=key)
        raise RuntimeError(
            f"The agent supervisor requires a cloud LLM provider (got {provider!r})."
        )

    # ── Routing ───────────────────────────────────────────────────────────────

    async def _route(self, user_message: str) -> str:
        """Ask the LLM to pick a specialist agent name."""
        from langchain_core.messages import HumanMessage, SystemMessage

        agent_list = "\n".join(
            f'- "{name}": {desc}' for name, desc in _AGENT_DESCRIPTIONS.items()
        )
        system = _SUPERVISOR_PROMPT.format(agent_list=agent_list)
        query = _ROUTING_QUERY_TEMPLATE.format(user_message=user_message[:500])

        try:
            response = await self.llm.ainvoke(
                [SystemMessage(content=system), HumanMessage(content=query)]
            )
            agent_name = response.content.strip().strip('"').strip("'").lower()
            # Validate — fall back to executive_assistant
            if agent_name not in _AGENT_DESCRIPTIONS:
                logger.warning("Supervisor returned unknown agent %r; using executive_assistant", agent_name)
                agent_name = "executive_assistant"
        except Exception:
            logger.exception("Supervisor routing failed; defaulting to executive_assistant")
            agent_name = "executive_assistant"

        logger.info("Supervisor routed to: %s", agent_name)
        return agent_name

    # ── Agent instantiation ───────────────────────────────────────────────────

    def _build_agent(self, agent_name: str, ctx):
        from services.agent.v2.executive_assistant import ExecutiveAssistantAgent
        from services.agent.v2.house_manager import HouseManagerAgent
        from services.agent.v2.research_agent import ResearchAgent
        from services.agent.v2.regulatory_agent import RegulatoryAgent
        from services.agent.v2.qms_agent import QMSAgent
        from services.agent.v2.ir_agent import IRAgent
        from services.agent.v2.engineering_agent import EngineeringAgent
        from services.agent.v2.operations_agent import OperationsAgent

        _MAP = {
            "executive_assistant": ExecutiveAssistantAgent,
            "research": ResearchAgent,
            "regulatory": RegulatoryAgent,
            "qms": QMSAgent,
            "ir": IRAgent,
            "engineering": EngineeringAgent,
            "operations": OperationsAgent,
            "house_manager": HouseManagerAgent,
        }
        cls = _MAP.get(agent_name, ExecutiveAssistantAgent)
        return cls(llm=self.llm, ctx=ctx)

    async def _pinned_agent(self) -> str | None:
        """Return the conversation's pinned agent name, if any (e.g. voice
        sessions are pinned to the House Manager and skip routing)."""
        from sqlalchemy import text
        try:
            row = await self.db.execute(
                text("SELECT agent_type FROM conversations WHERE id = :cid"),
                {"cid": self.conversation_id},
            )
            value = row.scalar()
        except Exception:
            await self.db.rollback()
            return None
        if value and value in ("house_manager", *(_AGENT_DESCRIPTIONS.keys())):
            return str(value)
        return None

    # ── History loading ───────────────────────────────────────────────────────

    async def _load_history(self, limit: int = 40) -> list[dict]:
        from repositories.conversation_repo import MessageRepository
        from models.db.enums import MessageRole
        repo = MessageRepository(self.db)
        msgs = await repo.list_for_conversation(self.conversation_id, limit=limit)
        result = []
        for m in msgs:
            role = "user" if m.role == MessageRole.USER else "assistant"
            result.append({"role": role, "content": m.content})
        return result

    async def _check_google_connected(self) -> bool:
        # Must match what the Drive/Gmail/Calendar tools actually use: the
        # shared google_token.json checked by google_service.get_credentials().
        # (The google_credentials DB table is never populated by the OAuth flow.)
        from services.google_service import get_credentials
        try:
            return get_credentials() is not None
        except Exception:
            return False

    # ── Persist messages ──────────────────────────────────────────────────────

    async def _persist_messages(self, user_text: str, assistant_text: str) -> None:
        from repositories.conversation_repo import MessageRepository
        from models.db.enums import MessageRole
        repo = MessageRepository(self.db)
        await repo.create(
            conversation_id=self.conversation_id,
            role=MessageRole.USER,
            content=user_text,
        )
        if assistant_text.strip():
            await repo.create(
                conversation_id=self.conversation_id,
                role=MessageRole.ASSISTANT,
                content=assistant_text,
            )
        await self.db.commit()

    # ── Main streaming entrypoint ─────────────────────────────────────────────

    async def run(self, user_text: str) -> AsyncGenerator[str, None]:
        """
        Async generator that yields JSON-encoded frame strings,
        matching the v1 executor._run() interface for the WebSocket.
        """
        from services.agent.tools import ToolContext
        from services.embeddings.service import get_embedding_service_for_db

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Build ToolContext
        embedding_service = await get_embedding_service_for_db(self.db)
        ctx = ToolContext(
            db=self.db,
            user_id=self.user_id,
            conversation_id=self.conversation_id,
            embedding_service=embedding_service,
        )

        # Load history + google status
        history = await self._load_history()
        google_connected = await self._check_google_connected()

        # Route — a conversation pinned to a specific agent skips LLM routing
        agent_name = await self._pinned_agent()
        if agent_name is None:
            agent_name = await self._route(user_text)
        else:
            logger.info("Conversation pinned to agent: %s", agent_name)
        yield json.dumps({"type": "agent_selected", "agent": agent_name})

        # Build agent
        agent = self._build_agent(agent_name, ctx)

        # Append current user message to history for the agent
        messages = history + [{"role": "user", "content": user_text}]

        # Stream
        full_response_parts: list[str] = []
        async for frame in agent.run(
            messages=messages,
            today=today,
            google_connected=google_connected,
        ):
            frame_type = frame.get("type", "")

            if frame_type == "token":
                full_response_parts.append(frame["content"])
                yield json.dumps({"type": "token", "content": frame["content"]})

            elif frame_type == "tool_running":
                yield json.dumps({
                    "type": "tool_running",
                    "tool": frame.get("tool", ""),
                    "label": frame.get("label", ""),
                })

            elif frame_type == "tool_done":
                yield json.dumps({
                    "type": "tool_done",
                    "tool": frame.get("tool", ""),
                    "label": frame.get("label", ""),
                })

            elif frame_type == "done":
                # Persist both user message and assistant response
                full_response = "".join(full_response_parts)
                await self._persist_messages(user_text, full_response)
                yield json.dumps({
                    "type": "done",
                    "conversation_id": str(self.conversation_id),
                })

            elif frame_type == "error":
                yield json.dumps({"type": "error", "detail": frame.get("detail", "Unknown error")})
