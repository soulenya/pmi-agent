"""quickbooks_connections — the company's read-only connection to QuickBooks Online

Revision ID: 057
Revises: 056
Create Date: 2026-11-20 00:00:00.000000

One row per Intuit environment (sandbox, production): the QuickBooks company
it is connected to and the encrypted tokens that allow reading it. Kept on
the hub (brand feature ``finance``). Nothing read from QuickBooks is stored.

Empty on a desktop, and on a hub that has not connected QuickBooks.
"""
from __future__ import annotations

from alembic import op
from migrations._roles import APP_ROLE

# revision identifiers, used by Alembic.
revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS quickbooks_connections (
            id                  uuid PRIMARY KEY,
            environment         varchar(20) NOT NULL,
            realm_id            varchar(40) NOT NULL,
            company_name        varchar(300) NOT NULL DEFAULT '',
            access_token_enc    text NOT NULL,
            refresh_token_enc   text NOT NULL,
            access_expires_at   timestamptz NOT NULL,
            refresh_expires_at  timestamptz,
            connected_by        uuid REFERENCES users(id) ON DELETE SET NULL,
            connected_at        timestamptz NOT NULL DEFAULT now(),
            needs_reconnect     boolean NOT NULL DEFAULT false,
            CONSTRAINT uq_quickbooks_connection_environment UNIQUE (environment)
        )
        """
    )
    op.execute(
        f"""
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                ALTER TABLE quickbooks_connections OWNER TO {APP_ROLE};
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS quickbooks_connections")
