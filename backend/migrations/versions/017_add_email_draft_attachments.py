"""email_drafts.attachments — drafts can carry generated-file attachments

Each entry is {"filename": <safe name in generated_files/>, "display_name":
<clean name shown to the user>}. Attachments ride the approval payload and are
attached to the outgoing Gmail message on approved send.

Revision ID: 017
Revises: 016
Create Date: 2026-07-20 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE email_drafts "
        "ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE email_drafts DROP COLUMN IF EXISTS attachments")
