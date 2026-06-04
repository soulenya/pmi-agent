"""
Agent tool definitions and implementations.

Tools available to the PMI Executive Assistant:
  - search_knowledge_base  : semantic search over ingested documents
  - create_task            : create a task in the task tracker (auto-approved)
  - request_approval       : create an ApprovalIntent for human review (high-risk actions)
  - get_pending_approvals  : list open approval items for the current user

Each tool has:
  - DEFINITION: the Ollama tool schema (passed in the system message)
  - An async execute_*(ctx, args) function that runs the tool

Tools receive a ToolContext rather than direct DB sessions so the caller
(the agent executor) can inject deps cleanly.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from models.db.enums import MessageRole, TaskPriority, TaskStatus
from models.db.task import Task
from repositories.conversation_repo import ApprovalRepository
from repositories.document_repo import DocumentChunkRepository
from services.embeddings.service import EmbeddingService


# ── Tool context ──────────────────────────────────────────────────────────────

@dataclass
class ToolContext:
    db: AsyncSession
    user_id: uuid.UUID
    conversation_id: uuid.UUID
    embedding_service: EmbeddingService


# ── Tool schema definitions (sent to Ollama) ──────────────────────────────────

TOOL_DEFINITIONS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": (
                "ONLY call this when the user explicitly asks about a specific PMI document, "
                "VACTOR specification, regulatory submission, protocol, or internal company "
                "knowledge that you cannot answer from general knowledge. "
                "Do NOT call for general questions, greetings, or things you already know."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query — a natural language question or topic.",
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Number of results to return (1–10). Default 5.",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": (
                "Create a task in the PMI task tracker. "
                "Use this when the user explicitly asks to create, add, or track a task or action item."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short task title (max 200 chars)."},
                    "description": {"type": "string", "description": "Optional longer description."},
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical"],
                        "description": "Task priority.",
                        "default": "medium",
                    },
                    "due_date": {
                        "type": "string",
                        "description": "Optional ISO 8601 due date, e.g. '2026-06-30'.",
                    },
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_approval",
            "description": (
                "Submit an action for human approval before execution. "
                "MUST be used for any action with real-world consequences: "
                "sending emails, external communications, document modifications, "
                "regulatory submissions, purchases, or anything irreversible."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "intent_type": {
                        "type": "string",
                        "enum": [
                            "send_email",
                            "create_calendar_event",
                            "modify_document",
                            "create_regulatory_submission",
                            "send_message",
                            "delete_record",
                            "external_api_call",
                            "create_task",
                            "update_task",
                        ],
                        "description": "Type of action being requested.",
                    },
                    "title": {"type": "string", "description": "One-line summary of the action."},
                    "description": {
                        "type": "string",
                        "description": "Full description of what will happen if approved.",
                    },
                    "risk_level": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical"],
                        "description": "Assessed risk level of the action.",
                        "default": "medium",
                    },
                    "payload": {
                        "type": "object",
                        "description": "Structured data for the action (e.g. email body, recipient).",
                    },
                    "expires_hours": {
                        "type": "integer",
                        "description": "Hours until this approval request expires (default 72).",
                        "default": 72,
                    },
                },
                "required": ["intent_type", "title", "description", "payload"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pending_approvals",
            "description": "Retrieve a list of pending approval requests awaiting human decision.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tasks",
            "description": (
                "Query the PMI task tracker to list tasks for the current user. "
                "Use this to answer questions about what tasks are open, overdue, or due soon."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled", "all"],
                        "description": "Filter by task status. 'all' returns every status.",
                        "default": "all",
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical", "any"],
                        "description": "Filter by priority. 'any' skips priority filtering.",
                        "default": "any",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_regulatory_status",
            "description": (
                "Retrieve the current regulatory compliance status for VACTOR: "
                "regulatory document counts by status, open/in-progress CAPAs, "
                "and any documents past their review date. "
                "Use for questions about compliance posture, audit readiness, or CAPA status."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": (
                "Search the internet using DuckDuckGo for current information, news, "
                "ONLY call this when the user explicitly asks to search the internet or look up "
                "current information online. Do NOT call for questions you can answer directly. "
                "Always cite the URLs you reference."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The web search query.",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Number of results to return (1–10). Default 5.",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_page",
            "description": (
                "Fetch and read the text content of a specific web page URL. "
                "Use this to read the full content of a search result or any public URL."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The full URL to fetch.",
                    },
                },
                "required": ["url"],
            },
        },
    },
    # ── Google Workspace tools (read-only — only call when user explicitly asks) ─
    {
        "type": "function",
        "function": {
            "name": "search_gmail",
            "description": (
                "ONLY call this when the user explicitly asks to search, check, or find emails "
                "in their Gmail inbox. Do NOT call for general conversation or greetings. "
                "Uses Gmail search syntax (e.g. 'from:alice subject:VACTOR is:unread')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Gmail search query string.",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Max emails to return (1–20). Default 10.",
                        "default": 10,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_gmail_message",
            "description": (
                "Read the full body of a Gmail message by its ID. "
                "Only call after search_gmail has returned results and the user wants to read a specific email."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "message_id": {
                        "type": "string",
                        "description": "The Gmail message ID (from search_gmail results).",
                    },
                },
                "required": ["message_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_drive",
            "description": (
                "ONLY call this when the user explicitly asks to find or search for files "
                "in their Google Drive. Do NOT call for general conversation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Text to search for across file names and content.",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Max files to return (1–20). Default 10.",
                        "default": 10,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_drive_file",
            "description": (
                "Read the text content of a Google Drive file by its ID. "
                "Only call when the user explicitly asks to open or read a specific Drive file. "
                "Works for Docs, Sheets (as CSV), Slides, and plain text files."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "string",
                        "description": "The Google Drive file ID (from search_drive results).",
                    },
                },
                "required": ["file_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_calendar_events",
            "description": (
                "ONLY call this when the user explicitly asks to check their calendar, "
                "see upcoming meetings, or asks what is scheduled. "
                "Do NOT call proactively or for general greetings."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days_behind": {
                        "type": "integer",
                        "description": "Days before today to include (default 0).",
                        "default": 0,
                    },
                    "days_ahead": {
                        "type": "integer",
                        "description": "Days ahead to include (default 7).",
                        "default": 7,
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_contacts",
            "description": (
                "ONLY call this when the user explicitly asks to look up a person's "
                "contact details (email, phone, company) in Google Contacts."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Name, email address, or company to search for.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_google_sheet",
            "description": (
                "ONLY call this when the user explicitly provides a spreadsheet ID or asks "
                "to read data from a specific Google Sheet. "
                "Requires a spreadsheet ID (found in the URL between /d/ and /edit)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "spreadsheet_id": {
                        "type": "string",
                        "description": "The Google Sheets spreadsheet ID (from the URL between /d/ and /edit).",
                    },
                    "range": {
                        "type": "string",
                        "description": "Cell range to read, e.g. 'Sheet1' or 'Sheet1!A1:Z100'. Default 'Sheet1'.",
                        "default": "Sheet1",
                    },
                },
                "required": ["spreadsheet_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_google_tasks",
            "description": (
                "ONLY call this when the user explicitly asks to see their Google Tasks "
                "or tasks from Google Workspace. Do NOT call for PMI internal tasks — "
                "use get_tasks for those."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "max_results": {
                        "type": "integer",
                        "description": "Max tasks to return per list (default 25).",
                        "default": 25,
                    },
                },
                "required": [],
            },
        },
    },
]


# ── Tool implementations ───────────────────────────────────────────────────────

async def execute_search_knowledge_base(ctx: ToolContext, args: dict[str, Any]) -> str:
    query = str(args.get("query", "")).strip()
    top_k = min(int(args.get("top_k", 5)), 10)

    if not query:
        return "Error: query must not be empty."

    try:
        embedding = await ctx.embedding_service.embed(query)
    except Exception as exc:
        return f"Knowledge base search unavailable: {exc}"

    chunk_repo = DocumentChunkRepository(ctx.db)
    results = await chunk_repo.vector_search(embedding, top_k=top_k)

    if not results:
        return "No relevant documents found for that query."

    # Fetch document titles for the returned chunks
    from sqlalchemy import select
    from models.db.document import Document

    doc_ids = list({chunk.document_id for chunk, _ in results})
    doc_rows = await ctx.db.execute(
        select(Document.id, Document.title).where(Document.id.in_(doc_ids))
    )
    doc_title_map = {row.id: row.title for row in doc_rows}

    lines = [f"Found {len(results)} relevant document chunk(s):\n"]
    for i, (chunk, similarity) in enumerate(results, 1):
        title = doc_title_map.get(chunk.document_id, "Unknown document")
        score_pct = round(similarity * 100, 1)
        lines.append(
            f"[{i}] \"{title}\" "
            f"(chunk {chunk.chunk_index}, page {chunk.page_number}, score {score_pct}%)\n"
            f"{chunk.content[:600]}"
            + ("..." if len(chunk.content) > 600 else "")
        )
    return "\n\n".join(lines)


async def execute_create_task(ctx: ToolContext, args: dict[str, Any]) -> str:
    title = str(args.get("title", "")).strip()[:500]
    if not title:
        return "Error: task title must not be empty."

    description = args.get("description")
    priority_raw = str(args.get("priority", "medium")).lower()
    priority = priority_raw if priority_raw in ("low", "medium", "high", "critical") else "medium"

    due_date: datetime | None = None
    if raw_due := args.get("due_date"):
        try:
            due_date = datetime.fromisoformat(str(raw_due)).replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    task = Task(
        title=title,
        description=description,
        status=TaskStatus.TODO,
        priority=TaskPriority(priority),
        due_date=due_date,
        source_conversation_id=ctx.conversation_id,
        created_by=ctx.user_id,
        assignee_id=ctx.user_id,
    )
    ctx.db.add(task)
    await ctx.db.flush()
    await ctx.db.refresh(task)

    due_str = f", due {due_date.date()}" if due_date else ""
    return (
        f"Task created: \"{task.title}\" "
        f"[priority={priority}{due_str}, id={task.id}]"
    )


async def execute_request_approval(ctx: ToolContext, args: dict[str, Any]) -> str:
    intent_type = str(args.get("intent_type", "external_api_call"))
    title = str(args.get("title", "")).strip()[:500]
    description = str(args.get("description", "")).strip()
    risk_level = str(args.get("risk_level", "medium")).lower()
    payload = args.get("payload", {})
    expires_hours = min(int(args.get("expires_hours", 72)), 720)

    if not title:
        return "Error: approval title must not be empty."

    expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_hours)

    repo = ApprovalRepository(ctx.db)
    intent = await repo.create(
        user_id=ctx.user_id,
        intent_type=intent_type,
        intent_title=title,
        intent_description=description,
        intent_payload=payload if isinstance(payload, dict) else {"data": payload},
        risk_level=risk_level,
        expires_at=expires_at,
    )

    return (
        f"Approval request submitted: \"{title}\" "
        f"[risk={risk_level}, id={intent.id}, expires in {expires_hours}h]. "
        "Waiting for human review before this action can proceed."
    )


async def execute_get_pending_approvals(ctx: ToolContext, _args: dict[str, Any]) -> str:
    repo = ApprovalRepository(ctx.db)
    items = await repo.list_pending(ctx.user_id, limit=10)
    if not items:
        return "No pending approvals."
    lines = [f"Pending approvals ({len(items)}):"]
    for item in items:
        lines.append(
            f"- [{item.risk_level.upper()}] \"{item.intent_title}\" "
            f"(type={item.intent_type}, id={item.id})"
        )
    return "\n".join(lines)


async def execute_get_tasks(ctx: ToolContext, args: dict[str, Any]) -> str:
    from sqlalchemy import select
    from models.db.task import Task
    from models.db.enums import TaskStatus

    status_filter = str(args.get("status", "all"))
    priority_filter = str(args.get("priority", "any"))

    stmt = select(Task).where(
        (Task.created_by == ctx.user_id) | (Task.assignee_id == ctx.user_id)
    )
    if status_filter != "all":
        stmt = stmt.where(Task.status == status_filter)
    if priority_filter != "any":
        stmt = stmt.where(Task.priority == priority_filter)
    stmt = stmt.order_by(Task.due_date.asc().nullslast(), Task.created_at.desc()).limit(30)

    result = await ctx.db.execute(stmt)
    tasks = list(result.scalars())

    if not tasks:
        return "No tasks found matching that filter."

    now = datetime.now(timezone.utc)
    lines = [f"Tasks ({len(tasks)} found):"]
    for t in tasks:
        due_str = ""
        if t.due_date:
            is_overdue = t.due_date < now and t.status not in (TaskStatus.DONE, TaskStatus.CANCELLED)
            due_str = f", due {t.due_date.date()}" + (" [OVERDUE]" if is_overdue else "")
        lines.append(
            f"- [{t.status.upper()}][{t.priority}] {t.title}{due_str}"
        )
    return "\n".join(lines)


async def execute_get_regulatory_status(ctx: ToolContext, _args: dict[str, Any]) -> str:
    from sqlalchemy import func, select
    from models.db.regulatory import RegulatoryDocument
    from models.db.enums import RegDocStatus
    from repositories.regulatory_repo import CAPARepository, RegulatoryDocRepository

    reg_repo = RegulatoryDocRepository(ctx.db)
    capa_repo = CAPARepository(ctx.db)

    all_docs = await reg_repo.list()
    all_capas = await capa_repo.list()

    # Doc counts by status
    status_counts: dict[str, int] = {}
    for doc in all_docs:
        status_counts[doc.status] = status_counts.get(doc.status, 0) + 1

    # Overdue reviews
    from datetime import date
    today = date.today()
    overdue_reviews = [
        d for d in all_docs
        if d.next_review_date and d.next_review_date < today
        and d.status not in ("superseded",)
    ]

    # Open CAPAs
    open_capas = [c for c in all_capas if c.status in ("open", "in_progress")]

    lines = ["VACTOR Regulatory Compliance Status\n"]
    lines.append(f"Total documents: {len(all_docs)}")
    for s, n in sorted(status_counts.items()):
        lines.append(f"  {s}: {n}")

    if overdue_reviews:
        lines.append(f"\nDocuments past review date ({len(overdue_reviews)}):")
        for d in overdue_reviews[:5]:
            lines.append(f"  - {d.title} (rev {d.revision}, review was due {d.next_review_date})")

    lines.append(f"\nCAPAs: {len(all_capas)} total, {len(open_capas)} open/in-progress")
    for c in open_capas[:5]:
        due = f", due {c.due_date}" if getattr(c, "due_date", None) else ""
        lines.append(f"  - [{c.status.upper()}] {c.capa_number}: {c.title}{due}")

    return "\n".join(lines)


async def execute_search_web(ctx: ToolContext, args: dict[str, Any]) -> str:
    from services.research.searcher import web_search

    query = str(args.get("query", "")).strip()
    if not query:
        return "Error: query must not be empty."
    max_results = min(int(args.get("max_results", 5)), 10)

    results = await web_search(query, max_results=max_results)
    if not results:
        return f"No web search results found for: {query}"

    lines = [f"Web search results for \"{query}\" ({len(results)} found):\n"]
    for i, r in enumerate(results, 1):
        lines.append(
            f"[{i}] {r['title']}\n"
            f"    URL: {r['url']}\n"
            f"    {r['snippet']}"
        )
    return "\n\n".join(lines)


async def execute_fetch_page(ctx: ToolContext, args: dict[str, Any]) -> str:
    from services.research.searcher import fetch_page_text

    url = str(args.get("url", "")).strip()
    if not url or not url.startswith("http"):
        return "Error: a valid http/https URL is required."

    text = await fetch_page_text(url, max_chars=4000)
    if not text:
        return f"Could not fetch content from {url} (network error or empty page)."
    return f"Content from {url}:\n\n{text}"


# ── Google Workspace tool executors ───────────────────────────────────────────

def _google_not_connected() -> str:
    return (
        "Google account is not connected. "
        "Ask the user to connect Google via Settings → Google Integration."
    )


async def execute_search_gmail(ctx: ToolContext, args: dict[str, Any]) -> str:
    import asyncio
    from services.google_service import gmail_search, get_credentials
    if not get_credentials():
        return _google_not_connected()
    query = str(args.get("query", "")).strip()
    if not query:
        return "Error: query must not be empty."
    max_results = min(int(args.get("max_results", 10)), 20)
    try:
        msgs = await asyncio.get_event_loop().run_in_executor(
            None, lambda: gmail_search(query, max_results)
        )
    except Exception as exc:
        return f"Gmail search failed: {exc}"
    if not msgs:
        return f"No emails found matching: {query}"
    lines = [f"Gmail results for '{query}' ({len(msgs)} found):\n"]
    for m in msgs:
        lines.append(
            f"ID: {m['id']}\n"
            f"From: {m['from']}\nTo: {m['to']}\n"
            f"Subject: {m['subject']}\nDate: {m['date']}\n"
            f"Snippet: {m['snippet']}"
        )
    return "\n\n".join(lines)


async def execute_read_gmail_message(ctx: ToolContext, args: dict[str, Any]) -> str:
    import asyncio
    from services.google_service import gmail_get_message, get_credentials
    if not get_credentials():
        return _google_not_connected()
    message_id = str(args.get("message_id", "")).strip()
    if not message_id:
        return "Error: message_id is required."
    try:
        msg = await asyncio.get_event_loop().run_in_executor(
            None, lambda: gmail_get_message(message_id)
        )
    except Exception as exc:
        return f"Failed to read email: {exc}"
    return (
        f"From: {msg['from']}\nTo: {msg['to']}\n"
        f"Subject: {msg['subject']}\nDate: {msg['date']}\n\n"
        f"{msg['body'][:6000]}"
    )


async def execute_search_drive(ctx: ToolContext, args: dict[str, Any]) -> str:
    import asyncio
    from services.google_service import drive_search, get_credentials
    if not get_credentials():
        return _google_not_connected()
    query = str(args.get("query", "")).strip()
    if not query:
        return "Error: query must not be empty."
    max_results = min(int(args.get("max_results", 10)), 20)
    try:
        files = await asyncio.get_event_loop().run_in_executor(
            None, lambda: drive_search(query, max_results)
        )
    except Exception as exc:
        return f"Drive search failed: {exc}"
    if not files:
        return f"No Drive files found for: {query}"
    lines = [f"Drive files for '{query}' ({len(files)} found):\n"]
    for f in files:
        lines.append(
            f"ID: {f['id']}\nName: {f['name']}\nType: {f['type']}\n"
            f"Modified: {f['modified']}\nURL: {f['url']}"
        )
    return "\n\n".join(lines)


async def execute_read_drive_file(ctx: ToolContext, args: dict[str, Any]) -> str:
    import asyncio
    from services.google_service import drive_get_content, get_credentials
    if not get_credentials():
        return _google_not_connected()
    file_id = str(args.get("file_id", "")).strip()
    if not file_id:
        return "Error: file_id is required."
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: drive_get_content(file_id)
        )
    except Exception as exc:
        return f"Failed to read Drive file: {exc}"
    content = result.get("content", "")
    if not content:
        return f"File '{result.get('name', file_id)}' has no readable text content."
    return (
        f"File: {result['name']}\nType: {result['type']}\nURL: {result['url']}\n\n"
        f"{content[:8000]}"
    )


async def execute_get_calendar_events(ctx: ToolContext, args: dict[str, Any]) -> str:
    import asyncio
    from services.google_service import calendar_events, get_credentials
    if not get_credentials():
        return _google_not_connected()
    days_behind = int(args.get("days_behind", 0))
    days_ahead = int(args.get("days_ahead", 7))
    try:
        events = await asyncio.get_event_loop().run_in_executor(
            None, lambda: calendar_events(days_behind, days_ahead)
        )
    except Exception as exc:
        return f"Calendar fetch failed: {exc}"
    if not events:
        return f"No calendar events in the next {days_ahead} day(s)."
    lines = [f"Calendar events ({len(events)} found):\n"]
    for e in events:
        attendee_str = ", ".join(e["attendees"]) if e["attendees"] else ""
        lines.append(
            f"• {e['title']}\n"
            f"  Start: {e['start']}  End: {e['end']}\n"
            + (f"  Location: {e['location']}\n" if e["location"] else "")
            + (f"  Attendees: {attendee_str}\n" if attendee_str else "")
            + (f"  {e['description']}\n" if e["description"] else "")
            + f"  URL: {e['url']}"
        )
    return "\n\n".join(lines)


async def execute_search_contacts(ctx: ToolContext, args: dict[str, Any]) -> str:
    import asyncio
    from services.google_service import contacts_search, get_credentials
    if not get_credentials():
        return _google_not_connected()
    query = str(args.get("query", "")).strip()
    if not query:
        return "Error: query must not be empty."
    try:
        contacts = await asyncio.get_event_loop().run_in_executor(
            None, lambda: contacts_search(query, 10)
        )
    except Exception as exc:
        return f"Contacts search failed: {exc}"
    if not contacts:
        return f"No contacts found for: {query}"
    lines = [f"Contacts matching '{query}':\n"]
    for c in contacts:
        lines.append(
            f"Name: {c['name']}\nEmail: {c['email']}\n"
            f"Phone: {c['phone']}\nCompany: {c['company']}"
        )
    return "\n\n".join(lines)


async def execute_read_google_sheet(ctx: ToolContext, args: dict[str, Any]) -> str:
    import asyncio
    from services.google_service import sheets_read, get_credentials
    if not get_credentials():
        return _google_not_connected()
    spreadsheet_id = str(args.get("spreadsheet_id", "")).strip()
    if not spreadsheet_id:
        return "Error: spreadsheet_id is required."
    range_ = str(args.get("range", "Sheet1")).strip() or "Sheet1"
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: sheets_read(spreadsheet_id, range_)
        )
    except Exception as exc:
        return f"Failed to read spreadsheet: {exc}"
    rows = result.get("rows", [])
    if not rows:
        return f"Spreadsheet range '{range_}' is empty."
    # Format as a simple table
    lines = [f"Sheet data ({result['row_count']} rows, range: {result['range']}):\n"]
    for row in rows[:100]:  # cap at 100 rows
        lines.append("\t".join(str(cell) for cell in row))
    if result["row_count"] > 100:
        lines.append(f"... ({result['row_count'] - 100} more rows)")
    return "\n".join(lines)


async def execute_list_google_tasks(ctx: ToolContext, args: dict[str, Any]) -> str:
    import asyncio
    from services.google_service import tasks_list, get_credentials
    if not get_credentials():
        return _google_not_connected()
    max_results = min(int(args.get("max_results", 25)), 50)
    try:
        tasks = await asyncio.get_event_loop().run_in_executor(
            None, lambda: tasks_list(max_results)
        )
    except Exception as exc:
        return f"Failed to fetch Google Tasks: {exc}"
    if not tasks:
        return "No incomplete Google Tasks found."
    lines = [f"Google Tasks ({len(tasks)} incomplete):\n"]
    for t in tasks:
        due_str = f", due {t['due'][:10]}" if t.get("due") else ""
        notes_str = f"\n  Notes: {t['notes']}" if t.get("notes") else ""
        lines.append(f"• [{t['list']}] {t['title']}{due_str}{notes_str}")
    return "\n".join(lines)


# ── Dispatcher ────────────────────────────────────────────────────────────────

TOOL_EXECUTORS = {
    "search_knowledge_base": execute_search_knowledge_base,
    "create_task": execute_create_task,
    "request_approval": execute_request_approval,
    "get_pending_approvals": execute_get_pending_approvals,
    "get_tasks": execute_get_tasks,
    "get_regulatory_status": execute_get_regulatory_status,
    "search_web": execute_search_web,
    "fetch_page": execute_fetch_page,
    # Google Workspace (read-only)
    "search_gmail": execute_search_gmail,
    "read_gmail_message": execute_read_gmail_message,
    "search_drive": execute_search_drive,
    "read_drive_file": execute_read_drive_file,
    "get_calendar_events": execute_get_calendar_events,
    "search_contacts": execute_search_contacts,
    "read_google_sheet": execute_read_google_sheet,
    "list_google_tasks": execute_list_google_tasks,
}


async def dispatch_tool(ctx: ToolContext, name: str, args: dict[str, Any]) -> str:
    """Execute a tool by name and return a string result for the model."""
    executor = TOOL_EXECUTORS.get(name)
    if executor is None:
        return f"Unknown tool: {name}"
    try:
        return await executor(ctx, args)
    except Exception as exc:
        return f"Tool '{name}' failed: {exc}"
