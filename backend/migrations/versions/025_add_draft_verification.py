"""email_drafts.verification — fact-check audit trail on agent-drafted emails

{"sources": [str], "flags": [str], "recorded_at": iso}: sources the drafting
agent verified claims against, and claims it could NOT verify (shown as
warnings on the draft card). Standing rule after the stale "PMI Snapshot"
email of 2026-07-27.

Revision ID: 025
Revises: 024
Create Date: 2026-07-27 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS verification jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE email_drafts DROP COLUMN IF EXISTS verification")
