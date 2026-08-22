"""users.onboarding_version — lets a new wizard step reach existing users

The old boolean only said "has this person seen the wizard at all", so anyone
who finished it once could never be shown a step added later. Recording which
version of the wizard they completed means an update can offer just the new
steps.

Existing users are backfilled to version 1 (the nine-step wizard shipped
before v3.3.54) rather than 0, so they are not sent through setup again.

Revision ID: 031
Revises: 030
Create Date: 2026-08-22 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_version "
        "integer NOT NULL DEFAULT 0"
    )
    op.execute(
        "UPDATE users SET onboarding_version = 1 "
        "WHERE onboarding_complete AND onboarding_version = 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS onboarding_version")
