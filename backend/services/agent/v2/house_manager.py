"""
House Manager Agent — Little Gerry's custodian/overseer persona.

This is the agent the user speaks to in voice sessions ("Talk with Little
Gerry"). It has application-wide visibility, day-to-day write authority over
app content, and can delegate deep work to the specialist agents.

Hard boundaries (enforced in the tool layer, repeated in the prompt):
  READ ONLY : settings, user management, regulatory, audit trail, approvals
  CONFIRM   : destructive actions and Google Drive uploads require explicit
              user confirmation before the tool will execute
"""
from __future__ import annotations

import logging
from typing import Any

from services.agent.v2.base_agent import BaseAgent

logger = logging.getLogger(__name__)

_PROMPT = """\
You are Little Gerry, the House Manager for Precisian Medical Instruments (PMI) — \
the custodian and overseer of the whole Little Gerry application. The user usually \
TALKS to you out loud, and your replies are read aloud by text-to-speech.

YOUR AUTHORITY:
- Full visibility of the app: conversations, generated files, tasks, scheduled tasks, \
knowledge base, settings, users, approvals, audit trail, regulatory status, Google Workspace.
- Read AND write: conversations (rename/pin/archive/delete), generated files (rename/delete), \
tasks (create/edit/complete/delete), scheduled tasks (create/edit/enable/disable/delete), \
knowledge base (list/remove), document creation (generate_file, create_docx).
- READ ONLY — you may look but NEVER change: app settings, user accounts, regulatory records, \
the audit trail, and approvals (only the user may approve or reject). Google Workspace is \
read-only EXCEPT upload_to_drive, which needs the user's confirmation.
- You can DELEGATE work to specialist agents with delegate_to_agent: research, engineering, \
regulatory, qms, operations, ir, executive_assistant. Use them for deep domain work, then \
summarise their answer in your own words.

CONFIRMATION RULES (non-negotiable):
1. Before ANY destructive action (deleting a conversation, file, task, scheduled task, or \
knowledge base document; disabling a scheduled task) you MUST first tell the user exactly \
what will be affected and ask "shall I go ahead?". Only after they clearly say yes do you \
call the tool with "confirm": true.
2. Before uploading anything to Google Drive, state the file name and ask for confirmation \
the same way.
3. Never set "confirm": true on your own initiative.

SPOKEN-REPLY STYLE (strict):
- You are usually heard, not read: replies must be SHORT and free of markdown, \
bullet symbols, tables, and emojis. Use plain sentences.
- ANSWER ONLY — never recap your process, the steps you took, or what tools you ran. \
The user wants the result, not the journey.
- Report findings in this shape: "Based on my research in <where you looked>, <the answer>." \
or "After looking through <where you looked>, I found <the answer>." If nothing was found: \
"After looking through <where you looked>, I couldn't find anything because <the reason>."
- One to three sentences for most answers. Only go longer when the user explicitly asks \
for detail.
- Never read out UUIDs or long IDs; refer to things by title or name.
- For long content, create a file (generate_file or create_docx) and say where to find it.
- When you delegate, briefly say who you're asking (e.g. "Let me have Research look into that").

RESEARCH ORDER (strict):
1. ALWAYS search the PMI knowledge base FIRST (search_knowledge_base) for any research, \
question, or content-generation request.
2. Only if the knowledge base has nothing useful, move on to Google Drive, Gmail, the web, \
or a specialist agent.
3. When generating documents, ground them in knowledge-base content first, then supplement \
from other sources.

GENERAL RULES:
1. Call tools immediately — don't narrate what you're about to do, except for confirmations.
2. Be accurate about regulatory and compliance matters; never guess.
3. If you are unsure, say so — do not make things up.

Today's date: {today}
"""

_TOOLS = [
    # Custodian — read/write
    "list_conversations",
    "read_conversation",
    "update_conversation",
    "list_generated_files",
    "manage_generated_file",
    "create_task",
    "get_tasks",
    "update_task",
    "list_scheduled_tasks",
    "manage_scheduled_task",
    "manage_knowledge_base",
    "request_kb_deletion",
    "get_app_overview",
    # Custodian — read only
    "get_app_settings",
    "list_users",
    "get_audit_trail",
    "get_approvals",
    "get_pending_approvals",
    "get_regulatory_status",
    # Knowledge & web
    "search_knowledge_base",
    "read_knowledge_base_document",
    "search_web",
    "fetch_page",
    # Google Workspace (read only, plus confirmed Drive upload)
    "search_gmail",
    "read_gmail_message",
    "search_drive",
    "list_drive_folder",
    "list_shared_drives",
    "search_drive_content",
    "read_drive_file",
    "get_calendar_events",
    "search_contacts",
    "read_google_sheet",
    "list_google_tasks",
    "upload_to_drive",
    # Documents & approvals
    "generate_file",
    "create_docx",
    "request_approval",
    # Delegation
    "delegate_to_agent",
]

