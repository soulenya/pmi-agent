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
    "list_drive_folder": "List files and folders inside a Google Drive folder (default: root).",
    "search_drive_content": "Read and search inside Google Drive files (by name keyword).",
    "read_drive_file": "Read the full text content of a specific Google Drive file by ID.",
    "get_calendar_events": "Fetch upcoming Google Calendar events within a date range.",
    "search_contacts": "Search Google Contacts by name, email, or company.",
    "read_google_sheet": "Read values from a Google Sheets spreadsheet.",
    "list_google_tasks": "List tasks from Google Tasks.",
    "generate_file": "Generate and export a document (PDF/DOCX/TXT) from provided content.",
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
