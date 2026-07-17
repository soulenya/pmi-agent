"""Workroom daily automations — morning digest + proactive to-dos.

Runs once per day per active workroom (called from the daily assistant scan,
before the Google-credentials gate so rooms work even without Google):

* **Morning digest** — pinned Drive docs edited in the last 24h, pinned/room
  tasks due soon or overdue, and recent journal activity → one assistant
  message posted into the room's conversation + a journal entry + a
  notification. Deterministic (no LLM) — fast, cheap, honest.
* **Proactive to-dos** — the configured LLM reads the room's goal, pins,
  journal, and latest chat turns, then proposes 0–2 next steps as
  ``AssistantSuggestion`` rows (kind ``workroom_todo``) with the standard
  accept/dismiss flow. Accepting creates a Little Gerry task and journals it.

Everything here is best-effort: any failure is logged and skipped, never
raised into the scan.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.assistant import AssistantSuggestion
from models.db.conversation import Message
from models.db.enums import MessageRole, NotificationType
from models.db.task import Task
from models.db.workroom import Workroom, WorkroomItem, WorkroomJournalEntry
from repositories.conversation_repo import MessageRepository, NotificationRepository
from services.workroom_context import add_journal_entry, list_active_workrooms

logger = logging.getLogger(__name__)

SETTING_LAST_DATE = "workroom.daily.last_date"

# Same suppression rule as the main assistant scan: one dismissal lets a
# suggestion resurface; two suppresses it for good.
_DISMISS_SUPPRESS_THRESHOLD = 2

_TODO_SYSTEM = (
    "You are Little Gerry, an AI chief of staff. You review a co-work room "
    "(a goal + pinned documents + a progress journal + a chat) and propose "
    "the most useful NEXT STEPS the user should take toward the goal. "
    "Only propose steps that are concrete, actionable this week, and not "
    "already done per the journal. Quality over quantity — zero is fine."
)

_TODO_INSTRUCTIONS = (
    "Respond ONLY with JSON in this exact shape:\n"
    "{\n"
    '  "todos": [\n'
    '    {"title": "...", "description": "...", "priority": "low|medium|high"}\n'
    "  ]\n"
    "}\n"
    "Return at most 2 todos. Return an empty list when nothing genuinely "
    "useful can be proposed."
)


def _norm_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:120]


async def _get_setting(db: AsyncSession, key: str):
    from models.db.settings import SystemSetting

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return row.value if row is not None else None


async def _set_setting(db: AsyncSession, key: str, value) -> None:
    from models.db.settings import SystemSetting

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        db.add(SystemSetting(key=key, value=value))
    else:
        row.value = value
    await db.flush()


# ── digest ────────────────────────────────────────────────────────────────


async def _digest_for_room(db: AsyncSession, room: Workroom) -> str | None:
    """Compose the digest body for one room, or None when nothing happened."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=24)
    sections: list[str] = []

    items = list(
        (
            await db.execute(
                select(WorkroomItem).where(WorkroomItem.workroom_id == room.id)
            )
        ).scalars()
    )

    # 1. Pinned Drive docs edited in the last 24h (metadata-only calls).
    drive_lines: list[str] = []
    drive_items = [i for i in items if i.kind == "drive_doc" and i.ref_id]
    if drive_items:
        try:
            from services import google_service as gs

            if gs.get_credentials():
                for it in drive_items[:15]:
                    try:
                        meta = gs.drive_get_metadata(it.ref_id)
                    except Exception:  # noqa: BLE001
                        continue
                    if not meta or meta.get("trashed"):
                        continue
                    mod = meta.get("modifiedTime") or ""
                    try:
                        mod_dt = datetime.fromisoformat(mod.replace("Z", "+00:00"))
                    except ValueError:
                        continue
                    if mod_dt >= since:
                        drive_lines.append(
                            f"- **{meta.get('name') or it.label}** was edited "
                            f"({mod_dt.strftime('%H:%M')} UTC)"
                        )
        except Exception:  # noqa: BLE001 — Drive checks are best-effort
            logger.info("Room digest: Drive check failed for %s", room.id)
    if drive_lines:
        sections.append("**Pinned documents edited since yesterday:**\n" + "\n".join(drive_lines))

    # 2. Tasks due soon / overdue — pinned task refs + tasks born in this room.
    task_ids: set[uuid.UUID] = set()
    for it in items:
        if it.kind == "task" and it.ref_id:
            try:
                task_ids.add(uuid.UUID(it.ref_id))
            except ValueError:
                continue
    task_rows: list[Task] = []
    try:
        stmt = select(Task).where(
            Task.status.notin_(["done", "cancelled"]),
            Task.due_date.isnot(None),
            Task.due_date <= now + timedelta(days=3),
        )
        if room.conversation_id and task_ids:
            from sqlalchemy import or_

            stmt = stmt.where(
                or_(
                    Task.id.in_(task_ids),
                    Task.source_conversation_id == room.conversation_id,
                )
            )
        elif room.conversation_id:
            stmt = stmt.where(Task.source_conversation_id == room.conversation_id)
        elif task_ids:
            stmt = stmt.where(Task.id.in_(task_ids))
        else:
            stmt = None
        if stmt is not None:
            task_rows = list((await db.execute(stmt)).scalars())
    except Exception:  # noqa: BLE001
        logger.info("Room digest: task check failed for %s", room.id)
    if task_rows:
        t_lines = []
        for t in task_rows[:10]:
            state = "OVERDUE" if t.due_date and t.due_date < now else "due soon"
            due = t.due_date.strftime("%Y-%m-%d") if t.due_date else ""
            t_lines.append(f"- **{t.title}** — {state} ({due})")
        sections.append("**Deadlines:**\n" + "\n".join(t_lines))

    # 3. Journal activity in the last 24h (excluding the digest's own entries).
    try:
        recent_journal = list(
            (
                await db.execute(
                    select(WorkroomJournalEntry)
                    .where(
                        WorkroomJournalEntry.workroom_id == room.id,
                        WorkroomJournalEntry.created_at >= since,
                    )
                    .order_by(desc(WorkroomJournalEntry.created_at))
                    .limit(5)
                )
            ).scalars()
        )
        j_lines = [
            f"- {j.entry}" for j in recent_journal if "Morning digest" not in j.entry
        ]
        if j_lines:
            sections.append("**Logged yesterday:**\n" + "\n".join(j_lines))
    except Exception:  # noqa: BLE001
        pass

    if not sections:
        return None
    return (
        f"**Morning digest — {room.title}**\n\n" + "\n\n".join(sections)
    )


