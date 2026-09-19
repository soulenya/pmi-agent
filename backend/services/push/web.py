"""Web Push to the phones and browsers a person has subscribed.

Rides on the notification rows the desktop bell already shows: every
``NotificationRepository.create`` schedules a push to that person's
subscriptions. Sending happens after the caller's transaction, in its own
session, and never raises into the caller — a phone that cannot be reached
must not cost the notification itself.

Keys: a VAPID pair in ``settings.vapid_public_key`` / ``vapid_private_key``
(base64url raw keys). Blank keys turn the feature off.

(``services.push.apns`` beside this is an APNs stub for an iOS app that was
never built; nothing calls it.)
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import AsyncSessionLocal
from models.db.push_subscription import PushSubscription

logger = logging.getLogger(__name__)

_TTL_SECONDS = 24 * 3600
# Where a notification of each kind opens; mirrors the frontend's notificationRoute.
_ROUTES = {
    "chat_mention": "/team?channel={entity_id}",
    "approval_required": "/waiting?tab=approvals",
    "task_due": "/tasks",
    "task_assigned": "/tasks",
    "briefing_ready": "/today",
    "document_ingested": "/documents",
    "research_complete": "/research",
}


def configured() -> bool:
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def route_for(
    type_: str,
    entity_type: str | None,
    entity_id: uuid.UUID | None,
    payload: dict | None = None,
) -> str:
    if type_ == "email_received":
        thread = (payload or {}).get("thread_id")
        return f"/inbox?thread={thread}" if thread else "/inbox"
    if entity_type == "email_draft":
        return "/inbox?view=drafts"
    if entity_type == "assistant_suggestion":
        return "/waiting?tab=suggestions"
    template = _ROUTES.get(type_)
    if template is None:
        return "/waiting?tab=notifications"
    if "{entity_id}" in template:
        return template.format(entity_id=entity_id) if entity_id else "/team"
    return template


async def subscribe(
    db: AsyncSession,
    user_id: uuid.UUID,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
) -> PushSubscription:
    """Record a browser's subscription; an endpoint already known is re-owned."""
    row = (
        await db.execute(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    ).scalar_one_or_none()
    if row is None:
        row = PushSubscription(endpoint=endpoint)
        db.add(row)
    row.user_id = user_id
    row.p256dh = p256dh
    row.auth = auth
    row.user_agent = (user_agent or "")[:300] or None
    await db.flush()
    return row


async def unsubscribe(db: AsyncSession, user_id: uuid.UUID, endpoint: str) -> bool:
    result = await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == endpoint, PushSubscription.user_id == user_id
        )
    )
    return (result.rowcount or 0) > 0


async def list_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[PushSubscription]:
    return list(
        (
            await db.execute(
                select(PushSubscription)
                .where(PushSubscription.user_id == user_id)
                .order_by(PushSubscription.created_at)
            )
        ).scalars()
    )


def _send_sync(sub: PushSubscription, payload: str) -> int | None:
    """One delivery. Returns the HTTP status the push service gave, or None on failure."""
    from pywebpush import WebPushException, webpush

    try:
        resp = webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=_TTL_SECONDS,
        )
        return resp.status_code
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        logger.info("push to %s… failed: %s", sub.endpoint[:40], status or exc)
        return status
    except Exception as exc:  # noqa: BLE001 — a bad endpoint must not stop the others
        logger.warning("push to %s… errored: %s", sub.endpoint[:40], exc)
        return None


async def send_to_user(
    user_id: uuid.UUID,
    title: str,
    body: str | None,
    url: str,
    tag: str | None = None,
) -> int:
    """Push one message to every subscription this person holds. Returns deliveries."""
    if not configured():
        return 0
    payload = json.dumps(
        {"title": title[:120], "body": (body or "")[:300], "url": url, "tag": tag or url}
    )
    delivered = 0
    async with AsyncSessionLocal() as db:
        subs = await list_for_user(db, user_id)
        if not subs:
            return 0
        results = await asyncio.gather(
            *(asyncio.to_thread(_send_sync, s, payload) for s in subs)
        )
        gone = [s.id for s, status in zip(subs, results) if status in (404, 410)]
        ok = [s.id for s, status in zip(subs, results) if status is not None and 200 <= status < 300]
        if gone:
            await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(gone)))
        if ok:
            await db.execute(
                update(PushSubscription)
                .where(PushSubscription.id.in_(ok))
                .values(last_used_at=datetime.now(timezone.utc))
            )
        await db.commit()
        delivered = len(ok)
    return delivered


def schedule(
    user_id: uuid.UUID,
    title: str,
    body: str | None,
    url: str,
    tag: str | None = None,
) -> None:
    """Fire-and-forget from inside a request or job. Never raises."""
    if not configured():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    async def _run() -> None:
        try:
            await send_to_user(user_id, title, body, url, tag)
        except Exception:  # noqa: BLE001
            logger.exception("push delivery failed")

    loop.create_task(_run())
