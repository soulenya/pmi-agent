"""Repair table ownership — hand three orphaned tables to pmi_app

Migrations 010 (conversation_attachments), 012 (odoo_connections), and 013
(device_tokens) created tables without the ALTER TABLE ... OWNER TO pmi_app
transfer every other table-creating migration performs. On installs where
migrations run as the privileged ``pmi`` role, the runtime ``pmi_app`` role
gets InsufficientPrivilegeError on those tables. Idempotent and guarded — a
no-op where the role doesn't exist or ownership is already correct.

Revision ID: 018
Revises: 017
Create Date: 2026-07-20 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None

_TABLES = ("conversation_attachments", "odoo_connections", "device_tokens")


def upgrade() -> None:
    for table in _TABLES:
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmi_app')
                   AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public'
                               AND tablename = '{table}') THEN
                    ALTER TABLE {table} OWNER TO pmi_app;
                END IF;
            END $$;
            """
        )


def downgrade() -> None:
    pass  # ownership repair is not reversible (and shouldn't be)
