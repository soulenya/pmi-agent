"""email_drafts.thread_id / reply_to_message_id — a chat-drafted reply threads properly

Revision ID: 049
Revises: 048
Create Date: 2026-10-05 00:00:00.000000

Drafts made from the Inbox already carried Gmail threading in the approval
payload; drafts Gerry wrote in chat did not, so an approved "reply" went out
as a new conversation. The draft row now remembers the thread.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS thread_id varchar(255)")
    op.execute("ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS reply_to_message_id varchar(255)")


def downgrade() -> None:
    op.execute("ALTER TABLE email_drafts DROP COLUMN IF EXISTS reply_to_message_id")
    op.execute("ALTER TABLE email_drafts DROP COLUMN IF EXISTS thread_id")
