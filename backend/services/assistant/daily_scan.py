"""Daily Gmail / Google Tasks assistant scan.

Once a day (and as a catch-up on first app open if the scheduled time was
missed) this scans the connected Google account and surfaces actionable items
as ``AssistantSuggestion`` rows:

* **follow-up reminders** — emails likely awaiting a reply and overdue/soon-due
  Google Tasks;
* **task recommendations** — drafted by the configured LLM from email threads
  and recent chat conversations, created as Little Gerry tasks only on approval;
* **meeting-summary imports** — Gemini meeting notes (email attachments and
  Drive "Notes by Gemini" docs) imported into the Knowledge Base immediately,
  then kept or removed on review.

The ``(user_id, kind, source_id)`` uniqueness guarantees repeated daily scans
never duplicate the same item.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings as app_settings
from models.db.assistant import AssistantSuggestion
from models.db.conversation import Conversation, Message
from models.db.enums import NotificationType
from models.db.odoo import OdooConnection
from models.db.settings import SystemSetting
from models.db.user import User
from repositories.conversation_repo import NotificationRepository
from services import google_service as gs
from services import odoo_service as odoo

logger = logging.getLogger(__name__)

# Default feature settings (stored in system_settings as JSONB).
SETTING_ENABLED = "assistant_scan.enabled"
SETTING_HOUR = "assistant_scan.hour_local"
SETTING_LAST_RUN = "assistant_scan.last_run"

DEFAULT_ENABLED = True
DEFAULT_HOUR = 7

# A source's suggestion is only suppressed for good once it has been dismissed
# at least this many times. A single dismissal lets it resurface on the next
# scan, protecting against an accidental dismissal.
DISMISS_SUPPRESS_THRESHOLD = 2

_IMPORTABLE_EXT = (".pdf", ".docx", ".doc", ".txt", ".md")

_NOTIF_TYPE = {
    "followup_email": NotificationType.REMINDER.value,
    "followup_task": NotificationType.REMINDER.value,
    "task_recommendation": NotificationType.APPROVAL_REQUIRED.value,
    "meeting_import": NotificationType.DOCUMENT_INGESTED.value,
}


# ── settings helpers (kept local so the feature stays self-contained) ─────────

async def get_setting(db: AsyncSession, key: str, default: Any) -> Any:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return row.value if row is not None and row.value is not None else default


async def set_setting(db: AsyncSession, key: str, value: Any, user_id=None) -> None:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        db.add(SystemSetting(key=key, value=value, updated_by=user_id))
    else:
        row.value = value
        if user_id is not None:
            row.updated_by = user_id
    await db.flush()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── owner / dedup helpers ─────────────────────────────────────────────────────

async def _owner_user(db: AsyncSession) -> User | None:
    """The user the Google connection belongs to (configured admin, else first admin)."""
    email = (app_settings.admin_email or "").strip().lower()
    if email:
        row = (
            await db.execute(select(User).where(func.lower(User.email) == email))
        ).scalar_one_or_none()
        if row:
            return row
    row = (
        await db.execute(
            select(User).where(User.role == "admin").order_by(User.created_at)
        )
    ).scalars().first()
    if row:
        return row
    return (
        await db.execute(select(User).order_by(User.created_at))
    ).scalars().first()


def _parse_rfc3339(value: str) -> datetime | None:
    if not value:
        return None
    try:
        cleaned = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


# ── LLM analysis ──────────────────────────────────────────────────────────────

_LLM_SYSTEM = (
    "You are an executive assistant. You analyze the user's recent email and "
    "chat activity and surface (1) emails that likely need a follow-up from the "
    "user and (2) concrete tasks worth creating. Be selective and practical — "
    "only flag things that genuinely need action. Respond with STRICT JSON only, "
    "no prose, no markdown fences."
)

_LLM_INSTRUCTIONS = (
    "Return a JSON object with this exact shape:\n"
    "{\n"
    '  "followups": [\n'
    '    {"email_id": "<id from sent or inbox>", "title": "Follow up: ...", '
    '"summary": "why it needs follow-up (1 sentence)", '
    '"task": {"title": "...", "description": "...", "priority": "low|medium|high"}}\n'
    "  ],\n"
    '  "task_recommendations": [\n'
    '    {"source_email_id": "<id or null>", "source_conversation_id": "<id or null>", '
    '"title": "...", "description": "...", "priority": "low|medium|high", "due_in_days": 3}\n'
    "  ]\n"
    "}\n"
    "Use email_id / source_email_id values exactly as given. Omit items you are "
    "unsure about. Return at most 5 followups and 5 task_recommendations."
)


def _extract_json(text: str) -> dict:
    if not text:
        return {}
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except Exception:
        logger.warning("Assistant scan: could not parse LLM JSON output")
        return {}


async def _analyze_with_llm(
    db: AsyncSession,
    sent: list[dict],
    inbox: list[dict],
    conversations: list[dict],
) -> dict:
    """Ask the configured LLM to draft follow-ups and task recommendations."""
    if not (sent or inbox or conversations):
        return {}
    try:
        from services.llm.router import get_llm_client

        client = await get_llm_client(db, task="daily_assistant")
    except Exception as exc:
        logger.warning("Assistant scan: LLM unavailable (%s) — skipping recommendations", exc)
        return {}

    def _trim(items: list[dict], keys: tuple[str, ...]) -> list[dict]:
        out = []
        for it in items:
            out.append({k: str(it.get(k, ""))[:300] for k in keys})
        return out

    payload = {
        "sent_emails": _trim(sent, ("id", "to", "subject", "date", "snippet")),
        "inbox_emails": _trim(inbox, ("id", "from", "subject", "date", "snippet")),
        "chat_conversations": _trim(conversations, ("id", "title", "snippet")),
    }

    messages = [
        {"role": "system", "content": _LLM_SYSTEM},
        {
            "role": "user",
            "content": _LLM_INSTRUCTIONS
            + "\n\nHere is the activity to analyze:\n"
            + json.dumps(payload, ensure_ascii=False),
        },
    ]
    try:
        chunk = await client.chat(messages, temperature=0.2)
    except Exception as exc:
        logger.warning("Assistant scan: LLM call failed (%s)", exc)
        return {}
    return _extract_json(chunk.content)


# ── main scan ─────────────────────────────────────────────────────────────────

async def run_daily_scan(db: AsyncSession, embedding_svc) -> dict:
    """Run the daily scan. Returns a summary dict including notifications to push."""
    summary: dict[str, Any] = {
        "created": 0,
        "imported": 0,
        "notifications": [],
        "skipped": None,
    }

    try:
        creds = gs.get_credentials()
    except Exception:
        creds = None
    if not creds:
        summary["skipped"] = "google_not_connected"
        await set_setting(db, SETTING_LAST_RUN, _now_iso())
        await db.commit()
        return summary

    user = await _owner_user(db)
    if user is None:
        summary["skipped"] = "no_user"
        return summary

    seen: set[tuple[str, str]] = set()
    new_suggestions: list[AssistantSuggestion] = []

    async def _prior(kind: str, source_id: str) -> AssistantSuggestion | None:
        """The existing suggestion row for this source (any status), if any."""
        return (
            await db.execute(
                select(AssistantSuggestion).where(
                    AssistantSuggestion.user_id == user.id,
                    AssistantSuggestion.kind == kind,
                    AssistantSuggestion.source_id == source_id,
                )
            )
        ).scalar_one_or_none()

    def _is_blocked(prior: AssistantSuggestion | None) -> bool:
        """Whether an existing row should suppress a fresh recommendation.

        Blocks when the user already acted on it — it is still pending, or was
        accepted (a task/note/follow-up was already created) — or has dismissed
        it at least ``DISMISS_SUPPRESS_THRESHOLD`` times. A single dismissal does
        not block, so an accidentally dismissed item resurfaces once.
        """
        if prior is None:
            return False
        if prior.status in ("pending", "accepted"):
            return True
        if (
            prior.status == "dismissed"
            and (prior.dismissal_count or 0) >= DISMISS_SUPPRESS_THRESHOLD
        ):
            return True
        return False

    async def _skip_before_work(kind: str, source_id: str) -> bool:
        """Pre-check for expensive imports: skip when already seen or blocked."""
        if (kind, source_id) in seen:
            return True
        return _is_blocked(await _prior(kind, source_id))

    async def _add(kind: str, source_id: str, **fields) -> AssistantSuggestion | None:
        key = (kind, source_id)
        if key in seen:
            return None
        seen.add(key)
        prior = await _prior(kind, source_id)
        if _is_blocked(prior):
            return None
        if prior is not None:
            # Dismissed fewer than the threshold → resurface the same row with
            # refreshed content instead of inserting a duplicate (the
            # (user, kind, source_id) triple is unique). The dismissal_count is
            # preserved so a second dismissal still suppresses it for good.
            for field, value in fields.items():
                setattr(prior, field, value)
            prior.status = "pending"
            prior.resolved_at = None
            new_suggestions.append(prior)
            return prior
        s = AssistantSuggestion(
            user_id=user.id,
            kind=kind,
            status="pending",
            source_id=source_id,
            **fields,
        )
        db.add(s)
        new_suggestions.append(s)
        return s

    # 1. Gather Gmail context
    sent: list[dict] = []
    inbox: list[dict] = []
    try:
        sent = gs.gmail_search("in:sent newer_than:10d -in:chats", 12)
    except Exception as exc:
        logger.info("Assistant scan: sent search failed (%s)", exc)
    try:
        inbox = gs.gmail_search(
            "in:inbox is:unread newer_than:7d -category:promotions -category:social", 12
        )
    except Exception as exc:
        logger.info("Assistant scan: inbox search failed (%s)", exc)

    # 2. Recent chat conversations
    conv_context: list[dict] = []
    try:
        convs = (
            await db.execute(
                select(Conversation)
                .where(
                    Conversation.user_id == user.id,
                    Conversation.is_archived.is_(False),
                )
                .order_by(Conversation.updated_at.desc())
                .limit(8)
            )
        ).scalars().all()
        for c in convs:
            last_msg = (
                await db.execute(
                    select(Message)
                    .where(Message.conversation_id == c.id)
                    .order_by(Message.created_at.desc())
                    .limit(1)
                )
            ).scalars().first()
            conv_context.append(
                {
                    "id": str(c.id),
                    "title": c.title or "Untitled",
                    "snippet": (last_msg.content[:200] if last_msg and last_msg.content else ""),
                }
            )
    except Exception as exc:
        logger.info("Assistant scan: conversation gather failed (%s)", exc)

    # 3. LLM analysis → follow-ups + task recommendations
    llm_result = await _analyze_with_llm(db, sent, inbox, conv_context)

    email_by_id = {e.get("id"): e for e in (sent + inbox) if e.get("id")}

    for fu in (llm_result.get("followups") or [])[:5]:
        mid = str(fu.get("email_id") or "").strip()
        if not mid or mid not in email_by_id:
            continue
        await _add(
            "followup_email",
            mid,
            title=str(fu.get("title") or "Follow up on email")[:500],
            summary=str(fu.get("summary") or ""),
            source_type="gmail_message",
            source_url=f"https://mail.google.com/mail/u/0/#all/{mid}",
            payload={"task": fu.get("task") or None, "email": email_by_id.get(mid)},
        )

    for tr in (llm_result.get("task_recommendations") or [])[:5]:
        title = str(tr.get("title") or "").strip()
        if not title:
            continue
        src_email = str(tr.get("source_email_id") or "").strip()
        src_conv = str(tr.get("source_conversation_id") or "").strip()
        ref = src_email or src_conv or title
        source_id = f"{ref}|{title}"[:255]
        src_type = (
            "gmail_message" if src_email else "chat_conversation" if src_conv else "llm"
        )
        url = (
            f"https://mail.google.com/mail/u/0/#all/{src_email}" if src_email else None
        )
        priority = str(tr.get("priority") or "medium").lower()
        if priority not in ("low", "medium", "high", "critical"):
            priority = "medium"
        await _add(
            "task_recommendation",
            source_id,
            title=f"Create task: {title}"[:500],
            summary=str(tr.get("description") or ""),
            source_type=src_type,
            source_url=url,
            payload={
                "task": {
                    "title": title,
                    "description": str(tr.get("description") or ""),
                    "priority": priority,
                    "due_in_days": tr.get("due_in_days"),
                },
                "source_email_id": src_email or None,
                "source_conversation_id": src_conv or None,
            },
        )

    # 4. Google Tasks — overdue / due soon
    gtasks: list[dict] = []
    try:
        gtasks = gs.tasks_list(max_results=50, show_completed=False)
    except Exception as exc:
        logger.info("Assistant scan: tasks_list failed (%s)", exc)
    now = datetime.now(timezone.utc)
    for t in gtasks:
        due_dt = _parse_rfc3339(t.get("due", ""))
        if due_dt is None:
            continue
        days = (due_dt - now).total_seconds() / 86400.0
        if days > 2:
            continue
        tid = str(t.get("id") or "")
        if not tid:
            continue
        label = "overdue" if due_dt < now else "due soon"
        await _add(
            "followup_task",
            tid,
            title=f"Google Task {label}: {t.get('title', '')}"[:500],
            summary=f"List: {t.get('list', '')} · due {t.get('due', '')[:10]}",
            source_type="google_task",
            source_url=None,
            payload={"google_task": t},
        )

    # 5. Meeting-summary imports — Gmail attachments
    att_msgs: list[dict] = []
    try:
        att_msgs = gs.gmail_search(
            'newer_than:7d has:attachment '
            '(subject:(notes OR summary OR recap OR minutes) '
            'OR "Notes by Gemini" OR from:meet-recordings-noreply@google.com)',
            10,
        )
    except Exception as exc:
        logger.info("Assistant scan: attachment search failed (%s)", exc)
    for m in att_msgs:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        try:
            attachments = gs.gmail_get_attachments(mid)
        except Exception as exc:
            logger.info("Assistant scan: get attachments failed for %s (%s)", mid, exc)
            continue
        for att in attachments:
            fn = att.get("filename") or ""
            if Path(fn).suffix.lower() not in _IMPORTABLE_EXT:
                continue
            data = att.get("data") or b""
            if not data:
                continue
            src_id = f"{mid}:{att.get('attachment_id', '')}"[:255]
            if await _skip_before_work("meeting_import", src_id):
                continue
            doc = await _ingest(
                db, embedding_svc, user.id, fn, data,
                title=f"[Email] {m.get('subject') or fn}",
            )
            if doc is None:
                continue
            await _add(
                "meeting_import",
                src_id,
                title=f"Imported summary: {fn}"[:500],
                summary=f"From email: {m.get('subject', '')}",
                source_type="gmail_attachment",
                source_url=f"https://mail.google.com/mail/u/0/#all/{mid}",
                payload={
                    "filename": fn,
                    "email_subject": m.get("subject", ""),
                    "document_id": str(doc.id),
                },
                result_entity_type="document",
                result_entity_id=doc.id,
            )

    # 6. Meeting-summary imports — Gemini Drive docs
    gem_docs: list[dict] = []
    try:
        gem_docs = gs.drive_search_by_name("Notes by Gemini", 15)
    except Exception as exc:
        logger.info("Assistant scan: Gemini-doc search failed (%s)", exc)
    for f in gem_docs:
        fid = str(f.get("id") or "")
        if not fid or await _skip_before_work("meeting_import", fid):
            continue
        try:
            content_data = gs.drive_get_content(fid)
        except Exception as exc:
            logger.info("Assistant scan: drive_get_content failed for %s (%s)", fid, exc)
            continue
        raw = content_data.get("raw_bytes")
        name = content_data.get("name", "meeting-notes")
        if raw:
            filename = Path(name).stem + (content_data.get("extension") or ".pdf")
            raw_bytes = raw
        else:
            text = content_data.get("content", "")
            if not text.strip():
                continue
            filename = Path(name).stem + ".txt"
            raw_bytes = text.encode("utf-8")
        doc = await _ingest(
            db, embedding_svc, user.id, filename, raw_bytes,
            title=f"[Gemini] {name}",
        )
        if doc is None:
            continue
        # Link source so it can be checked for updates like other Drive imports.
        try:
            doc.source_type = "google_drive"
            doc.source_id = fid
            doc.source_name = name
            doc.sync_status = "current"
            await db.flush()
        except Exception:
            pass
        await _add(
            "meeting_import",
            fid,
            title=f"Imported Gemini notes: {name}"[:500],
            summary="Gemini meeting notes from Google Drive",
            source_type="drive_doc",
            source_url=content_data.get("url") or f.get("url"),
            payload={"filename": filename, "drive_file_id": fid, "document_id": str(doc.id)},
            result_entity_type="document",
            result_entity_id=doc.id,
        )

    # 6.5 Odoo ERP business alerts
    # If the user has connected Odoo, surface overdue invoices/bills, aging
    # quotations, and low stock as recommended tasks (same accept/dismiss flow).
    try:
        conn = (
            await db.execute(
                select(OdooConnection).where(OdooConnection.user_id == user.id)
            )
        ).scalar_one_or_none()
    except Exception as exc:
        conn = None
        logger.info("Assistant scan: Odoo connection lookup failed (%s)", exc)
    if conn is not None:
        try:
            api_key = odoo.decrypt_secret(conn.api_key_encrypted)
            alerts = await odoo.fetch_alerts(conn.url, conn.database, conn.username, api_key)
        except Exception as exc:
            alerts = []
            logger.info("Assistant scan: Odoo alert fetch failed (%s)", exc)
        for a in alerts:
            await _add(
                "task_recommendation",
                a["source_id"],
                title=a["title"],
                summary=a["summary"],
                source_type=a["source_type"],
                source_url=a.get("source_url"),
                payload={"task": a.get("task"), "odoo_action": a.get("action"), "odoo": True},
            )

    # 7. Persist + create notifications
    await db.flush()
    notif_repo = NotificationRepository(db)
    for s in new_suggestions:
        try:
            notif = await notif_repo.create(
                user_id=user.id,
                type=_NOTIF_TYPE.get(s.kind, NotificationType.REMINDER.value),
                title=s.title,
                message=s.summary,
                entity_type="assistant_suggestion",
                entity_id=s.id,
            )
            summary["notifications"].append(
                {"user_id": str(user.id), "id": str(notif.id), "title": s.title}
            )
        except Exception as exc:
            logger.info("Assistant scan: notification create failed (%s)", exc)

    await set_setting(db, SETTING_LAST_RUN, _now_iso(), user.id)
    await db.commit()

    summary["created"] = sum(1 for s in new_suggestions if s.kind != "meeting_import")
    summary["imported"] = sum(1 for s in new_suggestions if s.kind == "meeting_import")
    logger.info(
        "Assistant scan complete: %d suggestion(s), %d import(s)",
        summary["created"],
        summary["imported"],
    )
    return summary


async def _ingest(
    db: AsyncSession,
    embedding_svc,
    user_id,
    filename: str,
    raw_bytes: bytes,
    *,
    title: str,
):
    """Ingest a file into the Knowledge Base, returning the Document or None."""
    from services.documents.ingestion import DocumentIngestionService

    try:
        svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
        return await svc.ingest(
            filename=filename,
            raw_bytes=raw_bytes,
            title=title[:500],
            category_id=None,
            is_regulated=False,
            created_by_id=user_id,
        )
    except Exception as exc:
        logger.info("Assistant scan: ingest failed for %s (%s)", filename, exc)
        return None
