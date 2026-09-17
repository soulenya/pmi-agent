"""push_subscriptions — the phones and browsers a person wants pushed

Revision ID: 046
Revises: 045
Create Date: 2026-09-17 00:00:00.000000

One row per browser subscription (Web Push). The endpoint is unique on its
own; a person may hold several (phone, tablet, laptop browser). Rows are
deleted when the push service reports the subscription gone (404/410).
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "046"
down_revision = "045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id            uuid PRIMARY KEY,
            user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint      text NOT NULL,
            p256dh        text NOT NULL,
            auth          text NOT NULL,
            user_agent    varchar(300),
            created_at    timestamptz NOT NULL DEFAULT now(),
            last_used_at  timestamptz,
            CONSTRAINT uq_push_subscription_endpoint UNIQUE (endpoint)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user_id ON push_subscriptions (user_id)"
    )
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmi_app') THEN
                ALTER TABLE push_subscriptions OWNER TO pmi_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS push_subscriptions")
