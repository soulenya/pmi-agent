"""browser_bookmarks — saved pages for the in-app research browser

Revision ID: 032
Revises: 031
Create Date: 2026-08-24 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS browser_bookmarks (
            id          uuid PRIMARY KEY,
            user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            url         text NOT NULL,
            title       varchar(300) NOT NULL DEFAULT '',
            created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_browser_bookmarks_user_id "
        "ON browser_bookmarks (user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS browser_bookmarks")
