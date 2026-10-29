"""Agent tools for a person's private notes.

``save_note`` keeps what the user asked to remember; ``list_notes`` reads it
back. Both act for ``ctx.user_id`` alone — a routine running as this person
sees this person's notes, and nothing of anyone else's.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from services import notes as svc


async def execute_save_note(ctx: Any, args: dict[str, Any]) -> str:
    content = str(args.get("content") or args.get("input") or "").strip()
    if not content:
        return "Error: there is nothing to note — pass the words to keep in 'content'."
    source = "voice" if bool(args.get("spoken")) else "gerry"
    try:
        row, where = await svc.save_anywhere(
            ctx.db, ctx.user_id, content, source=source, conversation_id=ctx.conversation_id
        )
    except ValueError as exc:
        return f"Error: {exc}"
    await ctx.db.flush()
    stamp = svc._stamp(row.get("created_at"))
    preview = " ".join(content.split())
    if len(preview) > 140:
        preview = preview[:137] + "…"
    tail = "" if where == "hub" else " (kept on this computer)"
    return f"Noted ({stamp}){tail}: {preview}"


async def execute_list_notes(ctx: Any, args: dict[str, Any]) -> str:
    query = str(args.get("query") or "").strip() or None
    limit = int(args.get("limit") or 50)
    limit = max(1, min(limit, 200))
    since = None
    raw_days = args.get("since_days")
    if raw_days is not None and str(raw_days).strip():
        try:
            days = int(raw_days)
            if days > 0:
                since = datetime.now(timezone.utc) - timedelta(days=days)
        except (TypeError, ValueError):
            return "Error: since_days must be a whole number of days."
    rows = await svc.list_anywhere(ctx.db, ctx.user_id, since=since, query=query, limit=limit)
    if not rows:
        scope = []
        if since is not None:
            scope.append(f"in the last {raw_days} day(s)")
        if query:
            scope.append(f'matching "{query}"')
        return "The user has no notes" + (" " + " ".join(scope) if scope else "") + "."
    head = f"{len(rows)} note(s), newest first"
    if since is not None:
        head += f", last {raw_days} day(s)"
    if query:
        head += f', matching "{query}"'
    return f"{head}:\n{svc.render_rows(rows)}"


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "save_note",
            "description": (
                "Keep something the user wants remembered as a private note — theirs "
                "alone, separate from tasks, projects and canvases. Use it the moment they "
                "say 'note that…', 'remember…', 'jot down…', 'make a note…', or dictate a "
                "thought while talking. Save their words as said, lightly tidied; do not "
                "summarise, expand or add your own commentary. Confirm in one short line."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The note, in the user's words.",
                    },
                    "spoken": {
                        "type": "boolean",
                        "description": "True when the user dictated this in voice mode.",
                        "default": False,
                    },
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_notes",
            "description": (
                "Read the user's private notes, newest first. Call it whenever they ask "
                "what they noted, and ALWAYS before writing any status report, weekly "
                "update, summary of their week, or recap — their notes are what they "
                "wanted carried into that. Only this user's notes are ever returned."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "since_days": {
                        "type": "integer",
                        "description": "Only notes from the last N days (e.g. 7 for a weekly update).",
                    },
                    "query": {
                        "type": "string",
                        "description": "Only notes containing this text.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "At most this many (default 50, max 200).",
                    },
                },
                "required": [],
            },
        },
    },
]

TOOL_EXECUTORS = {
    "save_note": execute_save_note,
    "list_notes": execute_list_notes,
}

PRIMARY_ARGS = {
    "save_note": "content",
    "list_notes": "query",
}

RUNNING_LABELS = {
    "save_note": "Writing the note down…",
    "list_notes": "Reading your notes…",
}

TOOL_DOCS = {
    "save_note": (
        "Keep something the user wants remembered as a private note (theirs alone; not a "
        "task, sticky or journal line). Use on 'note that…', 'remember…', 'jot down…'. Save "
        "their words as said. JSON: {\"content\": str, \"spoken\": bool}."
    ),
    "list_notes": (
        "The user's private notes, newest first. Call before any status report, weekly "
        "update or recap, and when asked what they noted. "
        "JSON: {\"since_days\": int optional, \"query\": str optional, \"limit\": int optional}."
    ),
}
