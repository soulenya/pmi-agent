#!/bin/bash
# Little Gerry — initial database setup, run by the postgres image on first
# start (as the superuser). Role and database names come from the compose
# environment; the defaults are PMI's, so the SQL this emits for a PMI install
# is the same as the old scripts/init_db.sql.
set -euo pipefail

APP_ROLE="${DB_APP_ROLE:-pmi_app}"
AUDIT_ROLE="${DB_AUDIT_ROLE:-pmi_audit}"
APP_PW="${DB_APP_PASSWORD:-pmi_dev_password}"
AUDIT_PW="${DB_AUDIT_PASSWORD:-pmi_audit_dev_password}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Application role: full CRUD on all tables except audit_events (no UPDATE/DELETE there)
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PW}';
    END IF;
END
\$\$;

-- Audit writer role: INSERT + SELECT only on audit_events (append-only at the DB level)
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${AUDIT_ROLE}') THEN
        CREATE ROLE ${AUDIT_ROLE} LOGIN PASSWORD '${AUDIT_PW}';
    END IF;
END
\$\$;

GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_ROLE};
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${AUDIT_ROLE};
GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
GRANT USAGE ON SCHEMA public TO ${AUDIT_ROLE};
EOSQL