# ── proactive to-dos ──────────────────────────────────────────────────────


def _extract_json(text: str) -> dict:
    if not text:
        return {}
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except Exception:  # noqa: BLE001
        return {}


async def _propose_todos(db: AsyncSession, room: Workroom) -> list[dict]:
    """Ask the configured LLM for 0–2 next steps for this room."""
    try:
        from services.llm.router import get_llm_client

        client = await get_llm_client(db, task="daily_assistant")
    except Exception as exc:  # noqa: BLE001
        logger.info("Room todos: LLM unavailable (%s)", exc)
        return []

    items = list(
        (
            await db.execute(
                select(WorkroomItem).where(WorkroomItem.workroom_id == room.id)
            )
        ).scalars()
    )
    journal = list(
        (
            await db.execute(
                select(WorkroomJournalEntry)
                .where(WorkroomJournalEntry.workroom_id == room.id)
                .order_by(desc(WorkroomJournalEntry.created_at))
                .limit(8)
            )
        ).scalars()
    )
    chat_snippets: list[str] = []
    if room.conversation_id:
        try:
            msgs = list(
                (
                    await db.execute(
                        select(Message)
                        .where(Message.conversation_id == room.conversation_id)
                        .order_by(desc(Message.created_at))
                        .limit(6)
                    )
                ).scalars()
            )
            for m in reversed(msgs):
                if m.content:
                    chat_snippets.append(f"{m.role.value}: {m.content[:250]}")
        except Exception:  # noqa: BLE001
            pass

    payload = {
        "room_title": room.title,
        "goal": room.goal[:1000],
        "pinned_items": [f"[{i.kind}] {i.label}" for i in items[:20]],
        "journal_newest_first": [j.entry[:250] for j in journal],
        "latest_chat": chat_snippets,
    }
    messages = [
        {"role": "system", "content": _TODO_SYSTEM},
        {
            "role": "user",
            "content": _TODO_INSTRUCTIONS
            + "\n\nHere is the room:\n"
            + json.dumps(payload, ensure_ascii=False),
        },
    ]
    try:
        chunk = await client.chat(messages, temperature=0.2)
    except Exception as exc:  # noqa: BLE001
        logger.info("Room todos: LLM call failed (%s)", exc)
        return []
    todos = _extract_json(chunk.content).get("todos") or []
    return [t for t in todos if isinstance(t, dict) and str(t.get("title", "")).strip()][:2]


