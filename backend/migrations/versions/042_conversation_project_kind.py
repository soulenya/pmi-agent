"""give a conversation a project and a kind

Revision ID: 042
Revises: 041
Create Date: 2026-09-08 00:00:00.000000

Every conversation was scoped to a user and nothing else, so the panel next to
a project could only find the project's conversation by walking backwards
through workrooms, and the history list could not tell a voice session from a
project chat from a one-off "Ask Gerry" question.

`project_id` is a bare uuid, not a foreign key: a local mirror of a hub
project's chat names a project that lives on the hub and not in this database.

`kind` is one of general | project | room | voice | routine | ask. Backfilled
from the joins and titles that already told the story, general otherwise.
"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS project_id uuid")
    op.execute(
        "ALTER TABLE conversations "
        "ADD COLUMN IF NOT EXISTS kind varchar(20) NOT NULL DEFAULT 'general'"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_conversations_project_id "
        "ON conversations (project_id) WHERE project_id IS NOT NULL"
    )
    # A workroom is the Gerry side of a project; its conversation is the
    # project's conversation.
    op.execute(
        """
        UPDATE conversations c
           SET project_id = w.project_id,
               kind = CASE WHEN w.project_id IS NULL THEN 'room' ELSE 'project' END
          FROM workrooms w
         WHERE w.conversation_id = c.id
        """
    )
    op.execute(
        """
        UPDATE conversations c
           SET kind = 'routine'
          FROM scheduled_tasks s
         WHERE s.conversation_id = c.id
           AND c.kind = 'general'
        """
    )
    op.execute(
        "UPDATE conversations SET kind = 'voice' "
        "WHERE kind = 'general' AND title = 'Voice session'"
    )
    # "Ask Gerry about this" titles its conversations after the thing asked about.
    op.execute(
        """
        UPDATE conversations SET kind = 'ask'
         WHERE kind = 'general'
           AND (title LIKE 'Task: %' OR title LIKE 'Project: %' OR title LIKE 'Email: %'
                OR title LIKE 'Attachment: %' OR title LIKE 'Event: %' OR title LIKE 'Contact: %'
                OR title LIKE 'Document: %' OR title LIKE 'File: %' OR title LIKE 'Draft: %')
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_conversations_project_id")
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS kind")
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS project_id")
