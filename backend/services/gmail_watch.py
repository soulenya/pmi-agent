"""Live inbox: notice new Gmail as it lands and tell the app.

Gmail's history API answers "what changed since history id X" in one cheap
call, so every few seconds each connected person's mailbox is asked exactly
that. Any change pushes a ``gmail_changed`` frame over the notifications
socket (the Inbox refetches); a message newly landed in INBOX also becomes a
bell notification, which reaches a subscribed phone through web push.

Gmail's own push (Pub/Sub ``watch``) needs a public HTTPS endpoint outside
IAP and a topic per project. Polling history is the honest fit here: two
quota units a tick, no infrastructure.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.enums import NotificationType
from models.db.notification import Notification
from repositories.conversation_repo import NotificationRepository
from services import google_service as gs

logger = logging.getLogger(__name__)

POLL_SECONDS = 15
# More than this in one tick collapses into a single "N new emails" row.
MAX_INDIVIDUAL = 8
# Message ids already notified, per user, so a label shuffle cannot re-notify.
_SEEN_CAP = 500

_cursors: dict[uuid.UUID, str] = {}
_seen: dict[uuid.UUID, deque[str]] = {}

PushFn = Callable[[str, dict[str, Any]], Awaitable[None]]


def _sender_name(raw: str) -> str:
    raw = (raw or "").strip()
    if "<" in raw:
        name = raw.split("<", 1)[0].strip().strip('"')
        return name or raw[raw.find("<") + 1 : raw.rfind(">")]
    return raw


def _poll_sync(cursor: str | None) -> tuple[str, list[dict], bool]:
    """One history call. Returns (new cursor, inbox messages added, anything changed).

    A missing cursor, or one Gmail no longer remembers (404), reseeds from
    the profile without reporting the backlog — nobody wants forty toasts
    after a weekend.
    """
    from googleapiclient.errors import HttpError

    svc = gs._build("gmail", "v1")
    if cursor is None:
        prof = svc.users().getProfile(userId="me").execute()
        return str(prof["historyId"]), [], False

    added: list[dict] = []
    changed = False
    page = None
    new_cursor = cursor
    while True:
        try:
            resp = (
                svc.users()
                .history()
                .list(userId="me", startHistoryId=cursor, pageToken=page, maxResults=500)
                .execute()
            )
        except HttpError as exc:
            if exc.resp.status == 404:
                prof = svc.users().getProfile(userId="me").execute()
                return str(prof["historyId"]), [], True
            raise
        for h in resp.get("history", []):
            changed = True
            for m in h.get("messagesAdded", []):
                msg = m.get("message") or {}
                labels = set(msg.get("labelIds") or [])
                if "INBOX" in labels and not labels & {"SENT", "DRAFT"}:
                    added.append(msg)
        new_cursor = str(resp.get("historyId") or new_cursor)
        page = resp.get("nextPageToken")
        if not page:
            break
    return new_cursor, added, changed


def _describe_sync(message_id: str) -> dict | None:
    svc = gs._build("gmail", "v1")
    try:
        msg = (
            svc.users()
            .messages()
            .get(userId="me", id=message_id, format="metadata", metadataHeaders=["From", "Subject"])
            .execute()
        )
    except Exception:  # noqa: BLE001 — deleted between tick and read
        return None
    headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
    return {
        "message_id": message_id,
        "thread_id": msg.get("threadId", ""),
        "from": headers.get("From", ""),
        "subject": headers.get("Subject", "") or "(no subject)",
        "snippet": msg.get("snippet", ""),
    }


def _remember(user_id: uuid.UUID, message_id: str) -> bool:
    """True the first time *message_id* is seen for this user."""
    seen = _seen.setdefault(user_id, deque(maxlen=_SEEN_CAP))
    if message_id in seen:
        return False
    seen.append(message_id)
    return True


async def _notify(
    db: AsyncSession, user_id: uuid.UUID, mails: list[dict], push: PushFn
) -> None:
    repo = NotificationRepository(db)
    kind = NotificationType.EMAIL_RECEIVED.value
    if len(mails) > MAX_INDIVIDUAL:
        notif = await repo.create(
            user_id,
            kind,
            f"{len(mails)} new emails",
            ", ".join(_sender_name(m["from"]) for m in mails[:6]) + (", …" if len(mails) > 6 else ""),
            entity_type="gmail_inbox",
        )
        await db.commit()
        await push(
            str(user_id),
            {"type": "notification", "notif_type": kind, "id": str(notif.id), "title": notif.title,
             "message": notif.message, "route": "/inbox"},
        )
        return
    for m in mails:
        notif = await repo.create(
            user_id,
            kind,
            f"New email from {_sender_name(m['from'])}",
            m["subject"],
            entity_type="gmail_thread",
            payload={"thread_id": m["thread_id"], "message_id": m["message_id"]},
        )
        await db.commit()
        await push(
            str(user_id),
            {"type": "notification", "notif_type": kind, "id": str(notif.id), "title": notif.title,
             "message": notif.message, "route": f"/inbox?thread={m['thread_id']}"},
        )


async def tick_for_user(user_id: uuid.UUID, get_db, push: PushFn) -> None:
    """Poll the mailbox bound to the current context and act on what changed."""
    if gs.get_credentials() is None:
        _cursors.pop(user_id, None)
        return
    loop = asyncio.get_running_loop()
    try:
        cursor, added, changed = await loop.run_in_executor(
            None, _poll_sync, _cursors.get(user_id)
        )
    except Exception as exc:  # noqa: BLE001 — network, quota, revoked grant
        logger.debug("gmail watch poll failed for %s: %s", user_id, exc)
        _cursors.pop(user_id, None)
        return
    _cursors[user_id] = cursor
    if not changed:
        return
    await push(str(user_id), {"type": "gmail_changed"})
    fresh = [m for m in added if _remember(user_id, m.get("id", ""))]
    if not fresh:
        return
    described = await asyncio.gather(
        *(loop.run_in_executor(None, _describe_sync, m["id"]) for m in fresh)
    )
    mails = [d for d in described if d]
    if not mails:
        return
    async for db in get_db():
        await _notify(db, user_id, mails, push)
        break


async def _tick_all(get_db, push: PushFn) -> None:
    if settings.hub_mode:
        from services import google_user_creds

        async for db in get_db():
            ids = await google_user_creds.users_with_credentials(db)
            break
        for uid in ids:
            token = google_user_creds.bind_user(uid)
            try:
                async for db in get_db():
                    await google_user_creds.load_into_cache(db, uid)
                    break
                await tick_for_user(uid, get_db, push)
            finally:
                google_user_creds.reset_user(token)
        return

    from services.assistant.daily_scan import _owner_user

    async for db in get_db():
        owner = await _owner_user(db)
        break
    if owner is not None:
        await tick_for_user(owner.id, get_db, push)


async def run(get_db, push: PushFn) -> None:
    """Background loop; started from the lifespan, never exits on its own."""
    await asyncio.sleep(10)
    while True:
        try:
            await _tick_all(get_db, push)
        except Exception:
            logger.exception("gmail watch tick error")
        await asyncio.sleep(POLL_SECONDS)


async def mark_thread_seen(db: AsyncSession, user_id: uuid.UUID, thread_id: str) -> int:
    """Opening a thread reads its new-email notifications. Caller commits."""
    result = await db.execute(
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.type == NotificationType.EMAIL_RECEIVED.value,
            Notification.is_read.is_(False),
            Notification.payload["thread_id"].astext == thread_id,
        )
        .values(is_read=True, read_at=func.now())
    )
    return result.rowcount or 0
