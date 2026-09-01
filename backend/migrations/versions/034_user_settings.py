"""per-user settings

Revision ID: 034
Revises: 033
Create Date: 2026-09-01 00:00:00.000000

The hub is one install shared by several people, so preferences that used to be
a single SystemSetting row — daily scan on/off and its hour, conversation
backup on/off and its hour — have to be answerable per person. A missing row
means "use the system default", so nothing needs backfilling.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_settings (
            id         uuid PRIMARY KEY,
            user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key        varchar(100) NOT NULL,
            value      text,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_user_settings_user_key "
        "ON user_settings (user_id, key)"
    )
    op.execute("ALTER TABLE user_settings OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_settings")
