"""pipeline_stages, pipeline_leads, pipeline_notes — the sales pipeline

Revision ID: 055
Revises: 054
Create Date: 2026-11-20 00:00:00.000000

The company's leads and opportunities, the stages they move through and each
lead's history, kept on the hub (brand feature ``pipeline``). ``source`` and
``source_id`` on a lead or note say where an imported row came from, so an
import from another system can be repeated without making duplicates.

Empty on a desktop, and on a hub whose brand does not use the pipeline.
"""
from __future__ import annotations

from alembic import op
from migrations._roles import APP_ROLE

# revision identifiers, used by Alembic.
revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None

_TABLES = ("pipeline_stages", "pipeline_leads", "pipeline_notes")


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS pipeline_stages (
            id          uuid PRIMARY KEY,
            name        varchar(120) NOT NULL UNIQUE,
            position    integer NOT NULL DEFAULT 0,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS pipeline_leads (
            id             uuid PRIMARY KEY,
            title          varchar(500) NOT NULL,
            company        varchar(300) NOT NULL DEFAULT '',
            contact_name   varchar(300) NOT NULL DEFAULT '',
            contact_title  varchar(300) NOT NULL DEFAULT '',
            email          varchar(320) NOT NULL DEFAULT '',
            phone          varchar(100) NOT NULL DEFAULT '',
            address        text NOT NULL DEFAULT '',
            stage_id       uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
            status         varchar(10) NOT NULL DEFAULT 'open',
            value          numeric(14, 2),
            next_step      text NOT NULL DEFAULT '',
            next_step_due  date,
            owner_id       uuid REFERENCES users(id) ON DELETE SET NULL,
            owner_name     varchar(300) NOT NULL DEFAULT '',
            details        text NOT NULL DEFAULT '',
            source         varchar(20) NOT NULL DEFAULT 'manual',
            source_id      varchar(100),
            created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at     timestamptz NOT NULL DEFAULT now(),
            updated_at     timestamptz NOT NULL DEFAULT now(),
            closed_at      timestamptz,
            CONSTRAINT uq_pipeline_lead_source UNIQUE (source, source_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_pipeline_leads_stage_id ON pipeline_leads (stage_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pipeline_leads_status ON pipeline_leads (status)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS pipeline_notes (
            id           uuid PRIMARY KEY,
            lead_id      uuid NOT NULL REFERENCES pipeline_leads(id) ON DELETE CASCADE,
            kind         varchar(10) NOT NULL DEFAULT 'note',
            body         text NOT NULL,
            author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
            author_name  varchar(300) NOT NULL DEFAULT '',
            occurred_at  timestamptz NOT NULL DEFAULT now(),
            source_id    varchar(100),
            CONSTRAINT uq_pipeline_note_source UNIQUE (lead_id, source_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_pipeline_notes_lead_id ON pipeline_notes (lead_id)")
    for table in _TABLES:
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                    ALTER TABLE {table} OWNER TO {APP_ROLE};
                END IF;
            END $$;
            """
        )


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table}")
