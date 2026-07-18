"""workrooms.share_file_id — shared rooms via Drive manifest

A shared room mirrors its definition (title, goal, pinned items) through a
JSON manifest file on the shared Drive. share_file_id links a local room to
its manifest; journals and conversations stay per-person.

Revision ID: 016
Revises: 015
Create Date: 2026-07-17 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE workrooms ADD COLUMN IF NOT EXISTS share_file_id varchar(255)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE workrooms DROP COLUMN IF EXISTS share_file_id")
