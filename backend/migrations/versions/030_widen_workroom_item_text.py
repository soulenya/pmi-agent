"""workroom_items.label/ref_id -> text

A "note" pin carries prose, not a title, so varchar(300) rejected real research
findings; the failed flush then poisoned the session and cost the whole
conversation turn. ref_id widens too because "website" pins store a URL.

Revision ID: 030
Revises: 029
Create Date: 2026-08-03 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE workroom_items ALTER COLUMN label TYPE text")
    op.execute("ALTER TABLE workroom_items ALTER COLUMN ref_id TYPE text")


def downgrade() -> None:
    # Narrowing would fail on any row that outgrew the old limit — truncate to fit.
    op.execute("UPDATE workroom_items SET label = left(label, 300)")
    op.execute("UPDATE workroom_items SET ref_id = left(ref_id, 500)")
    op.execute("ALTER TABLE workroom_items ALTER COLUMN label TYPE varchar(300)")
    op.execute("ALTER TABLE workroom_items ALTER COLUMN ref_id TYPE varchar(500)")
