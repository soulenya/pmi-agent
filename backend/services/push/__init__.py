"""Push notification package.

`push_to_user` is the high-level entry point: look up a user's registered device
tokens, send an APNs alert, and prune any tokens APNs reports as dead. It is a
safe no-op when APNs is not configured, so callers can fire it unconditionally.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.device_token import DeviceToken
from services.push import apns

logger = logging.getLogger(__name__)

__all__ = ["apns", "push_to_user"]


async def push_to_user(
    db: AsyncSession,
    user_id: uuid.UUID | str,
    title: str,
    body: str,
    data: dict | None = None,
) -> None:
    """Send an APNs alert to every device registered to ``user_id``.

    No-ops when APNs is unconfigured or the user has no registered devices.
    Tokens APNs reports as permanently invalid are deleted.
    """
    if not apns.is_configured():
        return

    rows = (
        await db.execute(
            select(DeviceToken).where(DeviceToken.user_id == user_id)
        )
    ).scalars().all()
    tokens = [r.token for r in rows]
    if not tokens:
        return

    invalid = await apns.send_push(tokens, title, body, data)
    if invalid:
        await db.execute(delete(DeviceToken).where(DeviceToken.token.in_(invalid)))
        await db.commit()
        logger.info("Pruned %d dead device token(s)", len(invalid))
