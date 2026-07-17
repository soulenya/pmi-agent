"""
Custodian tools for the Little Gerry House Manager agent.

These give the House Manager application-wide read/write reach:
  Read + write : conversations, generated files, tasks, scheduled tasks,
                 knowledge base (list/remove)
  Read only    : settings, users, audit trail, approvals

Hard rules enforced here (not just in the prompt):
  - Settings, users, audit, approvals have NO write executors at all.
  - Destructive actions (delete conversation/file/task/scheduled task/KB doc)
    require args["confirm"] == true, which the agent may only set after the
    user has explicitly confirmed.
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import desc, func, select

if TYPE_CHECKING:
    from services.agent.tools import ToolContext

_CONFIRM_MSG = (
    "CONFIRMATION REQUIRED: this is a destructive action. "
    "Ask the user to explicitly confirm, then call the tool again with \"confirm\": true."
)


def _parse_uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _generated_files_dir() -> Path:
    from services.agent.tools import _GENERATED_FILES_DIR
    return _GENERATED_FILES_DIR


# ── Conversations (read + write) ─────────────────────────────────────────────

async def execute_list_conversations(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.conversation import Conversation, Message

    include_archived = bool(args.get("include_archived", False))
    limit = min(int(args.get("limit", 30) or 30), 100)

    stmt = (
        select(
            Conversation,
            func.count(Message.id).label("message_count"),
        )
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .where(Conversation.user_id == ctx.user_id)
        .group_by(Conversation.id)
        .order_by(desc(Conversation.updated_at))
        .limit(limit)
    )
    if not include_archived:
        stmt = stmt.where(Conversation.is_archived.is_(False))

    rows = (await ctx.db.execute(stmt)).all()
    if not rows:
        return "No conversations found."

    lines = []
    for conv, msg_count in rows:
        flags = []
        if conv.is_pinned:
            flags.append("pinned")
        if conv.is_archived:
            flags.append("archived")
        agent = f" agent={conv.agent_type}" if conv.agent_type else ""
        lines.append(
            f"- {conv.id} | {conv.title or '(untitled)'} | {msg_count} messages"
            f"{agent} | updated {conv.updated_at:%Y-%m-%d}"
            + (f" [{', '.join(flags)}]" if flags else "")
        )
    return f"{len(rows)} conversations:\n" + "\n".join(lines)


async def execute_read_conversation(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.conversation import Conversation, Message

    conv_id = _parse_uuid(args.get("conversation_id"))
    if conv_id is None:
        return "Error: a valid conversation_id is required."
    limit = min(int(args.get("limit", 30) or 30), 100)

    conv = (
        await ctx.db.execute(
            select(Conversation).where(
                Conversation.id == conv_id, Conversation.user_id == ctx.user_id
            )
        )
    ).scalar_one_or_none()
    if conv is None:
        return "Conversation not found."

    msgs = (
        (
            await ctx.db.execute(
                select(Message)
                .where(Message.conversation_id == conv_id)
                .order_by(desc(Message.created_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    msgs = list(reversed(msgs))
    lines = [f"Conversation: {conv.title or '(untitled)'} ({len(msgs)} most recent messages)"]
    for m in msgs:
        role = getattr(m.role, "value", m.role)
        content = (m.content or "").strip()
        if len(content) > 400:
            content = content[:400] + "…"
        lines.append(f"[{role}] {content}")
    return "\n".join(lines)


async def execute_update_conversation(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.conversation import Conversation

    conv_id = _parse_uuid(args.get("conversation_id"))
    if conv_id is None:
        return "Error: a valid conversation_id is required."

    conv = (
        await ctx.db.execute(
            select(Conversation).where(
                Conversation.id == conv_id, Conversation.user_id == ctx.user_id
            )
        )
    ).scalar_one_or_none()
    if conv is None:
        return "Conversation not found."

    action = str(args.get("action", "update")).lower()
    if action == "delete":
        if not args.get("confirm"):
            return _CONFIRM_MSG
        if conv_id == ctx.conversation_id:
            return "Error: cannot delete the conversation we are currently talking in."
        title = conv.title or "(untitled)"
        await ctx.db.delete(conv)
        return f"Deleted conversation '{title}'."

    changed = []
    if args.get("title"):
        conv.title = str(args["title"])[:500]
        changed.append("title")
    if "archived" in args:
        conv.is_archived = bool(args["archived"])
        changed.append("archived" if conv.is_archived else "unarchived")
    if "pinned" in args:
        conv.is_pinned = bool(args["pinned"])
        changed.append("pinned" if conv.is_pinned else "unpinned")
    if not changed:
        return "Nothing to update — provide title, archived, or pinned (or action: delete)."
    return f"Conversation updated ({', '.join(changed)})."


# ── Generated files (read + write) ────────────────────────────────────────────

async def execute_list_generated_files(ctx: "ToolContext", args: dict[str, Any]) -> str:
    d = _generated_files_dir()
    if not d.is_dir():
        return "No generated files yet."
    files = sorted(d.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    files = [f for f in files if f.is_file() and not f.name.startswith(".")]
    if not files:
        return "No generated files yet."
    lines = []
    for f in files[:100]:
        st = f.stat()
        size_kb = st.st_size / 1024
        from datetime import datetime
        mod = datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")
        lines.append(f"- {f.name} | {size_kb:.1f} KB | modified {mod}")
    return f"{len(files)} generated files:\n" + "\n".join(lines)


async def execute_manage_generated_file(ctx: "ToolContext", args: dict[str, Any]) -> str:
    d = _generated_files_dir()
    action = str(args.get("action", "")).lower()
    filename = str(args.get("filename", "")).strip()
    if not filename or "/" in filename or "\\" in filename or filename.startswith(".."):
        return "Error: a valid filename (no paths) is required."

    path = (d / filename).resolve()
    if not str(path).startswith(str(d.resolve())) or not path.is_file():
        return f"Error: file '{filename}' not found. Use list_generated_files to see exact names."

    if action == "delete":
        if not args.get("confirm"):
            return _CONFIRM_MSG
        path.unlink()
        return f"Deleted generated file '{filename}'."

    if action == "rename":
        new_name = re.sub(r"[^\w.\- ]", "_", str(args.get("new_name", "")).strip())
        if not new_name:
            return "Error: new_name is required for rename."
        # Preserve the internal 8-hex id prefix if present
        m = re.match(r"^([0-9a-f]{8}_)", filename)
        prefix = m.group(1) if m else ""
        target = (d / f"{prefix}{new_name}").resolve()
        if not str(target).startswith(str(d.resolve())):
            return "Error: invalid new name."
        if target.exists():
            return f"Error: a file named '{target.name}' already exists."
        path.rename(target)
        return f"Renamed '{filename}' to '{target.name}'."

    return "Error: action must be 'rename' or 'delete'."


# ── Tasks (read + write; create/get already exist as tools) ──────────────────

async def execute_update_task(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.enums import TaskPriority, TaskStatus
    from models.db.task import Task

    task_id = _parse_uuid(args.get("task_id"))
    if task_id is None:
        return "Error: a valid task_id is required. Use get_tasks to find task IDs."

    task = (
        await ctx.db.execute(select(Task).where(Task.id == task_id))
    ).scalar_one_or_none()
    if task is None:
        return "Task not found."

    if str(args.get("action", "")).lower() == "delete":
        if not args.get("confirm"):
            return _CONFIRM_MSG
        await ctx.db.delete(task)
        return f"Deleted task '{task.title}'."

    changed = []
    if args.get("title"):
        task.title = str(args["title"])[:200]
        changed.append("title")
    if args.get("description") is not None and "description" in args:
        task.description = str(args["description"])
        changed.append("description")
    if args.get("status"):
        try:
            task.status = TaskStatus(str(args["status"]).lower())
            changed.append(f"status={task.status.value}")
        except ValueError:
            return f"Error: invalid status '{args['status']}'."
    if args.get("priority"):
        try:
            task.priority = TaskPriority(str(args["priority"]).lower())
            changed.append(f"priority={task.priority.value}")
        except ValueError:
            return f"Error: invalid priority '{args['priority']}'."
    if not changed:
        return "Nothing to update — provide title, description, status, or priority."
    return f"Task '{task.title}' updated ({', '.join(changed)})."


# ── Scheduled tasks (read + write) ────────────────────────────────────────────

async def execute_list_scheduled_tasks(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.scheduled_task import ScheduledTask

    tasks = (
        (
            await ctx.db.execute(
                select(ScheduledTask)
                .where(ScheduledTask.user_id == ctx.user_id)
                .order_by(ScheduledTask.created_at)
            )
        )
        .scalars()
        .all()
    )
    if not tasks:
        return "No scheduled tasks."
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    lines = []
    for t in tasks:
        if t.frequency == "weekly" and t.day_of_week is not None:
            when = f"weekly on {days[t.day_of_week]}"
        elif t.frequency == "monthly" and t.day_of_month is not None:
            when = f"monthly on day {t.day_of_month}"
        else:
            when = t.frequency
        when += f" at {t.hour:02d}:{t.minute:02d}"
        next_run = f", next run {t.next_run_at:%Y-%m-%d %H:%M}" if t.next_run_at else ""
        lines.append(
            f"- {t.id} | {t.title} | {when} | "
            f"{'enabled' if t.enabled else 'DISABLED'} | "
            f"last run: {t.last_run_status or 'never'} ({t.run_count} runs){next_run}"
        )
    return f"{len(tasks)} scheduled tasks:\n" + "\n".join(lines)


async def execute_manage_scheduled_task(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.scheduled_task import ScheduledTask
    from services.scheduler.runner import compute_next_run

    action = str(args.get("action", "")).lower()

    if action == "create":
        title = str(args.get("title", "")).strip()
        prompt = str(args.get("prompt", "")).strip()
        frequency = str(args.get("frequency", "weekly")).lower()
        if not title or not prompt:
            return "Error: title and prompt are required to create a scheduled task."
        if frequency not in ("daily", "weekly", "monthly"):
            return "Error: frequency must be daily, weekly, or monthly."
        task = ScheduledTask(
            user_id=ctx.user_id,
            title=title[:255],
            prompt=prompt,
            frequency=frequency,
            day_of_week=int(args["day_of_week"]) if args.get("day_of_week") is not None else None,
            day_of_month=int(args["day_of_month"]) if args.get("day_of_month") is not None else None,
            hour=int(args.get("hour", 8)),
            minute=int(args.get("minute", 0)),
            enabled=True,
        )
        # Created from inside a workroom conversation → standing ROOM task:
        # runs post into the room chat and journal automatically.
        room_note = ""
        try:
            from services.workroom_context import get_workroom_for_conversation

            room = await get_workroom_for_conversation(ctx.db, ctx.conversation_id)
            if room is not None:
                task.workroom_id = room.id
                room_note = f' (standing task in workroom "{room.title}")'
        except Exception:  # noqa: BLE001 — room binding is best-effort
            pass
        task.next_run_at = compute_next_run(
            frequency=task.frequency,
            hour=task.hour,
            minute=task.minute,
            day_of_week=task.day_of_week,
            day_of_month=task.day_of_month,
        )
        ctx.db.add(task)
        return (
            f"Scheduled task '{task.title}' created ({frequency}, next run "
            f"{task.next_run_at:%Y-%m-%d %H:%M}){room_note}."
        )

    task_id = _parse_uuid(args.get("task_id"))
    if task_id is None:
        return "Error: a valid task_id is required (or action: create). Use list_scheduled_tasks for IDs."

    task = (
        await ctx.db.execute(
            select(ScheduledTask).where(
                ScheduledTask.id == task_id, ScheduledTask.user_id == ctx.user_id
            )
        )
    ).scalar_one_or_none()
    if task is None:
        return "Scheduled task not found."

    if action == "delete":
        if not args.get("confirm"):
            return _CONFIRM_MSG
        await ctx.db.delete(task)
        return f"Deleted scheduled task '{task.title}'."

    if action == "disable":
        if not args.get("confirm"):
            return _CONFIRM_MSG
        task.enabled = False
        return f"Scheduled task '{task.title}' disabled."

    if action == "enable":
        task.enabled = True
        task.next_run_at = compute_next_run(
            task.frequency, task.day_of_week, task.day_of_month, task.hour, task.minute
        )
        return f"Scheduled task '{task.title}' enabled (next run {task.next_run_at:%Y-%m-%d %H:%M})."

    if action == "update":
        changed = []
        if args.get("title"):
            task.title = str(args["title"])[:255]
            changed.append("title")
        if args.get("prompt"):
            task.prompt = str(args["prompt"])
            changed.append("prompt")
        if args.get("frequency"):
            freq = str(args["frequency"]).lower()
            if freq not in ("daily", "weekly", "monthly"):
                return "Error: frequency must be daily, weekly, or monthly."
            task.frequency = freq
            changed.append(f"frequency={freq}")
        for field in ("day_of_week", "day_of_month", "hour", "minute"):
            if args.get(field) is not None:
                setattr(task, field, int(args[field]))
                changed.append(field)
        if not changed:
            return "Nothing to update — provide title, prompt, frequency, day_of_week, day_of_month, hour, or minute."
        task.next_run_at = compute_next_run(
            task.frequency, task.day_of_week, task.day_of_month, task.hour, task.minute
        )
        return (
            f"Scheduled task '{task.title}' updated ({', '.join(changed)}). "
            f"Next run {task.next_run_at:%Y-%m-%d %H:%M}."
        )

    return "Error: action must be create, update, enable, disable, or delete."


# ── Knowledge base (list + remove) ────────────────────────────────────────────

async def execute_manage_knowledge_base(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.document import Document
    from models.db.enums import DocumentStatus
    from repositories.document_repo import DocumentRepository

    action = str(args.get("action", "list")).lower()
    repo = DocumentRepository(ctx.db)

    if action == "list":
        docs = await repo.list_active(limit=100, offset=0)
        if not docs:
            return "The knowledge base is empty."
        lines = [
            f"- {d.id} | {d.title} | {getattr(d.source_type, 'value', d.source_type)} | "
            f"{getattr(d.status, 'value', d.status)} | added {d.created_at:%Y-%m-%d}"
            for d in docs
        ]
        return f"{len(docs)} knowledge base documents:\n" + "\n".join(lines)

    if action == "delete":
        doc_id = _parse_uuid(args.get("document_id"))
        if doc_id is None:
            return "Error: a valid document_id is required. Use action 'list' to find IDs."
        doc = await repo.get_active(doc_id)
        if doc is None:
            return "Document not found in the knowledge base."
        # Never delete server-side here. Stage a confirm/cancel popup; the
        # frontend performs the deletion only after the user confirms.
        ctx.pending_confirmation = {
            "type": "confirm_delete",
            "target": "kb_document",
            "document_id": str(doc.id),
            "title": doc.title,
        }
        return (
            f"A confirmation popup is now shown to the user asking them to permanently "
            f"delete '{doc.title}' from the knowledge base. It is only removed if they "
            f"confirm there. Stop and wait for their decision."
        )

    return "Error: action must be 'list' or 'delete'. New documents are added via the Documents page or Drive sync."


# ── App overview (read) ───────────────────────────────────────────────────────

async def execute_get_app_overview(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.approval import ApprovalIntent
    from models.db.conversation import Conversation, Message
    from models.db.document import Document
    from models.db.enums import ApprovalStatus
    from models.db.scheduled_task import ScheduledTask
    from models.db.task import Task

    async def _count(stmt) -> int:
        return (await ctx.db.execute(stmt)).scalar() or 0

    conv_count = await _count(
        select(func.count()).select_from(Conversation).where(Conversation.user_id == ctx.user_id)
    )
    msg_count = await _count(select(func.count()).select_from(Message))
    task_count = await _count(select(func.count()).select_from(Task))
    doc_count = await _count(
        select(func.count()).select_from(Document).where(Document.deleted_at.is_(None))
    )
    sched_count = await _count(
        select(func.count()).select_from(ScheduledTask).where(ScheduledTask.user_id == ctx.user_id)
    )
    pending_approvals = await _count(
        select(func.count())
        .select_from(ApprovalIntent)
        .where(
            ApprovalIntent.user_id == ctx.user_id,
            ApprovalIntent.status == ApprovalStatus.PENDING,
        )
    )

    d = _generated_files_dir()
    file_count = (
        len([f for f in d.iterdir() if f.is_file() and not f.name.startswith(".")])
        if d.is_dir()
        else 0
    )

    version = "unknown"
    try:
        version_file = Path(__file__).resolve().parents[3] / "VERSION"
        if version_file.is_file():
            version = version_file.read_text(encoding="utf-8").strip()
    except OSError:
        pass

    return (
        f"Little Gerry app overview (v{version}):\n"
        f"- Conversations: {conv_count} ({msg_count} messages total)\n"
        f"- Tasks on the board: {task_count}\n"
        f"- Knowledge base documents: {doc_count}\n"
        f"- Scheduled tasks: {sched_count}\n"
        f"- Generated files: {file_count}\n"
        f"- Pending approvals: {pending_approvals}"
    )


# ── Read-only: settings, users, audit, approvals ─────────────────────────────

async def execute_get_app_settings(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.settings import SystemSetting

    rows = (
        (await ctx.db.execute(select(SystemSetting).order_by(SystemSetting.key)))
        .scalars()
        .all()
    )
    if not rows:
        return "No settings configured."
    lines = []
    for s in rows:
        if s.is_secret or any(w in s.key.lower() for w in ("key", "secret", "password", "token")):
            value = "•••• (secret, hidden)"
        else:
            value = json.dumps(s.value) if not isinstance(s.value, str) else s.value
            if len(str(value)) > 80:
                value = str(value)[:80] + "…"
        lines.append(f"- {s.key} = {value}")
    return (
        "App settings (READ ONLY — changes must be made by the user in Settings):\n"
        + "\n".join(lines)
    )


async def execute_list_users(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.user import User

    users = (
        (await ctx.db.execute(select(User).order_by(User.created_at))).scalars().all()
    )
    lines = [
        f"- {u.display_name} <{u.email}> | role={u.role} | "
        f"{'active' if u.is_active else 'INACTIVE'} | "
        f"regulatory write: {'yes' if u.can_write_regulatory else 'no'} | "
        f"joined {u.created_at:%Y-%m-%d}"
        for u in users
    ]
    return (
        f"{len(users)} users (READ ONLY — user management is done in Settings):\n"
        + "\n".join(lines)
    )


async def execute_get_audit_trail(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.audit import AuditEvent

    limit = min(int(args.get("limit", 25) or 25), 100)
    event_type = str(args.get("event_type", "")).strip()

    stmt = select(AuditEvent).order_by(desc(AuditEvent.sequence_number)).limit(limit)
    if event_type:
        stmt = stmt.where(AuditEvent.event_type.ilike(f"%{event_type}%"))

    events = (await ctx.db.execute(stmt)).scalars().all()
    if not events:
        return "No audit events found."
    lines = []
    for e in events:
        entity = f" {e.entity_type}:{e.entity_id}" if e.entity_type else ""
        lines.append(f"- #{e.sequence_number} {e.created_at:%Y-%m-%d %H:%M} | {e.event_type}{entity}")
    return (
        f"{len(events)} most recent audit events (READ ONLY, append-only log):\n"
        + "\n".join(lines)
    )


async def execute_get_approvals(ctx: "ToolContext", args: dict[str, Any]) -> str:
    from models.db.approval import ApprovalIntent

    limit = min(int(args.get("limit", 25) or 25), 100)
    status_filter = str(args.get("status", "")).strip().lower()

    stmt = (
        select(ApprovalIntent)
        .where(ApprovalIntent.user_id == ctx.user_id)
        .order_by(desc(ApprovalIntent.created_at))
        .limit(limit)
    )
    if status_filter:
        stmt = stmt.where(ApprovalIntent.status == status_filter)

    intents = (await ctx.db.execute(stmt)).scalars().all()
    if not intents:
        return "No approval requests found."
    lines = [
        f"- {i.created_at:%Y-%m-%d} | {getattr(i.intent_type, 'value', i.intent_type)} | "
        f"{i.intent_title} | status={getattr(i.status, 'value', i.status)}"
        for i in intents
    ]
    return (
        f"{len(intents)} approval requests (READ ONLY — only the user can approve or reject):\n"
        + "\n".join(lines)
    )


# ── Registry ──────────────────────────────────────────────────────────────────

CUSTODIAN_EXECUTORS = {
    "list_conversations": execute_list_conversations,
    "read_conversation": execute_read_conversation,
    "update_conversation": execute_update_conversation,
    "list_generated_files": execute_list_generated_files,
    "manage_generated_file": execute_manage_generated_file,
    "update_task": execute_update_task,
    "list_scheduled_tasks": execute_list_scheduled_tasks,
    "manage_scheduled_task": execute_manage_scheduled_task,
    "manage_knowledge_base": execute_manage_knowledge_base,
    "get_app_overview": execute_get_app_overview,
    "get_app_settings": execute_get_app_settings,
    "list_users": execute_list_users,
    "get_audit_trail": execute_get_audit_trail,
    "get_approvals": execute_get_approvals,
}
