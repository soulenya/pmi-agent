"""Notification generator — creates DB Notification records for overdue tasks and expiring approvals."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.approval import ApprovalIntent
from models.db.enums import ApprovalStatus, NotificationType, TaskStatus
from models.db.notification import Notification
from models.db.task import Task
from repositories.conversation_repo import NotificationRepository

logger = logging.getLogger(__name__)


async def generate_notifications(db: AsyncSession) -> list[Notification]:
    """
    Scan for overdue tasks and approvals expiring within 24 h.
    Creates a Notification record for each if one hasn't been created in the last 24 h.
    Commits and returns the list of newly created Notification objects.
    """
    created: list[Notification] = []
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)

    # ── 1. Overdue tasks ───────────────────────────────────────────────────────
    overdue_tasks_result = await db.execute(
        select(Task).where(
            Task.due_date < now,
            Task.status.notin_([TaskStatus.DONE, TaskStatus.CANCELLED]),
        )
    )
    overdue_tasks = list(overdue_tasks_result.scalars())

    for task in overdue_tasks:
        user_id = task.assignee_id or task.created_by
        if user_id is None:
            continue

        # Deduplicate: skip if already notified in last 24 h
        existing = (
            await db.execute(
                select(Notification).where(
                    Notification.entity_type == "task",
                    Notification.entity_id == task.id,
                    Notification.type == NotificationType.TASK_DUE,
                    Notification.created_at >= window_start,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue

        due_label = task.due_date.date() if task.due_date else "unknown"
        repo = NotificationRepository(db)
        notif = await repo.create(
            user_id=user_id,
            type=NotificationType.TASK_DUE,
            title=f"Overdue: {task.title[:100]}",
            message=f"Task was due on {due_label}.",
            entity_type="task",
            entity_id=task.id,
        )
        created.append(notif)
        logger.debug("Created overdue notification for task %s", task.id)

    # ── 2. Approvals expiring within 24 h ──────────────────────────────────────
    soon = now + timedelta(hours=24)
    expiring_result = await db.execute(
        select(ApprovalIntent).where(
            ApprovalIntent.status == ApprovalStatus.PENDING,
            ApprovalIntent.expires_at.isnot(None),
            ApprovalIntent.expires_at > now,
            ApprovalIntent.expires_at <= soon,
        )
    )
    expiring = list(expiring_result.scalars())

    for approval in expiring:
        existing = (
            await db.execute(
                select(Notification).where(
                    Notification.entity_type == "approval",
                    Notification.entity_id == approval.id,
                    Notification.type == NotificationType.APPROVAL_REQUIRED,
                    Notification.created_at >= window_start,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue

        repo = NotificationRepository(db)
        notif = await repo.create(
            user_id=approval.user_id,
            type=NotificationType.APPROVAL_REQUIRED,
            title=f"Approval expiring: {approval.intent_title[:100]}",
            message="This approval request expires in less than 24 hours.",
            entity_type="approval",
            entity_id=approval.id,
        )
        created.append(notif)
        logger.debug("Created expiry notification for approval %s", approval.id)

    if created:
        await db.commit()

    return created
