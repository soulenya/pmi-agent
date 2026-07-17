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

from config import settings
from models.db.enums import MessageRole
from models.schemas.conversations import WSDone, WSError, WSToken, WSToolStatus
from repositories.conversation_repo import ConversationRepository, MessageRepository
from services.agent.guardrails import HONESTY_CONTRACT
from services.agent.tools import TOOL_DEFINITIONS, ToolContext, dispatch_tool
from services.embeddings.service import get_embedding_service_for_db
from services.llm.ollama import OllamaClient, OllamaError, get_ollama_client
from services.llm.router import get_llm_client

logger = logging.getLogger(__name__)

# Hard cap on recursive tool-call rounds per turn (configurable). Kept as a
# module attribute for backwards compatibility; the runtime value comes from
# settings so it can be tuned without a code change.
MAX_TOOL_ROUNDS = settings.agent_max_tool_rounds


# ── PMI system prompt ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are Little Gerry, the AI Executive Assistant for Precisian Medical Instruments (PMI), \
a medical device startup building VACTOR — a compact, battery-powered suction device \
designed for emergency medicine, military, and tactical applications.

Your name is Little Gerry. Your role: Executive Assistant, Chief of Staff, Research Assistant, \
Knowledge Manager, and Project Coordinator — all under strict human supervision.

CAPABILITIES:
- Answer questions and hold natural conversation — NO tool needed for this
- Search the PMI knowledge base when asked about internal documents (search_knowledge_base)
- Create and track tasks when explicitly asked (create_task)
- Submit actions for human approval — REQUIRED for anything irreversible (request_approval)
- Summarise pending approvals when asked (get_pending_approvals)
- Access Gmail, Drive, Calendar, Contacts, Sheets, and Google Tasks via tools

TOOL-USE GUIDELINES:
1. Use tools proactively whenever they are the most useful response.
   - If the user asks about a PMI document or internal fact → call search_knowledge_base
   - If the user asks to check, read, browse, search, or list emails → call search_gmail or read_gmail_message
   - If the user asks to browse, read, search, or list Drive files/folders → call search_drive, list_drive_folder, or read_drive_file
   - If the user asks to look at the calendar or upcoming events → call get_calendar_events
   - If the user asks about contacts → call search_contacts
   - If the user asks to search the web or research a topic → call search_web
   - If the user asks to create a task, add a task, or track something → call create_task
   - If the user asks to generate, create, or export a plain-text/markdown/csv file → call generate_file
   - If the user asks for a Word document, report, memo, weekly update, or formatted deliverable → call create_docx (it appears on the Generated Files page)
   - If the user asks to upload a file you created to Google Drive → call upload_to_drive with the generated filename
   - When in doubt about Drive content, use list_drive_folder to browse and search_drive_content to read
2. DO NOT just describe what you are about to do — use the tool and show the result.
   - Wrong: "Let me browse your Drive now." (then stops)
   - Right: call list_drive_folder immediately
3. You NEVER take irreversible real-world actions autonomously. Always use request_approval \
   for sending emails, creating calendar events, modifying files, etc.
