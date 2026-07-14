"""Feedback API — users submit bug reports / feature requests; the configured
owner (or all admins) receives them as notifications."""

from __future__ import annotations

import asyncio
import logging
import platform
import uuid
from datetime import datetime
from pathlib import Path

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
    include_diagnostics: bool = Field(
        True, description="Attach app version, OS and recent log tails (bug reports)."
    )


# Log files worth attaching to a bug report — covers backend crashes, launcher
# crashes, and failed auto-updates (the field-diagnosis trifecta).
_DIAGNOSTIC_LOGS = (
    "backend_stderr.log",
    "launcher.log",
    "apply_update.log",
    "inno_update.log",
    "update_attempt.json",
)
_MAX_LOG_BYTES = 100_000  # tail per file


def _collect_diagnostics() -> tuple[str, list[dict]]:
    """Environment summary + recent log tails as email attachments. Never raises."""
    root = Path(__file__).resolve().parents[2]
    version = "unknown"
    try:
        version = (root / "VERSION").read_text(encoding="utf-8").strip()
    except Exception:
        pass
    summary = (
        f"App version: {version}\n"
        f"OS: {platform.platform()}\n"
        f"Python: {platform.python_version()}\n"
    )
    attachments: list[dict] = []
    log_dir = root / "backend" / "logs"
    for name in _DIAGNOSTIC_LOGS:
        try:
            p = log_dir / name
            if p.is_file() and p.stat().st_size > 0:
                attachments.append({
                    "filename": name,
                    "mime_type": "text/plain",
                    "data": p.read_bytes()[-_MAX_LOG_BYTES:],
                })
        except Exception:
            continue
    return summary, attachments


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

    # Cross-install delivery: Little Gerry is local-first, so the notifications
    # above only reach admins on THIS machine's database. Email the report (via
    # the submitter's connected Gmail) to the configured owner so bug reports
    # from teammates' installs actually arrive — with logs attached for bugs.
    try:
        import services.google_service as gs

        if gs.get_credentials() and settings.feedback_recipient_email:
            diag_summary, attachments = ("", [])
            if category == "bug" and body.include_diagnostics:
                diag_summary, attachments = _collect_diagnostics()
            email_body = (
                f"{label} from {submitter} ({current_user.email}):\n\n{message}\n"
                + (f"\n--- Diagnostics ---\n{diag_summary}" if diag_summary else "")
            )
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: gs.gmail_send(
                    to=settings.feedback_recipient_email,
                    subject=f"[Little Gerry] {label} from {submitter}",
                    body=email_body,
                    attachments=attachments,
                ),
            )
    except Exception:  # pragma: no cover — email is best-effort
        logger.warning("Feedback email delivery failed", exc_info=True)

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
