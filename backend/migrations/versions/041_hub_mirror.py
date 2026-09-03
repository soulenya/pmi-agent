"""keep a local copy of a hub conversation

Revision ID: 041
Revises: 040
Create Date: 2026-09-03 00:00:00.000000

A shared project's chat used to run on the hub, where there is no knowledge
base, no Drive token and no Gmail — so Gerry answered every question there
blind. She runs at home now instead, against a local copy of the conversation
carrying the hub's own ids, and the two are reconciled around each turn.

`hub_mirror` marks a conversation as that copy. `hub_synced` marks a message as
one the hub already has, whether it was pulled from there or pushed to it, so a
turn only ever sends what is new.
"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE conversations "
        "ADD COLUMN IF NOT EXISTS hub_mirror boolean NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE messages "
        "ADD COLUMN IF NOT EXISTS hub_synced boolean NOT NULL DEFAULT false"
    )
    # Every turn asks "what has not gone up yet", against one conversation.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_messages_unsynced "
        "ON messages (conversation_id) WHERE hub_synced = false"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_messages_unsynced")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS hub_synced")
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS hub_mirror")