4. For simple conversation, greetings, or analysis with no external data needed → answer directly.
5. When referencing documents, cite the source by name.
6. Be concise and professional. Target busy executives.
7. If you are unsure about a fact, say so — do not hallucinate.
8. Medical device regulatory accuracy is paramount. Do not guess on compliance questions.

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
    "search_gmail": "Searching Gmail…",
    "read_gmail_message": "Reading email…",
    "search_drive": "Searching Google Drive…",
    "list_drive_folder": "Browsing Drive folder…",
    "list_shared_drives": "Listing shared drives…",
    "search_drive_content": "Reading Drive files…",
    "read_drive_file": "Reading Drive file…",    "list_recent_drive_files": "Checking your recent documents…",
    "follow_drive_document": "Opening your document…",
    "unfollow_drive_document": "Closing the document…",
    "add_to_knowledge_base": "Adding to the Knowledge Base…",
    "check_drive_backup_status": "Checking the Drive backup…",
    "get_file_template": "Checking the document template…",    "get_calendar_events": "Fetching calendar…",
    "search_contacts": "Looking up contact…",
    "add_contacts": "Adding to contacts…",
    "read_google_sheet": "Reading spreadsheet…",
    "list_google_tasks": "Fetching Google Tasks…",
    "generate_file": "Generating file…",
    "create_docx": "Creating Word document…",
    "upload_to_drive": "Uploading to Google Drive…",
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
        client = await get_llm_client(db, task="chat")
        return cls(db=db, user_id=user_id, conversation_id=conversation_id, ollama=client)

    async def run(self, user_text: str) -> AsyncGenerator[str, None]:
        """
        Async generator that yields JSON-encoded WebSocket frames as strings.
        Yields WSToken frames during streaming, then a final WSDone or WSError.
        """
        return self._run(user_text)

    async def _run(self, user_text: str, voice: bool = False) -> AsyncGenerator[str, None]:
        # ── 1. Persist user message ─────────────────────────────────────────
        msg_repo = MessageRepository(self.db)
        await msg_repo.create(
            conversation_id=self.conversation_id,
            role=MessageRole.USER,
            content=user_text,
        )
        await self.db.commit()

        # ── 2. Build Ollama message history ───────────────────────────────────
        messages = await self._build_history(user_text, voice=voice)

        # ── 3. Agentic loop ───────────────────────────────────────────────────
        embedding_svc = await get_embedding_service_for_db(self.db)
        tool_ctx = ToolContext(
            db=self.db,
            user_id=self.user_id,
            conversation_id=self.conversation_id,
            embedding_service=embedding_svc,
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

            # ── No tool calls → final answer ──────────────────────────────────
            # Determine whether we're in prompt-based tool mode
            from services.llm.ollama import OllamaClient, _tools_support_cache
            _use_prompt_tools = (
                isinstance(self.ollama, OllamaClient)
                and not _tools_support_cache.get(self.ollama._model, True)
            )

            if not tool_calls_this_round:
                accumulated_content += content_this_round
                # Save the final clean answer
                import re as _re
                clean_content = _re.sub(r"<tool_call>.*?</tool_call>", "", accumulated_content, flags=_re.DOTALL).strip()
                assistant_msg = await msg_repo.create(
                    conversation_id=self.conversation_id,
                    role=MessageRole.ASSISTANT,
                    content=clean_content,
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
            if _use_prompt_tools:
                # In prompt-tools mode, strip any <tool_call> tags from the message
                import re as _re
                clean_round = _re.sub(r"<tool_call>.*?</tool_call>", "", content_this_round, flags=_re.DOTALL).strip()
                messages.append({"role": "assistant", "content": clean_round})
            else:
                # Pass tool_calls WITH ids so provider clients can reconstruct
                # the correct API format (OpenAI needs id+string args, Anthropic
                # needs tool_use content blocks — both clients handle this in
                # _convert_messages / _split_messages)
                messages.append({
                    "role": "assistant",
                    "content": content_this_round,
                    "tool_calls": tool_calls_this_round,
                })

            for tc in tool_calls_this_round:
                fn = tc.get("function", {})
                tool_name = fn.get("name", "")
                raw_args = fn.get("arguments", {})
                args: dict[str, Any] = raw_args if isinstance(raw_args, dict) else {}
                tc_id = tc.get("id", "")

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

                # If a tool staged a confirm/cancel popup (e.g. KB deletion),
                # emit it to the client and clear it. The frontend performs the
                # destructive action only after the user confirms.
                if tool_ctx.pending_confirmation is not None:
                    import json as _json
                    yield _json.dumps(tool_ctx.pending_confirmation)
                    tool_ctx.pending_confirmation = None

                if _use_prompt_tools:
                    # Inject result as a user message so the model can read it
                    messages.append({"role": "user", "content": f"[Tool result for {tool_name}]:\n{result}\n\nNow answer the user's original question using this data. Do NOT make up any information."})
                else:
                    # Use the client's provider-correct format (OpenAI needs tool_call_id,
                    # Anthropic needs tool_use_id in a content block, Ollama just uses role=tool)
                    messages.append(self.ollama.build_tool_result_message(tc_id, tool_name, result))

        # Exceeded MAX_TOOL_ROUNDS. Rather than dropping the work (or returning a
        # bare error), make one FINAL streaming call with NO tools so the model is
        # forced to write its answer from everything it has already gathered.
        accumulated_content += content_this_round
        messages.append({
            "role": "user",
            "content": (
                "You have reached the maximum number of tool calls for this turn. "
                "Do NOT call any more tools. Using everything you have gathered so "
                "far, write your complete final answer now."
            ),
        })

        final_content = ""
        final_model = ""
        try:
            async for chunk in self.ollama.chat_stream(messages, tools=None):
                if chunk.content:
                    final_content += chunk.content
                    yield WSToken(
                        content=chunk.content,
                        conversation_id=str(self.conversation_id),
                    ).model_dump_json()
                if chunk.done:
                    final_model = chunk.model
        except Exception:  # noqa: BLE001 — fall back to whatever we already have
            logger.exception("Final no-tools answer failed after exhausting tool rounds")

        import re as _re
        body = final_content or accumulated_content
        clean_content = _re.sub(
            r"<tool_call>.*?</tool_call>", "", body, flags=_re.DOTALL
        ).strip()

        if clean_content:
            assistant_msg = await msg_repo.create(
                conversation_id=self.conversation_id,
                role=MessageRole.ASSISTANT,
                content=clean_content,
                model_name=final_model,
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

    async def _build_history(self, user_text: str, voice: bool = False) -> list[dict[str, Any]]:
        """Load conversation history and return Ollama message list."""
        msg_repo = MessageRepository(self.db)
        history = await msg_repo.list_for_conversation(
            self.conversation_id, limit=40, most_recent=True
        )

        today = datetime.now(timezone.utc).strftime("%B %d, %Y")

        # Inject live Google auth state so the model cannot hallucinate Drive/Gmail data
        try:
            from services.google_service import get_credentials
            google_connected = get_credentials() is not None
        except Exception:
            google_connected = False

        if google_connected:
            google_note = (
                "\nGOOGLE STATUS: Connected. "
                "ALWAYS call the appropriate Google tool immediately when the user mentions "
                "Drive, Gmail, Calendar, contacts, or any Google Workspace content. "
                "Do NOT describe what you are about to do — just call the tool and show the result. "
                "Examples: 'can you see my drive' → call list_drive_folder immediately. "
                "'any emails about X' → call search_gmail immediately. "
                "'what's on my calendar' → call get_calendar_events immediately."
            )
        else:
            google_note = (
                "\nGOOGLE STATUS: NOT CONNECTED. "
                "You have NO access to Google Drive, Gmail, Calendar, or any Google service. "
                "Do NOT list, guess, or fabricate any file names, emails, events, or folder names. "
                "If the user asks about their files, emails, or calendar, "
                "tell them to connect Google via Settings → Google Integration."
            )

        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": SYSTEM_PROMPT.format(today=today) + google_note + HONESTY_CONTRACT,
            }
        ]

        # Who Gerry is assisting — name for sign-offs, account + Gmail address.
        try:
            from services.agent.user_identity import get_user_identity_context
            identity = await get_user_identity_context(self.db, self.user_id)
            if identity:
                messages[0]["content"] += identity
        except Exception:  # noqa: BLE001 — identity is best-effort
            logger.exception("Failed to load user identity")

        # Spoken conversations get short, listenable replies that always offer
        # more detail on request.
        if voice:
            from services.agent.guardrails import VOICE_MODE_NOTE
            messages[0]["content"] += VOICE_MODE_NOTE

        # Always-available company facts (fast local-cache read — never hits Drive).
        # Placed before the attachment context; honesty rules already precede it
        # in the v1 prompt, and the block itself instructs no fabrication beyond it.
        try:
            from services.company_context import get_company_context
            company_ctx = await get_company_context(self.db)
            if company_ctx:
                messages[0]["content"] += company_ctx
        except Exception:  # noqa: BLE001 — company context is best-effort
            logger.exception("Failed to load company context")

        # Inject any conversation reference-file attachments into the system prompt.
        try:
            from services.chat_attachments import build_attachments_context
            attach_ctx = await build_attachments_context(self.db, self.conversation_id)
            if attach_ctx:
                messages[0]["content"] += attach_ctx
        except Exception:  # noqa: BLE001 — attachments are best-effort context
            logger.exception("Failed to build attachment context")

        # Live followed document — re-read fresh every turn so Gerry always
        # sees the user's latest edits.
        try:
            from services.live_document import build_live_doc_context
            live_doc = await build_live_doc_context(self.db, self.conversation_id)
            if live_doc:
                messages[0]["content"] += live_doc
        except Exception:  # noqa: BLE001 — live doc is best-effort context
            logger.exception("Failed to build live document context")

        # Workroom — if this conversation is pinned to a co-work room, inject
        # the room's goal, pinned artifacts, and recent journal every turn.
        try:
            from services.workroom_context import build_workroom_context
            room_ctx = await build_workroom_context(self.db, self.conversation_id)
            if room_ctx:
                messages[0]["content"] += room_ctx
        except Exception:  # noqa: BLE001 — workroom is best-effort context
            logger.exception("Failed to build workroom context")

        # The most-recent window can begin mid-conversation on an assistant turn;
        # skip leading non-user messages so the conversation starts on a user
        # turn (Anthropic requires the first message to use the user role).
        relevant = [m for m in history if m.role in (MessageRole.USER, MessageRole.ASSISTANT)]
        while relevant and relevant[0].role != MessageRole.USER:
            relevant.pop(0)
        for msg in relevant:
            messages.append({"role": msg.role, "content": msg.content})

        # The latest user message is already in history (just committed),
        # but list_for_conversation returns all including it — so no need to re-add.
        return messages
