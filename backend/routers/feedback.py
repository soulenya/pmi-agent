"""Feedback API — users submit bug reports / feature requests; the configured
owner (or all admins) receives them as notifications."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from dependencies import get_current_user
from models.db.enums import NotificationType
from models.db.feedback import Feedback
from models.db.user import User
from repositories.conversation_repo import NotificationRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["feedback"])

_VALID_CATEGORIES = {"bug", "feature"}


class FeedbackCreate(BaseModel):
    category: str = Field(..., description='"bug" or "feature"')
    message: str = Field(..., min_length=1, max_length=5000)


class FeedbackOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    category: str
    message: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


async def _recipient_ids(db: AsyncSession) -> list[uuid.UUID]:
    """Resolve who receives feedback: the configured owner, else all admins."""
    owner = (
        await db.execute(
            select(User).where(User.email == settings.feedback_recipient_email)
        )
    ).scalar_one_or_none()
    if owner is not None:
        return [owner.id]
    admins = (
        await db.execute(select(User).where(User.role == "admin"))
    ).scalars().all()
    return [a.id for a in admins]


@router.post("", response_model=FeedbackOut, status_code=status.HTTP_201_CREATED)
async def submit_feedback(
    body: FeedbackCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FeedbackOut:
    category = body.category.strip().lower()
    if category not in _VALID_CATEGORIES:
        category = "feature"
    message = body.message.strip()

    feedback = Feedback(user_id=current_user.id, category=category, message=message)
    db.add(feedback)
    await db.flush()
    await db.refresh(feedback)

    # Notify the owner (or all admins) so submissions land in their inbox.
    submitter = current_user.display_name or current_user.email
    label = "Bug report" if category == "bug" else "Feature request"
    preview = message if len(message) <= 140 else message[:139] + "…"
    notif_repo = NotificationRepository(db)
    recipients = await _recipient_ids(db)
    for uid in recipients:
        await notif_repo.create(
            user_id=uid,
            type=NotificationType.FEEDBACK_SUBMITTED.value,
            title=f"{label} from {submitter}",
            message=preview,
            entity_type="feedback",
            entity_id=feedback.id,
        )

    await db.commit()
    await db.refresh(feedback)

    # Best-effort real-time push to any connected recipient sockets.
    try:
        from main import notification_manager

        for uid in recipients:
            await notification_manager.push(
                str(uid),
                {
                    "type": "notification",
                    "title": f"{label} from {submitter}",
                    "notif_type": NotificationType.FEEDBACK_SUBMITTED.value,
                },
            )
    except Exception:  # pragma: no cover — push is best-effort
        logger.debug("Feedback notification push failed", exc_info=True)

    return FeedbackOut.model_validate(feedback)
