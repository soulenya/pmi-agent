"""conversation_attachments — chat reference files

Adds the conversation_attachments table for per-conversation reference/working
files. Unlike Knowledge Base documents these are not chunked or embedded; the
extracted plain text is stored on the row and injected into the conversation's
model context, while the original bytes live Fernet-encrypted on disk.

Revision ID: 010
Revises: 009
Create Date: 2026-06-16 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS conversation_attachments (
            id uuid PRIMARY KEY,
            conversation_id uuid NOT NULL
                REFERENCES conversations(id) ON DELETE CASCADE,
            file_name varchar(500) NOT NULL,
            mime_type varchar(255),
            file_size_bytes integer,
            stored_path text,
            extracted_text text,
            char_count integer NOT NULL DEFAULT 0,
            created_by uuid REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_conversation_attachments_conversation_id "
        "ON conversation_attachments (conversation_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_conversation_attachments_created_at "
        "ON conversation_attachments (created_at)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_conversation_attachments_created_at")
    op.execute("DROP INDEX IF EXISTS ix_conversation_attachments_conversation_id")
    op.execute("DROP TABLE IF EXISTS conversation_attachments")
