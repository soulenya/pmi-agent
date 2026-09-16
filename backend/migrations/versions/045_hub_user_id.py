"""hub_links.hub_user_id — who this person is on the hub

Revision ID: 045
Revises: 044
Create Date: 2026-09-16 00:00:00.000000

The desktop and the hub give the same person different user ids. Anything
that moves personal work between the two needs to know both, so the link
row remembers the hub's id for its owner. Nullable: filled on the next
connect or status check.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "045"
down_revision = "044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE hub_links ADD COLUMN IF NOT EXISTS hub_user_id uuid")


def downgrade() -> None:
    op.execute("ALTER TABLE hub_links DROP COLUMN IF EXISTS hub_user_id")
