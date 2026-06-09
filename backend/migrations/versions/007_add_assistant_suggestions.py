"""assistant_suggestions table for the daily Gmail/Tasks assistant scan

Adds:
- assistant_suggestions table — one row per item surfaced by the daily scan
  (follow-up reminders, recommended tasks, auto-imported meeting summaries).
  Unique on (user_id, kind, source_id) so repeated daily scans never duplicate.

Revision ID: 007
Revises: 006
Create Date: 2026-06-09 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_suggestions (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id),
            kind varchar(40) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'pending',
            title varchar(500) NOT NULL,
            summary text,
            source_type varchar(40) NOT NULL,
            source_id varchar(255) NOT NULL,
            source_url varchar(1000),
            payload jsonb NOT NULL DEFAULT '{}',
            result_entity_type varchar(40),
            result_entity_id uuid,
            created_at timestamptz NOT NULL DEFAULT now(),
            resolved_at timestamptz
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assistant_suggestions_user_id "
        "ON assistant_suggestions (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assistant_suggestions_kind "
        "ON assistant_suggestions (kind)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assistant_suggestions_status "
        "ON assistant_suggestions (status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assistant_suggestions_created_at "
        "ON assistant_suggestions (created_at)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_suggestion_dedup "
        "ON assistant_suggestions (user_id, kind, source_id)"
    )
    # Hand ownership to the runtime role so the app (pmi_app) can access it.
    op.execute("ALTER TABLE assistant_suggestions OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS assistant_suggestions")
