"""Flexible embedding dimensions — Phase 1.

Adds:
  - document_chunks.embedding_dimension  (INTEGER, nullable — tracks per-chunk dim)
  - system_settings seed: llm.embedding_dimension = "768"  (current live DB default)
  - system_settings seed: llm.kb_needs_reindex = "false"

The pgvector column itself (document_chunks.embedding) stays as vector(768) because
that is what the live database already holds.  The actual ALTER to change the column
dimension happens at re-index time (POST /documents/reindex), not here.

Revision ID: 002
Revises: f07c8aa64867
Create Date: 2026-06-07
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "f07c8aa64867"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Add per-chunk dimension tracking column ───────────────────────────────
    op.add_column(
        "document_chunks",
        sa.Column("embedding_dimension", sa.Integer(), nullable=True),
    )

    # Back-fill existing rows: they were embedded at 768 dims
    op.execute("UPDATE document_chunks SET embedding_dimension = 768 WHERE embedding IS NOT NULL")

    # ── Seed system_settings with current embedding dimension ─────────────────
    # Use INSERT … ON CONFLICT DO NOTHING so running this migration twice is safe.
    op.execute(
        """
        INSERT INTO system_settings (key, value, updated_by)
        VALUES ('llm.embedding_dimension', '768', NULL)
        ON CONFLICT (key) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO system_settings (key, value, updated_by)
        VALUES ('llm.kb_needs_reindex', 'false', NULL)
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_column("document_chunks", "embedding_dimension")
    op.execute("DELETE FROM system_settings WHERE key IN ('llm.embedding_dimension', 'llm.kb_needs_reindex')")
