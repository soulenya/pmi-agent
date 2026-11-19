"""app_secrets — keys an administrator enters in the app on a host with no keyring

Revision ID: 054
Revises: 053
Create Date: 2026-11-19 00:00:00.000000

The hub has no OS keyring, so provider API keys could only reach it through
the environment. This table holds the ones its administrator enters in the
web app, Fernet-encrypted, and the Web Push key pair a hub makes for itself
when the environment supplies none. Unused on a desktop, whose keys stay in
the keyring.
"""
from __future__ import annotations

from alembic import op
from migrations._roles import APP_ROLE

# revision identifiers, used by Alembic.
revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app_secrets (
            name             varchar(100) PRIMARY KEY,
            value_encrypted  text NOT NULL,
            updated_by       uuid,
            updated_at       timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        f"""
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                ALTER TABLE app_secrets OWNER TO {APP_ROLE};
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app_secrets")
