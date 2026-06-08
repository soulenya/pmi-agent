"""regulatory file explorer + per-user regulatory write permission

Adds:
- users.can_write_regulatory (bool) — gates create/edit/move/delete in the
  Regulatory file store. Admins always have write regardless.
- regulatory_nodes table — a self-referential folder/file tree backing the
  Regulatory file explorer. File bytes live on disk; this table holds metadata.

Revision ID: 004
Revises: 003
Create Date: 2026-06-09 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "can_write_regulatory boolean NOT NULL DEFAULT false"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS regulatory_nodes (
            id uuid PRIMARY KEY,
            parent_id uuid REFERENCES regulatory_nodes(id) ON DELETE CASCADE,
            node_type varchar(10) NOT NULL,
            name varchar(500) NOT NULL,
            stored_filename varchar(300),
            size_bytes integer,
            mime_type varchar(150),
            extension varchar(20),
            source_type varchar(20),
            source_file_id varchar(200),
            source_url text,
            source_modified_at timestamptz,
            created_by uuid REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_regulatory_nodes_parent_id "
        "ON regulatory_nodes (parent_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_regulatory_nodes_node_type "
        "ON regulatory_nodes (node_type)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS regulatory_nodes")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS can_write_regulatory")