# Agents the House Manager may delegate to (depth 1 — specialists cannot
# delegate further because none of them has delegate_to_agent in TOOLS).
_DELEGATABLE = {
    "research",
    "engineering",
    "regulatory",
    "qms",
    "operations",
    "ir",
    "executive_assistant",
}

_MAX_DELEGATIONS_PER_RUN = 5


class HouseManagerAgent(BaseAgent):
    AGENT_NAME = "house_manager"
    SYSTEM_PROMPT = _PROMPT
    TOOLS = _TOOLS

    def __init__(self, llm, ctx) -> None:
        super().__init__(llm, ctx)
        self._delegations_used = 0

    async def _call_tool(self, tool_name: str, args: Any) -> str:
        if tool_name == "delegate_to_agent":
            args = self._normalize_tool_args(args)
            # A bare-string call becomes {"input": "..."} — treat it as the instruction
            if "instruction" not in args and isinstance(args.get("input"), str):
                args = {**args, "instruction": args["input"]}
            return await self._delegate(args)
        return await super()._call_tool(tool_name, args)

    async def _delegate(self, args: dict[str, Any]) -> str:
        agent_name = str(args.get("agent", "")).strip().lower()
        instruction = str(args.get("instruction", "")).strip()

        if agent_name not in _DELEGATABLE:
            return (
                f"Error: unknown agent '{agent_name}'. "
                'Call delegate_to_agent with a JSON object: '
                '{"agent": "<name>", "instruction": "<self-contained task brief>"}. '
                f"Agents: {', '.join(sorted(_DELEGATABLE))}."
            )
        if not instruction:
            return "Error: an instruction is required."
        if self._delegations_used >= _MAX_DELEGATIONS_PER_RUN:
            return "Error: delegation limit reached for this turn. Answer with what you have."
        self._delegations_used += 1

        from services.agent.v2.engineering_agent import EngineeringAgent
        from services.agent.v2.executive_assistant import ExecutiveAssistantAgent
        from services.agent.v2.ir_agent import IRAgent
        from services.agent.v2.operations_agent import OperationsAgent
        from services.agent.v2.qms_agent import QMSAgent
        from services.agent.v2.regulatory_agent import RegulatoryAgent
        from services.agent.v2.research_agent import ResearchAgent

        _MAP = {
            "executive_assistant": ExecutiveAssistantAgent,
            "research": ResearchAgent,
            "regulatory": RegulatoryAgent,
            "qms": QMSAgent,
            "ir": IRAgent,
            "engineering": EngineeringAgent,
            "operations": OperationsAgent,
        }

        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        google_connected = await self._delegate_google_connected()

        logger.info("House Manager delegating to %s: %s", agent_name, instruction[:120])
        specialist = _MAP[agent_name](llm=self.llm, ctx=self.ctx)

        parts: list[str] = []
        try:
            async for frame in specialist.run(
                messages=[{"role": "user", "content": instruction}],
                today=today,
                google_connected=google_connected,
            ):
                if frame.get("type") == "token":
                    parts.append(frame.get("content", ""))
                elif frame.get("type") == "error":
                    detail = frame.get("detail", "unknown error")
                    return f"The {agent_name} agent hit an error: {detail}"
        except Exception as exc:  # noqa: BLE001 — return a readable result to the model
            logger.exception("Delegation to %s failed", agent_name)
            return f"Delegation to {agent_name} failed: {exc}"

        answer = "".join(parts).strip()
        if not answer:
            return f"The {agent_name} agent finished but returned no text."
        return f"[{agent_name} agent's answer]\n{answer}"

    async def _delegate_google_connected(self) -> bool:
        # Same source of truth as the tools: google_token.json via
        # google_service.get_credentials() (the DB table is never written).
        from services.google_service import get_credentials
        try:
            return get_credentials() is not None
        except Exception:
            return False
