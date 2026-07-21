"""meeting_notes.kb_document_id + email_drafts cc/bcc — field-report fixes

1. Meeting notes remember the KB document they were ingested as, so the
   "Add to KB" action can refuse duplicates (and show state in the UI).
2. Email drafts carry CC/BCC recipients through the approval flow to the
   outgoing Gmail message.

Revision ID: 019
Revises: 018
Create Date: 2026-07-21 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS kb_document_id uuid"
    )
    op.execute("ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS cc varchar(500)")
    op.execute("ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS bcc varchar(500)")


def downgrade() -> None:
    op.execute("ALTER TABLE meeting_notes DROP COLUMN IF EXISTS kb_document_id")
    op.execute("ALTER TABLE email_drafts DROP COLUMN IF EXISTS cc")
    op.execute("ALTER TABLE email_drafts DROP COLUMN IF EXISTS bcc")
