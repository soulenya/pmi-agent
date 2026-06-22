"""device_tokens table

Stores APNs (and future) push registrations, one row per physical device. The
token is unique; a device re-registering on launch updates its existing row.

Revision ID: 013
Revises: 012
Create Date: 2026-06-19 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS device_tokens (
            id           uuid PRIMARY KEY,
            user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token        varchar(512) NOT NULL,
            platform     varchar(20) NOT NULL DEFAULT 'ios',
            app_version  varchar(50),
            created_at   timestamptz NOT NULL DEFAULT now(),
            last_seen_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_device_token UNIQUE (token)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_device_tokens_user_id ON device_tokens (user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS device_tokens")
