"""document_extractions.content_sha256 — reuse a transcription of the same bytes

Revision ID: 043
Revises: 042
Create Date: 2026-09-09 00:00:00.000000

A 24-page quote took ten-plus minutes to transcribe with vision; the person
stopped the turn, asked again, and the same PDF was read from scratch a second
and a third time while the first result already sat in this table. Storing a
hash of the bytes lets a repeat request return the stored text in a second.
"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "043"
down_revision = "042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE document_extractions "
        "ADD COLUMN IF NOT EXISTS content_sha256 varchar(64)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_extractions_content_sha256 "
        "ON document_extractions (content_sha256) WHERE content_sha256 IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_extractions_content_sha256")
    op.execute("ALTER TABLE document_extractions DROP COLUMN IF EXISTS content_sha256")
