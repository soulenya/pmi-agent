"""the desktop's link to the hub

Revision ID: 036
Revises: 035
Create Date: 2026-09-02 00:00:00.000000

One row per person rather than one per machine: the desktop acts as whoever is
signed in, so the credential has to be theirs. Unique on user_id so a second
sign-in replaces the first instead of quietly leaving two live tokens behind.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS hub_links (
            id                      uuid PRIMARY KEY,
            user_id                 uuid NOT NULL UNIQUE
                                    REFERENCES users(id) ON DELETE CASCADE,
            hub_url                 varchar(500) NOT NULL,
            email                   varchar(320) NOT NULL,
            refresh_token_encrypted text NOT NULL,
            created_at              timestamptz NOT NULL DEFAULT now(),
            last_ok_at              timestamptz,
            last_error              text
        )
        """
    )
    op.execute("ALTER TABLE hub_links OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS hub_links")
