"""Daily cleanup of unreviewed Gerry-generated email drafts.

Drafts Gerry creates (tagged ``gerry-reply``) that the user never reviews are
removed the next day, along with their still-pending ApprovalIntent, so the
Approvals queue and Email Drafts list don't accumulate stale items.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.approval import ApprovalIntent
from models.db.email_draft import EmailDraft
from models.db.enums import ApprovalStatus

logger = logging.getLogger(__name__)

GERRY_TAG = "gerry-reply"


async def cleanup_stale_gerry_drafts(db: AsyncSession) -> dict:
    """Delete unreviewed Gerry drafts created before today (local time).

    Only drafts still in ``pending_approval`` are removed; once the user has
    approved/rejected/sent one it is left alone. Each draft's still-pending
    ApprovalIntent is deleted too so it disappears from the Approvals queue.
    Returns ``{"deleted": n}``.
    """
    local_now = datetime.now(timezone.utc).astimezone()
    cutoff = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    rows = (
        await db.execute(
            select(EmailDraft).where(
                EmailDraft.tags.any(GERRY_TAG),
                EmailDraft.status == "pending_approval",
                EmailDraft.created_at < cutoff,
            )
        )
    ).scalars().all()

    deleted = 0
    for draft in rows:
        intent_id = draft.approval_intent_id
        await db.delete(draft)
        if intent_id:
            intent = (
                await db.execute(
                    select(ApprovalIntent).where(ApprovalIntent.id == intent_id)
                )
            ).scalar_one_or_none()
            if intent is not None and intent.status == ApprovalStatus.PENDING:
                await db.delete(intent)
        deleted += 1

    await db.commit()
    if deleted:
        logger.info("Cleaned up %s unreviewed Gerry draft(s)", deleted)
    return {"deleted": deleted}
