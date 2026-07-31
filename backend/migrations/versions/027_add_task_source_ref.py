"""tasks.source_ref — what the task is about, so the UI can link straight to it

A task created from an email, a document review, a meeting or a workroom used to
lose every trace of where it came from. This column records {kind, id, label,
url} so the task list can offer "open the thing" instead of dead-ending.

Revision ID: 027
Revises: 026
Create Date: 2026-07-30 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_ref jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS source_ref")
