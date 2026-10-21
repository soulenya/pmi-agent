"""Hand every public table and sequence to the runtime role; set default privileges

Migration 001 and about half of the later table-creating migrations never
transferred ownership to the runtime role (018 repaired three of them). On
installs where the API connects as that role rather than the superuser — the
hub — it gets InsufficientPrivilegeError on users, tasks, conversations,
google_credentials and the rest. PMI's hub had been granted by hand; a new
company's had not.

Idempotent and guarded: no-op where the role does not exist (a database that
runs everything as the superuser) or ownership is already correct. Default
privileges make tables and sequences created by future migrations readable
by the runtime role even if a migration forgets the transfer. audit_events
stays append-only for the runtime role; the audit role may read and insert.

Revision ID: 051
Revises: 050
Create Date: 2026-10-21 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
from migrations._roles import APP_ROLE, AUDIT_ROLE

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        DECLARE r record;
        BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                FOR r IN
                    SELECT tablename FROM pg_tables
                    WHERE schemaname = 'public' AND tableowner <> '{APP_ROLE}'
                LOOP
                    EXECUTE format('ALTER TABLE public.%I OWNER TO {APP_ROLE}', r.tablename);
                END LOOP;
                FOR r IN
                    SELECT c.relname FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relkind = 'S'
                      AND pg_get_userbyid(c.relowner) <> '{APP_ROLE}'
                LOOP
                    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO {APP_ROLE}', r.relname);
                END LOOP;
                -- Whatever the migration runner creates from now on is usable by the API.
                EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE}';
                EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE}';
                IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_events') THEN
                    EXECUTE 'REVOKE UPDATE, DELETE ON audit_events FROM {APP_ROLE}';
                END IF;
            END IF;
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = '{AUDIT_ROLE}')
               AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_events') THEN
                EXECUTE 'GRANT SELECT, INSERT ON audit_events TO {AUDIT_ROLE}';
                EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {AUDIT_ROLE}';
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    pass  # ownership repair is not reversible (and shouldn't be)
