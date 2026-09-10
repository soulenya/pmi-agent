"""team chat: channels, membership / read markers, messages

Revision ID: 044
Revises: 043
Create Date: 2026-09-10 00:00:00.000000

People talking to people. Lives on the hub, the one copy everyone reads.
A channel is one of: global (everyone signed in), project (everyone with a
role on the project), group (a named list of people), dm (two people).
team_channel_members is the member list for group/dm channels and, for every
kind, where each person's read marker lives.
"""
from __future__ import annotations

from alembic import op

revision = "044"
down_revision = "043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS team_channels (
            id           uuid PRIMARY KEY,
            kind         varchar(10) NOT NULL,
            name         varchar(200) NOT NULL DEFAULT '',
            project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
            created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
            is_archived  boolean NOT NULL DEFAULT false,
            created_at   timestamptz NOT NULL DEFAULT now(),
            updated_at   timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_team_channel_kind CHECK (kind IN ('global','project','group','dm'))
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_team_channel_project
        ON team_channels (project_id) WHERE project_id IS NOT NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_team_channel_global
        ON team_channels (kind) WHERE kind = 'global'
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS team_channel_members (
            channel_id   uuid NOT NULL REFERENCES team_channels(id) ON DELETE CASCADE,
            user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            last_read_at timestamptz,
            joined_at    timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (channel_id, user_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_team_channel_members_user
        ON team_channel_members (user_id)
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS team_messages (
            id           uuid PRIMARY KEY,
            channel_id   uuid NOT NULL REFERENCES team_channels(id) ON DELETE CASCADE,
            user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
            content      text NOT NULL DEFAULT '',
            attachments  jsonb NOT NULL DEFAULT '[]'::jsonb,
            refs         jsonb NOT NULL DEFAULT '[]'::jsonb,
            mentions     jsonb NOT NULL DEFAULT '[]'::jsonb,
            edited_at    timestamptz,
            deleted_at   timestamptz,
            created_at   timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_team_messages_channel_created
        ON team_messages (channel_id, created_at)
    """)
    for table in ("team_channels", "team_channel_members", "team_messages"):
        op.execute(f"ALTER TABLE {table} OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS team_messages")
    op.execute("DROP TABLE IF EXISTS team_channel_members")
    op.execute("DROP TABLE IF EXISTS team_channels")
