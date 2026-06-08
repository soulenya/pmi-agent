"""add onboarding_complete flag to users

Adds:
- users.onboarding_complete boolean (default false) — tracks whether a user has
  finished the first-use setup wizard, so it is shown exactly once per user.

Revision ID: 006
Revises: 005
Create Date: 2026-06-09 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete "
        "boolean NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS onboarding_complete")
