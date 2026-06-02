"""Add meeting_notes and email_drafts tables.

Revision ID: 9a3c1f2e8b57
Revises: 615f52d537b5
Create Date: 2026-06-02 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "9a3c1f2e8b57"
down_revision: Union[str, None] = "615f52d537b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "meeting_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("raw_transcript", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("decisions", sa.Text(), nullable=True),
        sa.Column("action_items", sa.Text(), nullable=True),
        sa.Column("next_steps", sa.Text(), nullable=True),
        sa.Column("meeting_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attendees", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("generated_task_ids", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_meeting_notes_created_by", "meeting_notes", ["created_by"])
    op.create_index("ix_meeting_notes_created_at", "meeting_notes", ["created_at"])

    op.create_table(
        "email_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("recipient_name", sa.String(255), nullable=True),
        sa.Column("recipient_email", sa.String(255), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("tone", sa.String(50), nullable=False, server_default="professional"),
        sa.Column("key_points", sa.Text(), nullable=True),
        sa.Column("draft_body", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
        sa.Column("approval_intent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_email_drafts_created_by", "email_drafts", ["created_by"])
    op.create_index("ix_email_drafts_status", "email_drafts", ["status"])


def downgrade() -> None:
    op.drop_table("email_drafts")
    op.drop_table("meeting_notes")
