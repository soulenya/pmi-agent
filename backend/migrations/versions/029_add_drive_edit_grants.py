"""drive_edit_grants — per-file permission for Gerry to write to Google Drive

Gerry can only modify a Drive file while an active row exists here for that
exact file id. Grants are created by the user, never by the agent, and each
file needs its own.

Revision ID: 029
Revises: 028
Create Date: 2026-07-31 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS drive_edit_grants (
            id           uuid PRIMARY KEY,
            user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            file_id      varchar(255) NOT NULL,
            file_name    varchar(500) NOT NULL DEFAULT '',
            mime_type    varchar(255) NOT NULL DEFAULT '',
            file_url     varchar(1000) NOT NULL DEFAULT '',
            status       varchar(20) NOT NULL DEFAULT 'active',
            granted_at   timestamptz NOT NULL DEFAULT now(),
            revoked_at   timestamptz,
            last_used_at timestamptz,
            edit_count   integer NOT NULL DEFAULT 0,
            created_at   timestamptz NOT NULL DEFAULT now(),
            updated_at   timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_drive_edit_grant_file UNIQUE (user_id, file_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_drive_edit_grants_user_id "
        "ON drive_edit_grants (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_drive_edit_grants_file_id "
        "ON drive_edit_grants (file_id)"
    )
    # Migrations may run as the privileged role; the runtime role needs the
    # table too (see migration 018 — the same omission broke three tables).
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmi_app') THEN
                ALTER TABLE drive_edit_grants OWNER TO pmi_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS drive_edit_grants")
