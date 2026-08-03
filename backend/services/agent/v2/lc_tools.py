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
    "request_approval": "Submit an irreversible action for human approval before execution. Required for emails, calendar events, and any external write. For send_email the payload supports to/subject/body/cc/bcc/attachments and reply threading via 'thread_id' + 'reply_to_message_id' (from search_gmail/read_gmail_message).",
    "propose_odoo_write": (
        'Propose a WRITE to the connected Odoo ERP (queues an approval; never writes directly). '
        'JSON fields: {"action": "confirm_quotation"|"register_payment"|"create_lead"|"log_note"|"update_field"|"create_contact", '
        '"params": object}. params by action: confirm_quotation {order_id}; register_payment {move_id, amount?}; '
        'create_lead {name, contact_name?, email_from?, phone?, expected_revenue?, description?}; '
        'log_note {model, record_id, body}; update_field {model, record_id, values}; create_contact {name, email?, phone?, city?}.'
    ),
    "get_approvals": 'View approval requests — pending or resolved. READ ONLY: only the user can approve or reject. JSON fields: {"status": "pending"|"approved"|"rejected"|"expired"|"cancelled" (optional; omit for recent history), "limit": int (optional)}.',
    "get_tasks": "List tasks from the PMI task tracker with optional status/priority filters.",
    "get_regulatory_status": "Get the current regulatory filing status and compliance overview for the VACTOR program.",
    "search_web": "Search the public web (DuckDuckGo) for research, news, or regulatory guidance.",
    "fetch_page": "Download and extract readable text from a public URL.",
    "search_gmail": "Search the connected Gmail inbox using a query string.",
    "read_gmail_message": "Read the full body of a specific Gmail message by ID.",
    "search_drive": "FIND Google Drive files by keyword (full-text match) — returns names/links/dates, does NOT read contents. For questions about what's INSIDE files use search_drive_content; if one finds nothing, try the other. QMS-folder and draft files are withheld by standing policy unless the user explicitly asks (then confirm folder+file with them and retry with confirm_restricted=true).",
    "list_drive_folder": "List files and folders inside a Google Drive folder (default: root of My Drive). For a shared drive's root, pass folder_id AND drive_id = the shared drive ID from list_shared_drives. The QMS folder and draft files are blocked by standing policy unless the user explicitly asks (confirm folder+file, then confirm_restricted=true).",
    "list_shared_drives": "List all Google shared (team) drives — the top-level folder trees beside My Drive. Use FIRST when top-level folders (Communications, Knowledge, Compliance, etc.) are not in My Drive.",
    "search_drive_content": "Search Google Drive by keyword AND READ the full text of top matches — for answering questions about non-imported Drive documents. Heavier than search_drive (which only lists matches).",
    "read_drive_annotations": 'Read the REVIEW LAYER of a Drive file: comment threads (author, anchored text, replies, resolved state — any file type) and, for native Google Docs, suggested edits from Suggesting mode rendered as {++insertion++}/{--deletion--}. Use for questions about comments, feedback, or tracked suggestions. JSON: {"file_id": str (id or pasted URL)}.',
    "list_gmail_drafts": 'List UNSENT drafts in the Gmail Drafts folder (draft_id, to, subject, snippet) — search_gmail does NOT see drafts. Use to find or audit a draft before it is sent. JSON: {"max_results"?: int (1-20, default 10)}.',
    "read_gmail_draft": 'Read one UNSENT Gmail draft\'s full content by draft_id (from list_gmail_drafts) — use to fact-check a draft\'s claims against Company Context and the KB BEFORE it is sent. JSON: {"draft_id": str}.',
    "compile_company_timeline": 'REQUIRED FIRST STEP for any time-bounded report (monthly/quarterly update, period review). Chronological evidence digest for the period from company records: meetings, tasks started/completed, workroom journals, KB additions, email drafts — grouped by month with honest EVIDENCE GAPS. Cross-check findings vs Company Context/KB/Gmail, identify start/finish events, patterns, personnel changes, and ASK THE USER about anything unclear BEFORE drafting. JSON: {"start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}.',
    "extract_document": 'Read a scanned PDF or image (certificate, invoice, form, photo of a document) with VISION — works where normal text extraction returns nothing. Returns transcribed text and, with a schema, structured JSON (null for missing fields, never invented). Source is exactly ONE of: {"drive_file_id": str (id or pasted URL)} | {"generated_filename": str} | {"attachment_name": str (file attached to this conversation)}; optional "schema_name" (str — a SAVED schema: invoice, certificate, purchase_order, dd214… preferred), "schema" (object, custom JSON shape), "instruction" (str), "confirm_restricted" (bool — QMS/draft Drive files only after explicit user confirmation).',
    "read_drive_file": "Read the full text of a Google Drive file — including a live Google Doc the user is writing. Accepts a file ID or a full pasted Docs/Drive URL. Long documents return in 30k-character pages: when a CONTINUE note appears, call again with the suggested offset and read to the end before concluding. Returns committed body text only — for comments and Suggesting-mode edits use read_drive_annotations. QMS-folder and draft files are blocked by standing policy unless the user explicitly asked — confirm folder+file with them first, then retry with confirm_restricted=true. JSON: {\"file_id\": str, \"offset\": int (optional, default 0), \"confirm_restricted\": bool (optional)}.",
    "list_recent_drive_files": 'List the user\'s most recently modified Drive files (newest first). Use when they say "help me with this document" without a link — confirm which one, then follow it. JSON: {"max_results": int (optional)}.',
    "follow_drive_document": 'Follow a Google Doc in THIS conversation: its current contents are re-read automatically on every message so you always see the latest edits. JSON: {"file_id": str (ID or pasted URL)}.',
    "unfollow_drive_document": "Stop following the live document in this conversation. No arguments.",
    "request_drive_edit_permission": 'Ask the user to let you edit ONE specific Drive file. Shows them an Allow/Don\'t allow prompt naming that file; nothing is granted unless they click Allow. Permission is PER FILE and never carries over to another document, so call this whenever you don\'t already hold a grant for the exact file in front of you. After calling, STOP and wait for their decision. JSON: {"file_id": str (ID or pasted URL), "reason"?: str (one line on what you intend to change)}.',
    "edit_drive_file": 'Edit a granted Drive file IN PLACE — the change is immediately live in the user\'s real document. Refuses unless request_drive_edit_permission was granted for that exact file. Read the file first, then prefer a targeted "replace" over "overwrite", which discards the entire existing body. Docs: append|replace|overwrite. Sheets: set_cells|append. Text/markdown files: append|replace|overwrite. Drive version history is the undo path. JSON: {"file_id": str, "mode": "append"|"replace"|"overwrite"|"set_cells", "text"?: str, "find"?: str, "replace"?: str, "cell_range"?: str (A1, e.g. "Ledger!A2:D5"), "values"?: [[str]]}.',
    "list_drive_edit_permissions": "List the Drive files the user has given you permission to edit. Check here before asking for permission again. No arguments.",
    "add_to_knowledge_base": 'Add a file to the Knowledge Base (searchable + citable). JSON: {"drive_file_id": str (Drive ID or pasted URL)} OR {"generated_filename": str}; optional "title", "category". Duplicates reported; never regulated.',
    "check_drive_backup_status": "Verify the company Drive → GCS nightly backup is current: last backup write, CURRENT/STALE verdict, files changed since. No arguments.",
    "get_file_template": 'Get the company\'s required structure for a document type from the shared Drive templates folder. ALWAYS call before generate_file/create_docx. Returns the template plus the company style guide; with no matching template the style guide alone is returned — apply it. JSON: {"file_type": "memo"|"SOP"|"letter"|...}.',
    "create_workroom": 'Create a new Workroom (persistent co-work space: goal + pinned artifacts + dedicated conversation + journal). Use when the user asks to set up a room/workspace for an ongoing effort. JSON: {"title": str, "goal"?: str}. Then pin items with add_to_workroom.',
    "add_to_workroom": 'Pin an artifact to a Workroom (persistent co-work space) so it is carried into every future turn there. JSON: {"kind": "drive_doc"|"kb_doc"|"generated_file"|"note"|"email_thread"|"task"|"odoo_record"|"regulatory_doc"|"budget"|"website", "label": str, "ref_id"?: str, "workroom_title"?: str (omit inside a room conversation)}. Use "website" for a source worth returning to — URL in ref_id, what it is in label. Keep a "note" to one or two sentences (600 chars max); pin research as source websites plus short notes, never one long note. For "budget" pass the budget title as label — Gerry\'s writes to a pinned budget auto-journal in the room.',
    "remove_from_workroom": 'Unpin an item from a Workroom by label or ref_id (ambiguous matches are listed). JSON: {"label": str, "workroom_title"?: str (omit inside a room conversation)}.',
    "update_workroom": 'Update a Workroom\'s goal or title, or archive/reactivate it. Archive only when the user asks. JSON: {"goal"?: str, "new_title"?: str, "status"?: "active"|"archived", "workroom_title"?: str (omit inside a room conversation)}.',
    "read_odoo": 'READ the connected Odoo ERP (read-only, no approval): bank_balances, customers, sales, invoices, products, leads, purchases, manufacturing, employees. JSON: {"dataset": str, "search"?: str (name filter), "limit"?: int (default 20)}. For writes use propose_odoo_write.',
    "list_budgets": "List the user's personal budgets (Manage Budgets page): title, spent, allotment, remaining, and whether Gerry may write entries. Personal aids — NOT the company books. No arguments.",
    "read_budget": 'Read one budget in full: summary, per-category spend, ledger entries (the Google Sheet on the user\'s Drive is re-checked first). Always allowed (read-only). JSON: {"title"?: str (fuzzy; omit if the user has exactly one budget)}.',
    "create_budget": 'Create a personal budget: a standardized Google Sheet in the company\'s shared budgets folder on Drive + a Manage Budgets card. Self-serve, no approval. Gerry\'s entry-write permission stays OFF until the user enables it on the budget\'s page. JSON: {"title": str, "allotment"?: number, "categories"?: [str]}.',
    "add_budget_entry": 'Append a spending entry to a budget ledger (written into the Google Sheet, Source=gerry). REQUIRES the per-budget \'Let Gerry manage entries\' permission — if off, point the user to the toggle on the Manage Budgets page. JSON: {"description": str, "amount": number, "date"?: "YYYY-MM-DD" (default today), "category"?: str, "note"?: str, "budget_title"?: str}.',
    "update_budget_entry": 'Change one existing ledger entry, identified by description (match_amount/match_date disambiguate). Requires the per-budget permission PLUS confirm=true after the user explicitly confirmed the exact change. The sheet row is re-read first — never clobbers Sheets-side edits. JSON: {"description": str, "match_amount"?: number, "match_date"?: str, "new_description"?: str, "new_amount"?: number, "new_date"?: str, "new_category"?: str, "new_note"?: str, "budget_title"?: str, "confirm": true}.',
    "remove_budget_entry": 'Delete ONE ledger entry by description (match_amount/match_date disambiguate; ambiguous matches are listed, nothing deleted). Requires the per-budget permission PLUS confirm=true after the user explicitly confirmed THIS deletion. JSON: {"description": str, "match_amount"?: number, "match_date"?: str, "budget_title"?: str, "confirm": true}.',
    "get_budget_snapshot": 'Instant "how much is left on X?" — one-line spent/allotment/remaining per budget from the cached mirror (no sheet calls). For the full ledger or a guaranteed-fresh read use read_budget. JSON: {"title"?: str (fuzzy; omit for all budgets)}.',
    "file_invoice_from_email": 'File an invoice attachment from a Gmail message into the company\'s "<Company> Invoices" Drive folder (the invoice sheet\'s daily 9am pipeline ingests it — OCR, sheet row, budget totals). Bytes preserved exactly; company folder matched from sender/company arg, NEVER created (new companies need the sheet\'s PMI Control Panel). Never writes to the invoice workbook. May follow up with an accept/dismiss budget-entry suggestion. JSON: {"message_id": str (from search_gmail), "company"?: str, "attachment_filename"?: str (when several)}.',
    "compare_budget_to_odoo": 'ADVISORY side-by-side of a personal budget\'s tracked spending vs Odoo ERP actuals matching a search term. Read-only, no approval; present as a cross-check, never a reconciliation. JSON: {"budget_title"?: str (fuzzy), "dataset"?: "invoices"(default: accounting moves incl. vendor bills)|"purchases"|"sales", "search"?: str (defaults to the budget title)}.',
    "create_email_draft": 'Draft an email into Communications → Email Drafts for the user to review and send — never sends anything. You write the full body yourself. JSON: {"subject": str, "body": str (full email, real line breaks, simple sign-off — no signature block), "recipient_email"?: str, "recipient_name"?: str, "cc"?: str (comma-separated addresses), "bcc"?: str, "purpose"?: str, "tone"?: "professional"|"friendly"|"formal"|"concise"|"empathetic"|"persuasive", "attachments"?: [str] (Generated Files filenames — create the file FIRST with create_docx/generate_file), "drive_attachments"?: [str] (Drive file ids/URLs attached AS-IS — current state snapshotted immediately, original never modified; native Google docs export to .docx/.xlsx/.pptx)}.',
    "list_workroom_items": 'List a Workroom\'s goal, pinned artifacts, and recent journal entries. JSON: {"workroom_title"?: str} — omit inside a room conversation; with no match the active room titles are listed.',
    "log_workroom_progress": 'Append a one-sentence DATED progress entry to a Workroom\'s journal (events, not facts — for durable facts/decisions pin a "note" with add_to_workroom). JSON: {"entry": str, "workroom_title"?: str (omit inside a room conversation)}.',
    "get_calendar_events": "Fetch upcoming Google Calendar events within a date range.",
    "list_meetings": 'List the user\'s recent meeting notes — transcripts Little Gerry captured live from the computer\'s meeting audio, plus imported recordings and pasted notes. Returns titles, dates, attendees and whether each is summarised. JSON: {"limit"?: int (1-25, default 10)}.',
    "search_meetings": 'Search meeting notes and transcripts by keyword — what was said or decided about a topic, or who said it. Searches titles, summaries and full transcript text. JSON: {"query": str, "limit"?: int (1-15, default 5)}.',
    "read_meeting": 'Read one meeting note in full: summary, decisions, action items, next steps, attendees and transcript. JSON: {"meeting_id"?: str (UUID, preferred), "query"?: str (title/keyword), "include_transcript"?: bool (default true)}.',
    "search_contacts": "Look up a person's contact details by name, email, or company — searches PMI's own contacts (derived from email + manual entries) and Google Contacts. Good for 'who is our contact at <company>'.",
    "add_contacts": 'Add or update one or more contacts on PMI\'s own Contacts page (not Odoo, not Google). JSON: {"contacts": [{"email": str (required), "name": str, "company": str, "notes": str}, ...]}.',
    "read_google_sheet": "Read values from a Google Sheets spreadsheet.",
    "list_google_tasks": "List tasks from Google Tasks.",
    "generate_file": "Generate and export a document (PDF/DOCX/TXT) from provided content.",
    "create_docx": 'Create a Word (.docx) document from lightweight Markdown. Pipe tables: with a "| --- |" separator after row 1 the first row is a colored header; without it the table is a label/value grid (label columns accent-filled, bold white). JSON: {"filename", "title", "content"}; optional layout from the company template/style guide: "font", "font_size", "header_left", "header_right", "footer_left" (Page X of Y auto), "accent_color" (hex), "cover_logo" (bool — PMI Spaceman Black logo centred on page 1), and a cover banner via "banner_label"/"banner_title"/"banner_subtitle" (do not repeat the title in content).',
    "create_deck": 'Build a slide deck in the company house style (pitch deck, product briefing, demo deck, board update) and upload it to Drive as native Google Slides. Call list_deck_archetypes FIRST — each slide picks an "archetype" (a layout named for its structure, not its business purpose) and only that archetype\'s fields render. ALWAYS ASK THE USER for the security classification, never guess it: "open" (no mark), "confidential_internal", "confidential_proprietary" or "confidential_trade_secret" — it is stamped on every slide. Split headlines in two: "headline" is white, "headline_accent" follows in the accent colour. JSON: {"filename", "classification", "slides": [{"archetype", ...fields}], "upload"?: bool}.',
    "list_deck_archetypes": "List the slide layouts create_deck understands and the exact fields each one accepts. Call before building a deck.",
    "read_deck": 'Read a Google Slides deck: title, slide count, and every shape\'s text with the object id needed to change it. Read before editing, then edit with edit_drive_file mode "set_shape" or "delete_slide". JSON: {"file_id"}.',
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
        'List knowledge base documents. JSON fields: {"action": "list"}. '
        "Deletions go through request_kb_deletion (single confirm-gated path)."
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
