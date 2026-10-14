"""odoo_connections → erp_connections, with a provider column

Revision ID: 050
Revises: 049
Create Date: 2026-10-14 00:00:00.000000

The one-per-user ERP connection row is no longer Odoo-only. The table is
renamed, every existing row is marked ``provider = 'odoo'`` (nothing else
about it changes), and a ``config`` JSONB column is added for providers whose
settings are not url/database/username. Idempotent: a fresh database that
already has erp_connections is left alone.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('public.odoo_connections') IS NOT NULL
               AND to_regclass('public.erp_connections') IS NULL THEN
                ALTER TABLE odoo_connections RENAME TO erp_connections;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_odoo_connection_user') THEN
                ALTER TABLE erp_connections RENAME CONSTRAINT uq_odoo_connection_user TO uq_erp_connection_user;
            END IF;
        END $$;
        """
    )
    op.execute(
        "ALTER TABLE erp_connections ADD COLUMN IF NOT EXISTS provider varchar(32) NOT NULL DEFAULT 'odoo'"
    )
    op.execute("ALTER TABLE erp_connections ADD COLUMN IF NOT EXISTS config jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE erp_connections DROP COLUMN IF EXISTS config")
    op.execute("ALTER TABLE erp_connections DROP COLUMN IF EXISTS provider")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_erp_connection_user') THEN
                ALTER TABLE erp_connections RENAME CONSTRAINT uq_erp_connection_user TO uq_odoo_connection_user;
            END IF;
            IF to_regclass('public.erp_connections') IS NOT NULL THEN
                ALTER TABLE erp_connections RENAME TO odoo_connections;
            END IF;
        END $$;
        """
    )
