"""
Agent executor — the core agentic loop.

Flow per user message:
  1. Load conversation history from DB
  2. Append user message
  3. Call Ollama with tool definitions (streaming)
  4. Stream tokens → caller via async generator
  5. If model calls tools: execute, append tool results, loop back to step 3
  6. When model gives a final answer: persist assistant message, yield WSDone

Max tool-call rounds: MAX_TOOL_ROUNDS (prevents infinite loops)
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from models.db.enums import MessageRole
from models.schemas.conversations import WSDone, WSError, WSToken, WSToolStatus
from repositories.conversation_repo import ConversationRepository, MessageRepository
from services.agent.tools import TOOL_DEFINITIONS, ToolContext, dispatch_tool
from services.embeddings.service import get_embedding_service
from services.llm.ollama import OllamaClient, OllamaError, get_ollama_client
from services.llm.router import get_llm_client

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 5  # hard cap on recursive tool calls

# ── PMI system prompt ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are the PMI Executive Assistant for Precisian Medical Instruments (PMI), \
a medical device startup building VACTOR — a compact, battery-powered suction device \
designed for emergency medicine, military, and tactical applications.

Your role: Executive Assistant, Chief of Staff, Research Assistant, Knowledge Manager, \
and Project Coordinator — all under strict human supervision.

CAPABILITIES:
- Answer questions using the PMI knowledge base (search_knowledge_base tool)
- Help draft documents, plans, and analyses
- Create and track tasks (create_task tool)
- Submit actions for human approval (request_approval tool) — REQUIRED for anything irreversible
- Summarise pending approvals (get_pending_approvals tool)

CRITICAL CONSTRAINTS — follow these without exception:
1. You NEVER take irreversible real-world actions autonomously (no emails, no external APIs, \
no document modifications). Always use request_approval for these.
2. When referencing documents, cite the source by name.
3. Be concise and professional. Target busy executives.
4. If you are unsure about a fact, say so — do not hallucinate.
5. Medical device regulatory accuracy is paramount. Do not guess on compliance questions.

Today's date: {today}
"""


# ── Tool status helpers ───────────────────────────────────────────────────────

_TOOL_RUNNING_LABELS: dict[str, str] = {
    "search_knowledge_base": "Searching knowledge base…",
    "create_task": "Creating task…",
    "request_approval": "Submitting approval request…",
    "get_pending_approvals": "Fetching pending approvals…",
    "get_tasks": "Looking up tasks…",
    "get_regulatory_status": "Checking regulatory status…",
    "search_web": "Searching the web…",
    "fetch_page": "Fetching page…",
}


def _tool_running_label(tool_name: str, args: dict) -> str:
    label = _TOOL_RUNNING_LABELS.get(tool_name, f"Running {tool_name}...")
    if tool_name == "search_knowledge_base":
        query = args.get("query", "")
        if query:
            label = f'Searching knowledge base for "{query[:60]}"...'
    elif tool_name == "search_web":
        query = args.get("query", "")
        if query:
            label = f'Searching web for "{query[:60]}"...'
    elif tool_name == "fetch_page":
        url = args.get("url", "")
        if url:
            label = f"Fetching {url[:80]}..."
    elif tool_name == "create_task":
        title = args.get("title", "")
        if title:
            label = f"Creating task: {title[:60]}..."
    return label


def _tool_done_label(tool_name: str, result: str) -> str:
    # Brief summary — first non-empty line of result, capped at 80 chars
    first_line = next((l.strip() for l in result.splitlines() if l.strip()), "Done")
    if len(first_line) > 80:
        first_line = first_line[:77] + "…"
    return first_line


async def _auto_title_conversation(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    user_text: str,
) -> None:
    """Set the conversation title from the first user message if still untitled."""
    conv_repo = ConversationRepository(db)
    conv = await conv_repo.get(conversation_id, user_id)
    if conv is None or conv.title:
        return  # already titled or not found

    # Truncate at word boundary ≤ 60 chars
    raw = user_text.strip().replace("\n", " ")
    if len(raw) <= 60:
        title = raw
    else:
        title = raw[:60].rsplit(" ", 1)[0] + "…"

    await conv_repo.update(conv, title=title)
    await db.commit()


# ── Executor ──────────────────────────────────────────────────────────────────

