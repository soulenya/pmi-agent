"""
Tool definitions in LangChain format for the v2 LangGraph agent system.

These wrap the existing tool execution functions from services.agent.tools
so they can be used both by the legacy executor and the new LangGraph agents.
"""
from __future__ import annotations

from langchain_core.tools import tool as lc_tool

# ── Tool context is injected at runtime via a closure ────────────────────────
# Each agent creates bound_tools(ctx) which returns callable tool objects.

_TOOL_DOCS = {
    "search_knowledge_base": "Semantic search over uploaded PMI internal documents. Use for regulatory docs, SOPs, device specs, meeting notes.",
    "create_task": "Create a new task in the PMI task tracker (Kanban board). Auto-approved.",
    "request_approval": "Submit an irreversible action for human approval before execution. Required for emails, calendar events, and any external write.",
    "get_pending_approvals": "List all pending approval requests waiting for human review.",
    "get_tasks": "List tasks from the PMI task tracker with optional status/priority filters.",
    "get_regulatory_status": "Get the current regulatory filing status and compliance overview for the VACTOR program.",
    "search_web": "Search the public web (DuckDuckGo) for research, news, or regulatory guidance.",
    "fetch_page": "Download and extract readable text from a public URL.",
    "search_gmail": "Search the connected Gmail inbox using a query string.",
    "read_gmail_message": "Read the full body of a specific Gmail message by ID.",
    "search_drive": "Search Google Drive files by name or keyword.",
    "list_drive_folder": "List files and folders inside a Google Drive folder (default: root of My Drive). For a shared drive's root, pass folder_id AND drive_id = the shared drive ID from list_shared_drives.",
    "list_shared_drives": "List all Google shared (team) drives — the top-level folder trees beside My Drive. Use FIRST when top-level folders (Communications, Knowledge, Compliance, etc.) are not in My Drive.",
    "search_drive_content": "Read and search inside Google Drive files (by name keyword).",
    "read_drive_file": "Read the full text content of a specific Google Drive file by ID.",
    "get_calendar_events": "Fetch upcoming Google Calendar events within a date range.",
    "search_contacts": "Search Google Contacts by name, email, or company.",
    "read_google_sheet": "Read values from a Google Sheets spreadsheet.",
    "list_google_tasks": "List tasks from Google Tasks.",
    "generate_file": "Generate and export a document (PDF/DOCX/TXT) from provided content.",
    "create_docx": 'Create a Word (.docx) document from lightweight Markdown. JSON fields: {"filename": str, "title": str, "content": str (Markdown)}.',
    "upload_to_drive": (
        'Upload a previously generated file to Google Drive. REQUIRES explicit user confirmation first. '
        'JSON fields: {"filename": str (exact generated-file name), "drive_name": str (optional), "folder_id": str (optional)}.'
    ),
    # ── House Manager custodian tools ─────────────────────────────────────────
    "list_conversations": 'List all chat conversations with IDs, titles, and message counts. JSON fields: {"include_archived": bool (optional), "limit": int (optional)}.',
    "read_conversation": 'Read the messages of a conversation. JSON fields: {"conversation_id": str (UUID), "limit": int (optional)}.',
    "update_conversation": (
        'Rename, pin, archive, or delete a conversation. JSON fields: {"conversation_id": str (UUID), '
        '"title": str (optional), "pinned": bool (optional), "archived": bool (optional), '
        '"action": "delete" (optional, destructive), "confirm": bool (required true for delete, only after the user explicitly confirms)}.'
    ),
    "list_generated_files": "List all files in Generated Files with sizes and dates. No arguments needed.",
    "manage_generated_file": (
        'Rename or delete a generated file. JSON fields: {"action": "rename"|"delete", "filename": str (exact name), '
        '"new_name": str (for rename), "confirm": bool (required true for delete, only after the user explicitly confirms)}.'
    ),
    "update_task": (
        'Edit, complete, or delete a task on the task board. JSON fields: {"task_id": str (UUID), "title": str (optional), '
        '"description": str (optional), "status": "backlog"|"todo"|"in_progress"|"done"|"cancelled" (optional), '
        '"priority": "low"|"medium"|"high"|"critical" (optional), "action": "delete" (optional, destructive), '
        '"confirm": bool (required true for delete, only after the user explicitly confirms)}.'
    ),
    "list_scheduled_tasks": "List all recurring scheduled tasks with their schedules and run history. No arguments needed.",
    "manage_scheduled_task": (
        'Create, update, enable, disable, or delete a recurring scheduled task. JSON fields: '
        '{"action": "create"|"update"|"enable"|"disable"|"delete", "task_id": str (UUID, for non-create), '
        '"title": str, "prompt": str (the instruction the agent runs), "frequency": "daily"|"weekly"|"monthly", '
        '"day_of_week": int 0-6 Mon-Sun (weekly), "day_of_month": int 1-31 (monthly), "hour": int, "minute": int, '
        '"confirm": bool (required true for disable/delete, only after the user explicitly confirms)}.'
    ),
    "manage_knowledge_base": (
        'List or remove knowledge base documents. JSON fields: {"action": "list"|"delete", "document_id": str (UUID, for delete), '
        '"confirm": bool (required true for delete, only after the user explicitly confirms)}.'
    ),
    "get_app_overview": "Get a one-shot snapshot of the whole app: counts of conversations, tasks, KB documents, scheduled tasks, generated files, pending approvals, and the app version. No arguments needed.",
    "get_app_settings": "READ ONLY: list app settings (secrets are masked). Settings can only be changed by the user in the Settings page.",
    "list_users": "READ ONLY: list user accounts with roles and status. User management is done by the user in Settings.",
    "get_audit_trail": 'READ ONLY: view the append-only audit log. JSON fields: {"limit": int (optional), "event_type": str (optional filter)}.',
    "get_approvals": 'READ ONLY: view approval request history. Only the user can approve or reject. JSON fields: {"status": "pending"|"approved"|"rejected" (optional), "limit": int (optional)}.',
    "delegate_to_agent": (
        "Delegate a task to a specialist agent and get their full answer back. "
        'JSON fields: {"agent": "research"|"engineering"|"regulatory"|"qms"|"operations"|"ir"|"executive_assistant", '
        '"instruction": str (a clear, self-contained task brief — include all needed context)}. '
        "Use for deep work in a specialist's domain: web research, regulatory analysis, QMS questions, "
        "investor material, engineering review, operations data."
    ),
}


def make_lc_tools(ctx) -> list:
    """
    Return a list of LangChain @tool-decorated callables, each pre-bound to ctx.
    Called once per agent invocation with the active ToolContext.
    """
    from services.agent.tools import dispatch_tool
    import asyncio

    tools = []
    for tool_name, doc in _TOOL_DOCS.items():
        # We need a closure to capture tool_name
        def _make(name: str, description: str):
            @lc_tool(name, description=description)
            async def _tool(args: str = "") -> str:
                """Execute a PMI agent tool."""
                import json
                try:
                    parsed = json.loads(args) if args.strip().startswith("{") else {"input": args}
                except Exception:
                    parsed = {"input": args}
                return await dispatch_tool(ctx, name, parsed)
            return _tool

        tools.append(_make(tool_name, doc))

    return tools
