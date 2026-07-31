"""users.writing_voice_profile — a personal description of how someone writes

Gerry reads this before drafting an email so the words sound like the person
sending them. It is deliberately per-user rather than a system setting: a voice
profile describes one individual and must never leak into someone else's drafts.

Revision ID: 028
Revises: 027
Create Date: 2026-07-30 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS writing_voice_profile text")
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS writing_voice_for_documents "
        "boolean NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS writing_voice_updated_at "
        "timestamptz"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS writing_voice_updated_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS writing_voice_for_documents")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS writing_voice_profile")
