"""add_task_attachments_column

Revision ID: f07c8aa64867
Revises: 9a3c1f2e8b57
Create Date: 2026-06-05 16:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = 'f07c8aa64867'
down_revision = '9a3c1f2e8b57'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'
    """)


def downgrade() -> None:
    op.drop_column('tasks', 'attachments')
