"""document_extractions — vision-based document/image extraction audit log

Every vision extraction run (scanned PDFs, images) is recorded with its
source, model, structured JSON result and raw extracted text — auditable
and reusable (KB import, invoice intake, etc.).

Revision ID: 024
Revises: 023
Create Date: 2026-07-27 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS document_extractions (
            id           uuid PRIMARY KEY,
            user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
            source_kind  varchar(50) NOT NULL,
            source_ref   varchar(500) NOT NULL DEFAULT '',
            file_name    varchar(500) NOT NULL DEFAULT '',
            mime_type    varchar(100) NOT NULL DEFAULT '',
            model        varchar(200) NOT NULL DEFAULT '',
            schema       jsonb,
            structured   jsonb,
            raw_text     text NOT NULL DEFAULT '',
            status       varchar(20) NOT NULL DEFAULT 'ok',
            error        text,
            pages        integer,
            input_tokens integer,
            output_tokens integer,
            created_at   timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_extractions_user_id ON document_extractions (user_id)"
    )
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmi_app') THEN
                ALTER TABLE document_extractions OWNER TO pmi_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS document_extractions")