@dataclass
class AgentExecutor:
    db: AsyncSession
    user_id: uuid.UUID
    conversation_id: uuid.UUID
    ollama: OllamaClient = field(default_factory=get_ollama_client)

    @classmethod
    async def create(cls, db: AsyncSession, user_id, conversation_id) -> "AgentExecutor":
        """Factory that resolves the active LLM client from system settings."""
        client = await get_llm_client(db)
        return cls(db=db, user_id=user_id, conversation_id=conversation_id, ollama=client)

    async def run(self, user_text: str) -> AsyncGenerator[str, None]:
        """
        Async generator that yields JSON-encoded WebSocket frames as strings.
        Yields WSToken frames during streaming, then a final WSDone or WSError.
        """
        return self._run(user_text)

    async def _run(self, user_text: str) -> AsyncGenerator[str, None]:
        # ── 1. Persist user message ───────────────────────────────────────────
        msg_repo = MessageRepository(self.db)
        await msg_repo.create(
            conversation_id=self.conversation_id,
            role=MessageRole.USER,
            content=user_text,
        )
        await self.db.commit()

        # ── 2. Build Ollama message history ───────────────────────────────────
        messages = await self._build_history(user_text)

        # ── 3. Agentic loop ───────────────────────────────────────────────────
        tool_ctx = ToolContext(
            db=self.db,
            user_id=self.user_id,
            conversation_id=self.conversation_id,
            embedding_service=get_embedding_service(),
        )

        accumulated_content = ""
        cited_chunk_ids: list[str] = []

        for _round in range(MAX_TOOL_ROUNDS):
            tool_calls_this_round: list[dict] = []
            content_this_round = ""
            final_tokens = 0
            final_model = ""

            # ── Stream from Ollama ────────────────────────────────────────────
            try:
                async for chunk in self.ollama.chat_stream(
                    messages, tools=TOOL_DEFINITIONS
                ):
                    if chunk.content:
                        content_this_round += chunk.content
                        token_frame = WSToken(
                            content=chunk.content,
                            conversation_id=str(self.conversation_id),
                        )
                        yield token_frame.model_dump_json()

                    if chunk.tool_calls:
                        tool_calls_this_round.extend(chunk.tool_calls)

                    if chunk.done:
                        final_tokens = chunk.output_tokens
                        final_model = chunk.model

            except (OllamaError, Exception) as exc:
                if "LLM" in str(type(exc).__name__) or isinstance(exc, OllamaError):
                    err = WSError(detail=f"LLM unavailable: {exc}")
                else:
                    err = WSError(detail=f"LLM error: {exc}")
                yield err.model_dump_json()
                return

            accumulated_content += content_this_round

            # ── No tool calls → final answer ──────────────────────────────────
            if not tool_calls_this_round:
                assistant_msg = await msg_repo.create(
                    conversation_id=self.conversation_id,
                    role=MessageRole.ASSISTANT,
                    content=accumulated_content,
                    model_name=final_model,
                    cited_chunk_ids=cited_chunk_ids,
                )
                await self.db.commit()

                # Auto-title: if conversation still untitled, use the first ~60 chars
                # of the user's first message (word-boundary truncated)
                await _auto_title_conversation(self.db, self.conversation_id, self.user_id, user_text)

                done_frame = WSDone(
                    conversation_id=str(self.conversation_id),
                    message_id=str(assistant_msg.id),
                    cited_chunk_ids=cited_chunk_ids,
                )
                yield done_frame.model_dump_json()
                return

            # ── Execute tool calls ────────────────────────────────────────────
            # Add the assistant's (partial) message to history
            messages.append({"role": "assistant", "content": content_this_round, "tool_calls": tool_calls_this_round})

            for tc in tool_calls_this_round:
                fn = tc.get("function", {})
                tool_name = fn.get("name", "")
                raw_args = fn.get("arguments", {})
                args: dict[str, Any] = raw_args if isinstance(raw_args, dict) else {}

                # Emit "running" status so the UI can show a live indicator
                running_label = _tool_running_label(tool_name, args)
                yield WSToolStatus(
                    tool_name=tool_name,
                    status="running",
                    label=running_label,
                    conversation_id=str(self.conversation_id),
                ).model_dump_json()

                result = await dispatch_tool(tool_ctx, tool_name, args)
                await self.db.commit()  # flush any tool-created DB rows

                # Emit "done" status with a brief summary
                done_label = _tool_done_label(tool_name, result)
                yield WSToolStatus(
                    tool_name=tool_name,
                    status="done",
                    label=done_label,
                    conversation_id=str(self.conversation_id),
                ).model_dump_json()

                messages.append({"role": "tool", "content": result})

        # Exceeded MAX_TOOL_ROUNDS — return what we have
        if accumulated_content:
            assistant_msg = await msg_repo.create(
                conversation_id=self.conversation_id,
                role=MessageRole.ASSISTANT,
                content=accumulated_content,
                cited_chunk_ids=cited_chunk_ids,
            )
            await self.db.commit()
            await _auto_title_conversation(self.db, self.conversation_id, self.user_id, user_text)
            done_frame = WSDone(
                conversation_id=str(self.conversation_id),
                message_id=str(assistant_msg.id),
                cited_chunk_ids=cited_chunk_ids,
            )
            yield done_frame.model_dump_json()
        else:
            err = WSError(detail="Agent reached maximum tool call rounds without a response.")
            yield err.model_dump_json()

    async def _build_history(self, user_text: str) -> list[dict[str, Any]]:
        """Load conversation history and return Ollama message list."""
        msg_repo = MessageRepository(self.db)
        history = await msg_repo.list_for_conversation(
            self.conversation_id, limit=40
        )

        today = datetime.now(timezone.utc).strftime("%B %d, %Y")
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT.format(today=today)}
        ]

        for msg in history:
            if msg.role in (MessageRole.USER, MessageRole.ASSISTANT):
                messages.append({"role": msg.role, "content": msg.content})

        # The latest user message is already in history (just committed),
        # but list_for_conversation returns all including it — so no need to re-add.
        return messages