async def _upsert_todo(
    db: AsyncSession, user_id: uuid.UUID, room: Workroom, todo: dict
) -> AssistantSuggestion | None:
    """Create/resurface a workroom_todo suggestion; None when suppressed."""
    title = str(todo.get("title", "")).strip()[:400]
    description = str(todo.get("description", "")).strip()
    priority = str(todo.get("priority", "medium")).lower()
    if priority not in ("low", "medium", "high"):
        priority = "medium"
    source_id = f"room:{room.id}:{_norm_key(title)}"[:255]

    prior = (
        await db.execute(
            select(AssistantSuggestion).where(
                AssistantSuggestion.user_id == user_id,
                AssistantSuggestion.kind == "workroom_todo",
                AssistantSuggestion.source_id == source_id,
            )
        )
    ).scalar_one_or_none()
    if prior is not None:
        if prior.status in ("pending", "accepted"):
            return None
        if (prior.dismissal_count or 0) >= _DISMISS_SUPPRESS_THRESHOLD:
            return None
        prior.title = f"[{room.title}] {title}"[:500]
        prior.summary = description
        prior.status = "pending"
        prior.resolved_at = None
        return prior

    s = AssistantSuggestion(
        user_id=user_id,
        kind="workroom_todo",
        status="pending",
        title=f"[{room.title}] {title}"[:500],
        summary=description,
        source_type="workroom",
        source_id=source_id,
        source_url=None,
        payload={
            "workroom_id": str(room.id),
            "workroom_title": room.title,
            "task": {"title": title, "description": description, "priority": priority},
        },
    )
    db.add(s)
    return s


# ── entry point ───────────────────────────────────────────────────────────


async def run_workroom_daily(db: AsyncSession) -> dict:
    """Run digests + to-dos for every active room, once per local day.

    Returns ``{"digests": int, "todos": int, "notifications": [...]}``.
    """
    summary: dict = {"digests": 0, "todos": 0, "notifications": []}
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        if await _get_setting(db, SETTING_LAST_DATE) == today:
            return summary
    except Exception:  # noqa: BLE001
        return summary

    from models.db.user import User

    users = list((await db.execute(select(User))).scalars())
    notif_repo = NotificationRepository(db)
    msg_repo = MessageRepository(db)

    for user in users:
        try:
            rooms = await list_active_workrooms(db, user.id)
        except Exception:  # noqa: BLE001
            continue
        for room in rooms:
            # Digest
            try:
                body = await _digest_for_room(db, room)
                if body and room.conversation_id:
                    await msg_repo.create(
                        conversation_id=room.conversation_id,
                        role=MessageRole.ASSISTANT,
                        content=body,
                    )
                    await add_journal_entry(db, room, "Morning digest posted")
                    notif = await notif_repo.create(
                        user_id=user.id,
                        type=NotificationType.REMINDER.value,
                        title=f"Workroom digest: {room.title}",
                        message="New activity since yesterday — open the room chat.",
                        entity_type="conversation",
                        entity_id=room.conversation_id,
                    )
                    summary["digests"] += 1
                    summary["notifications"].append(
                        {
                            "user_id": str(user.id),
                            "id": str(notif.id),
                            "title": f"Workroom digest: {room.title}",
                        }
                    )
            except Exception:  # noqa: BLE001
                logger.exception("Room digest failed for %s", room.id)

            # Proactive to-dos
            try:
                for todo in await _propose_todos(db, room):
                    s = await _upsert_todo(db, user.id, room, todo)
                    if s is None:
                        continue
                    await db.flush()
                    notif = await notif_repo.create(
                        user_id=user.id,
                        type=NotificationType.APPROVAL_REQUIRED.value,
                        title=s.title,
                        message=s.summary,
                        entity_type="assistant_suggestion",
                        entity_id=s.id,
                    )
                    summary["todos"] += 1
                    summary["notifications"].append(
                        {"user_id": str(user.id), "id": str(notif.id), "title": s.title}
                    )
            except Exception:  # noqa: BLE001
                logger.exception("Room todos failed for %s", room.id)

    try:
        await _set_setting(db, SETTING_LAST_DATE, today)
        await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Workroom daily: failed to persist")
        await db.rollback()
    if summary["digests"] or summary["todos"]:
        logger.info(
            "Workroom daily complete: %d digest(s), %d todo(s)",
            summary["digests"],
            summary["todos"],
        )
    return summary
