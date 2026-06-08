"""feedback table for user-submitted bug reports / feature requests

Adds:
- feedback table — stores each submission (category bug|feature, message, status).
  Submissions also fan out to the configured owner's notifications at runtime.

Revision ID: 005
Revises: 004
Create Date: 2026-06-09 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS feedback (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id),
            category varchar(20) NOT NULL,
            message text NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'open',
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_feedback_user_id ON feedback (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_feedback_status ON feedback (status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_feedback_created_at ON feedback (created_at)"
    )
    # Hand ownership to the runtime role so the app (pmi_app) can access it.
    op.execute("ALTER TABLE feedback OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS feedback")
