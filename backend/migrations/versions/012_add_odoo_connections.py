"""odoo_connections table

Stores a single user's Odoo ERP connection. The API key is Fernet-encrypted in
the application layer before it ever reaches this column.

Revision ID: 012
Revises: 011
Create Date: 2026-06-17 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS odoo_connections (
            id                uuid PRIMARY KEY,
            user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            url               varchar(500) NOT NULL,
            database          varchar(255) NOT NULL,
            username          varchar(255) NOT NULL,
            api_key_encrypted text NOT NULL,
            display_name      varchar(255),
            server_version    varchar(50),
            last_connected_at timestamptz,
            created_at        timestamptz NOT NULL DEFAULT now(),
            updated_at        timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_odoo_connection_user UNIQUE (user_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS odoo_connections")
