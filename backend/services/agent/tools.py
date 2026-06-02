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
                "Search the PMI knowledge base (uploaded documents) using semantic similarity. "
                "Use this whenever the user asks about PMI documents, VACTOR specs, "
                "regulatory submissions, protocols, or any internal knowledge."
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


# ── Dispatcher ────────────────────────────────────────────────────────────────

TOOL_EXECUTORS = {
    "search_knowledge_base": execute_search_knowledge_base,
    "create_task": execute_create_task,
    "request_approval": execute_request_approval,
    "get_pending_approvals": execute_get_pending_approvals,
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
