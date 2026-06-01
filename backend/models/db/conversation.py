"""Conversation, Message, and AgentRun ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.db.base import Base
from models.db.enums import AgentType, MessageRole


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    agent_type: Mapped[AgentType | None] = mapped_column(String(50), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[list[Message]] = relationship(
        "Message", back_populates="conversation", cascade="all, delete-orphan",
        order_by="Message.created_at"
    )
    agent_runs: Mapped[list[AgentRun]] = relationship(
        "AgentRun", back_populates="conversation"
    )

    def __repr__(self) -> str:
        return f"<Conversation id={self.id} title={self.title!r}>"


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    agent_type: Mapped[AgentType] = mapped_column(String(50), nullable=False)

    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # running | completed | failed | interrupted
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="running", index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # LangGraph checkpoint for resumability
    graph_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    conversation: Mapped[Conversation | None] = relationship(
        "Conversation", back_populates="agent_runs"
    )
    messages: Mapped[list[Message]] = relationship("Message", back_populates="agent_run")

    def __repr__(self) -> str:
        return f"<AgentRun id={self.id} agent={self.agent_type} status={self.status}>"


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[MessageRole] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    agent_type: Mapped[AgentType | None] = mapped_column(String(50), nullable=True)
    agent_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agent_runs.id"), nullable=True, index=True
    )

    model_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # RAG citations — array of chunk UUIDs
    cited_chunk_ids: Mapped[list[str]] = mapped_column(
        ARRAY(UUID(as_uuid=False)), nullable=False, default=list
    )

    tool_calls: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)
    tool_results: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )

    conversation: Mapped[Conversation] = relationship("Conversation", back_populates="messages")
    agent_run: Mapped[AgentRun | None] = relationship("AgentRun", back_populates="messages")

    def __repr__(self) -> str:
        return f"<Message id={self.id} role={self.role} conv={self.conversation_id}>"
