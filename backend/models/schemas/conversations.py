"""Pydantic schemas for conversations, messages, approvals, and notifications."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from models.db.enums import ApprovalStatus, IntentType, RiskLevel


# ── Conversation ──────────────────────────────────────────────────────────────

class ConversationCreate(BaseModel):
    title: str | None = Field(None, max_length=500)
    agent_type: str | None = None


class ConversationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str | None
    agent_type: str | None
    is_pinned: bool
    is_archived: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    is_pinned: bool | None = None
    is_archived: bool | None = None


# ── Conversation attachments (reference files) ────────────────────────────────

class ChatAttachmentOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    file_name: str
    mime_type: str | None
    file_size_bytes: int | None
    char_count: int
    created_at: datetime

    model_config = {"from_attributes": True}



# ── Message ───────────────────────────────────────────────────────────────────

class MessageOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str
    agent_type: str | None
    model_name: str | None
    cited_chunk_ids: list[str]
    tool_calls: list[Any] | None
    tool_results: list[Any] | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Approvals ─────────────────────────────────────────────────────────────────

class ApprovalOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    intent_type: str
    intent_title: str
    intent_description: str | None
    intent_payload: dict[str, Any]
    risk_level: str
    status: str
    expires_at: datetime | None
    resolved_at: datetime | None
    rejection_reason: str | None
    created_at: datetime
    # Populated on approval execution — not stored in DB, set by resolve endpoint
    execution_result: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


class ResolveApprovalRequest(BaseModel):
    approved: bool
    rejection_reason: str | None = Field(None, max_length=1000)


class EditApprovalRequest(BaseModel):
    """Edit an editable field of a pending email approval before it is sent."""

    to: str | None = None
    cc: str | None = None
    subject: str | None = None
    body: str | None = None


# ── Notifications ─────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    type: str
    title: str
    message: str | None
    entity_type: str | None
    entity_id: uuid.UUID | None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── WebSocket message envelope ────────────────────────────────────────────────

class WSIncoming(BaseModel):
    """Client → server WebSocket message."""
    type: str = "human"  # "human" | "ping"
    content: str = ""


class WSToken(BaseModel):
    """Server → client: one streaming token chunk."""
    type: str = "token"
    content: str
    conversation_id: str


class WSToolStatus(BaseModel):
    """Server → client: tool call status update."""
    type: str = "tool_status"
    tool_name: str
    status: str  # "running" | "done"
    label: str
    conversation_id: str


class WSDone(BaseModel):
    """Server → client: stream finished."""
    type: str = "done"
    conversation_id: str
    message_id: str
    cited_chunk_ids: list[str] = Field(default_factory=list)


class WSError(BaseModel):
    """Server → client: error during generation."""
    type: str = "error"
    detail: str
