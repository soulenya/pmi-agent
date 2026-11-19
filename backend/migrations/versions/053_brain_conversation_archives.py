"""brain_conversation_archives — which conversations the hub has stored in the company brain

Revision ID: 053
Revises: 052
Create Date: 2026-11-18 00:00:00.000000

One row per conversation with a page in GBrain, holding the number of messages
that page was written from. The hub's background pass re-writes a page when
the conversation's own count differs, and removes the page when the row's
conversation is gone. No foreign key: the row must survive the conversation's
deletion, since it is the only record that a page still needs removing.

Empty on a desktop, and on a hub that does not keep conversations in the brain.
"""
from __future__ import annotations

from alembic import op
from migrations._roles import APP_ROLE

# revision identifiers, used by Alembic.
revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS brain_conversation_archives (
            conversation_id  uuid PRIMARY KEY,
            message_count    integer NOT NULL DEFAULT 0,
            archived_at      timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        f"""
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                ALTER TABLE brain_conversation_archives OWNER TO {APP_ROLE};
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS brain_conversation_archives")
