"""Repositories for Conversation, Message, ApprovalIntent, and Notification."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.approval import ApprovalIntent
from models.db.conversation import Conversation, ConversationAttachment, Message
from models.db.enums import ApprovalStatus, MessageRole
from models.db.notification import Notification


class ConversationRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        user_id: uuid.UUID,
        title: str | None = None,
        agent_type: str | None = None,
    ) -> Conversation:
        conv = Conversation(user_id=user_id, title=title, agent_type=agent_type)
        self.db.add(conv)
        await self.db.flush()
        await self.db.refresh(conv)
        return conv

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        include_archived: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Conversation]:
        stmt = (
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.is_pinned.desc(), Conversation.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if not include_archived:
            stmt = stmt.where(Conversation.is_archived.is_(False))
        result = await self.db.execute(stmt)
        return list(result.scalars())

    async def get(self, conv_id: uuid.UUID, user_id: uuid.UUID) -> Conversation | None:
        result = await self.db.execute(
            select(Conversation).where(
                Conversation.id == conv_id,
                Conversation.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def update(self, conv: Conversation, **fields: Any) -> Conversation:
        for k, v in fields.items():
            setattr(conv, k, v)
        conv.updated_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(conv)
        return conv


class MessageRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        conversation_id: uuid.UUID,
        role: MessageRole,
        content: str,
        agent_type: str | None = None,
        agent_run_id: uuid.UUID | None = None,
        model_name: str | None = None,
        cited_chunk_ids: list[str] | None = None,
        tool_calls: list[Any] | None = None,
        tool_results: list[Any] | None = None,
    ) -> Message:
        msg = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            agent_type=agent_type,
            agent_run_id=agent_run_id,
            model_name=model_name,
            cited_chunk_ids=cited_chunk_ids or [],
            tool_calls=tool_calls or [],
            tool_results=tool_results or [],
        )
        self.db.add(msg)
        await self.db.flush()
        await self.db.refresh(msg)
        return msg

    async def list_for_conversation(
        self,
        conversation_id: uuid.UUID,
        limit: int = 100,
        before_id: uuid.UUID | None = None,
        most_recent: bool = False,
    ) -> list[Message]:
        """Return messages for a conversation in chronological (oldest→newest) order.

        With ``most_recent=True`` the *newest* ``limit`` messages are selected
        (then returned oldest→newest). This matters for agent history: a plain
        ``ORDER BY created_at ASC LIMIT n`` returns the OLDEST ``n`` messages, so
        in a long conversation the just-saved user turn would be dropped and the
        window could end on an assistant message — which Anthropic rejects with
        "the conversation must end with a user message" on models that disallow
        assistant prefill. ``most_recent`` is ignored when paginating via
        ``before_id``.
        """
        if most_recent and before_id is None:
            # Take the newest `limit` rows, then restore chronological order.
            stmt = (
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at.desc())
                .limit(limit)
            )
            result = await self.db.execute(stmt)
            return list(reversed(result.scalars().all()))

        stmt = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
            .limit(limit)
        )
        if before_id is not None:
            # Pagination: messages created before the given message id
            sub = select(Message.created_at).where(Message.id == before_id).scalar_subquery()
            stmt = stmt.where(Message.created_at < sub)
        result = await self.db.execute(stmt)
        return list(result.scalars())


class ConversationAttachmentRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        conversation_id: uuid.UUID,
        file_name: str,
        mime_type: str | None,
        file_size_bytes: int | None,
        stored_path: str | None,
        extracted_text: str | None,
        char_count: int,
        created_by: uuid.UUID | None = None,
    ) -> ConversationAttachment:
        att = ConversationAttachment(
            conversation_id=conversation_id,
            file_name=file_name,
            mime_type=mime_type,
            file_size_bytes=file_size_bytes,
            stored_path=stored_path,
            extracted_text=extracted_text,
            char_count=char_count,
            created_by=created_by,
        )
        self.db.add(att)
        await self.db.flush()
        await self.db.refresh(att)
        return att

    async def list_for_conversation(
        self, conversation_id: uuid.UUID
    ) -> list[ConversationAttachment]:
        result = await self.db.execute(
            select(ConversationAttachment)
            .where(ConversationAttachment.conversation_id == conversation_id)
            .order_by(ConversationAttachment.created_at.asc())
        )
        return list(result.scalars())

    async def get(
        self, attachment_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> ConversationAttachment | None:
        result = await self.db.execute(
            select(ConversationAttachment).where(
                ConversationAttachment.id == attachment_id,
                ConversationAttachment.conversation_id == conversation_id,
            )
        )
        return result.scalar_one_or_none()

    async def delete(self, att: ConversationAttachment) -> None:
        await self.db.delete(att)
        await self.db.flush()


class ApprovalRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        user_id: uuid.UUID,
        intent_type: str,
        intent_title: str,
        intent_payload: dict[str, Any],
        risk_level: str = "low",
        intent_description: str | None = None,
        expires_at: datetime | None = None,
        agent_run_id: uuid.UUID | None = None,
    ) -> ApprovalIntent:
        intent = ApprovalIntent(
            user_id=user_id,
            intent_type=intent_type,
            intent_title=intent_title,
            intent_description=intent_description,
            intent_payload=intent_payload,
            risk_level=risk_level,
            expires_at=expires_at,
            agent_run_id=agent_run_id,
        )
        self.db.add(intent)
        await self.db.flush()
        await self.db.refresh(intent)
        return intent

    async def list_pending(self, user_id: uuid.UUID, limit: int = 50) -> list[ApprovalIntent]:
        result = await self.db.execute(
            select(ApprovalIntent)
            .where(
                ApprovalIntent.user_id == user_id,
                ApprovalIntent.status == ApprovalStatus.PENDING,
            )
            .order_by(ApprovalIntent.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars())

    async def get(self, intent_id: uuid.UUID, user_id: uuid.UUID) -> ApprovalIntent | None:
        result = await self.db.execute(
            select(ApprovalIntent).where(
                ApprovalIntent.id == intent_id,
                ApprovalIntent.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def resolve(
        self,
        intent: ApprovalIntent,
        approved: bool,
        resolved_by: uuid.UUID,
        rejection_reason: str | None = None,
    ) -> ApprovalIntent:
        intent.status = ApprovalStatus.APPROVED if approved else ApprovalStatus.REJECTED
        intent.resolved_by = resolved_by
        intent.resolved_at = datetime.now(timezone.utc)
        intent.rejection_reason = rejection_reason
        await self.db.flush()
        await self.db.refresh(intent)
        return intent

    async def count_pending(self, user_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.count()).where(
                ApprovalIntent.user_id == user_id,
                ApprovalIntent.status == ApprovalStatus.PENDING,
            )
        )
        return result.scalar_one()

    async def delete_expired(self, user_id: uuid.UUID) -> int:
        """Delete all expired pending approval intents for a user. Returns count deleted."""
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            select(ApprovalIntent).where(
                ApprovalIntent.user_id == user_id,
                ApprovalIntent.status == ApprovalStatus.PENDING,
                ApprovalIntent.expires_at <= now,
            )
        )
        expired = list(result.scalars())
        for intent in expired:
            await self.db.delete(intent)
        await self.db.flush()
        return len(expired)


class NotificationRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        user_id: uuid.UUID,
        type: str,
        title: str,
        message: str | None = None,
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
    ) -> Notification:
        notif = Notification(
            user_id=user_id,
            type=type,
            title=title,
            message=message,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        self.db.add(notif)
        await self.db.flush()
        await self.db.refresh(notif)
        return notif

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        unread_only: bool = False,
        limit: int = 50,
    ) -> list[Notification]:
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
        if unread_only:
            stmt = stmt.where(Notification.is_read.is_(False))
        result = await self.db.execute(stmt)
        return list(result.scalars())

    async def mark_read(self, notif_id: uuid.UUID, user_id: uuid.UUID) -> None:
        await self.db.execute(
            update(Notification)
            .where(Notification.id == notif_id, Notification.user_id == user_id)
            .values(is_read=True, read_at=datetime.now(timezone.utc))
        )

    async def mark_all_read(self, user_id: uuid.UUID) -> None:
        await self.db.execute(
            update(Notification)
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
            .values(is_read=True, read_at=datetime.now(timezone.utc))
        )
