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
    "search_knowledge_base": "Semantic search over uploaded PMI internal documents. Use for regulatory docs, SOPs, device specs, meeting notes. Returns only the few most-similar chunks.",
    "read_knowledge_base_document": "Read the COMPLETE text of one imported KB document (every section, start to finish). Use when asked to summarize, review, or analyze a WHOLE document — search only returns scattered chunks. JSON fields: {\"document_id\": str (preferred) or \"query\": str (title).}",
    "create_task": "Create a new task in the PMI task tracker (Kanban board). Auto-approved.",
    "request_approval": "Submit an irreversible action for human approval before execution. Required for emails, calendar events, and any external write.",
    "propose_odoo_write": (
        'Propose a WRITE to the connected Odoo ERP (queues an approval; never writes directly). '
        'JSON fields: {"action": "confirm_quotation"|"register_payment"|"create_lead"|"log_note"|"update_field"|"create_contact", '
        '"params": object}. params by action: confirm_quotation {order_id}; register_payment {move_id, amount?}; '
        'create_lead {name, contact_name?, email_from?, phone?, expected_revenue?, description?}; '
        'log_note {model, record_id, body}; update_field {model, record_id, values}; create_contact {name, email?, phone?, city?}.'
    ),
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
    "read_drive_file": "Read the full text of a Google Drive file — including a live Google Doc the user is writing. Accepts a file ID or a full pasted Docs/Drive URL. Long documents return in 30k-character pages: when a CONTINUE note appears, call again with the suggested offset and read to the end before concluding. JSON: {\"file_id\": str, \"offset\": int (optional, default 0)}.",
    "list_recent_drive_files": 'List the user\'s most recently modified Drive files (newest first). Use when they say "help me with this document" without a link — confirm which one, then follow it. JSON: {"max_results": int (optional)}.',
    "follow_drive_document": 'Follow a Google Doc in THIS conversation: its current contents are re-read automatically on every message so you always see the latest edits. JSON: {"file_id": str (ID or pasted URL)}.',
    "unfollow_drive_document": "Stop following the live document in this conversation. No arguments.",
    "add_to_knowledge_base": 'Add a file to the Knowledge Base (searchable + citable). JSON: {"drive_file_id": str (Drive ID or pasted URL)} OR {"generated_filename": str}; optional "title", "category". Duplicates reported; never regulated.',
    "check_drive_backup_status": "Verify the company Drive → GCS nightly backup is current: last backup write, CURRENT/STALE verdict, files changed since. No arguments.",
    "get_file_template": 'Get the company\'s required structure for a document type from the shared Drive templates folder. ALWAYS call before generate_file/create_docx. Returns the template plus the company style guide; with no matching template the style guide alone is returned — apply it. JSON: {"file_type": "memo"|"SOP"|"letter"|...}.',
    "add_to_workroom": 'Pin an artifact to a Workroom (persistent co-work space) so it is carried into every future turn there. JSON: {"kind": "drive_doc"|"kb_doc"|"generated_file"|"note"|"email_thread"|"task"|"odoo_record"|"regulatory_doc", "label": str, "ref_id"?: str, "workroom_title"?: str (omit inside a room conversation)}.',
    "list_workroom_items": 'List a Workroom\'s goal, pinned artifacts, and recent journal entries. JSON: {"workroom_title"?: str} — omit inside a room conversation; with no match the active room titles are listed.',
    "log_workroom_progress": 'Append a one-sentence progress entry to a Workroom\'s journal (shared timeline of accomplishments). JSON: {"entry": str, "workroom_title"?: str (omit inside a room conversation)}.',
    "get_calendar_events": "Fetch upcoming Google Calendar events within a date range.",
    "search_contacts": "Look up a person's contact details by name, email, or company — searches PMI's own contacts (derived from email + manual entries) and Google Contacts. Good for 'who is our contact at <company>'.",
    "add_contacts": 'Add or update one or more contacts on PMI\'s own Contacts page (not Odoo, not Google). JSON: {"contacts": [{"email": str (required), "name": str, "company": str, "notes": str}, ...]}.',
    "read_google_sheet": "Read values from a Google Sheets spreadsheet.",
    "list_google_tasks": "List tasks from Google Tasks.",
    "generate_file": "Generate and export a document (PDF/DOCX/TXT) from provided content.",
    "create_docx": 'Create a Word (.docx) document from lightweight Markdown. Pipe tables: with a "| --- |" separator after row 1 the first row is a colored header; without it the table is a label/value grid (label columns accent-filled, bold white). JSON: {"filename", "title", "content"}; optional layout from the company template/style guide: "font", "font_size", "header_left", "header_right", "footer_left" (Page X of Y auto), "accent_color" (hex), and a cover banner via "banner_label"/"banner_title"/"banner_subtitle" (do not repeat the title in content).',
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
    "request_kb_deletion": (
        "Request permanent deletion of a Knowledge Base document. Use ONLY when the user explicitly asks "
        "to delete/remove a KB document. This does NOT delete anything — it shows the user a final confirm/cancel "
        "popup and the document is removed only if they confirm there. After calling it, stop and wait for their decision. "
        'JSON fields: {"document_id": str (UUID, preferred), "query": str (a title/search term if the id is unknown)}.'
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
            # NOTE: the parameter MUST NOT be called "args" — LangChain's schema
            # generation treats that as a reserved name and silently rewrites it
            # to "v__args" with type array, which broke every tool call (the
            # model could only ever send {"v__args": [...]}).
            @lc_tool(name, description=description)
            async def _tool(payload: str = "") -> str:
                """payload: a JSON object string with this tool's fields, e.g. '{"query": "..."}'."""
                import json
                raw = payload.strip() if isinstance(payload, str) else payload
                if isinstance(raw, dict):
                    parsed = raw
                elif raw and raw[0] in "{[":
                    try:
                        parsed = json.loads(raw)
                    except Exception:
                        parsed = {"input": raw}
                    if not isinstance(parsed, dict):
                        parsed = {"input": parsed}
                else:
                    parsed = {"input": raw} if raw else {}
                return await dispatch_tool(ctx, name, parsed)
            return _tool

        tools.append(_make(tool_name, doc))

    return tools
