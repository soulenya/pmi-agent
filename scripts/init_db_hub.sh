#!/bin/bash
# Hub only. Replaces the development role passwords baked into init_db.sql with
# the real ones pulled from Secret Manager. Runs once, on first database init.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    ALTER ROLE pmi_app   WITH PASSWORD '${PMI_APP_PASSWORD}';
    ALTER ROLE pmi_audit WITH PASSWORD '${PMI_AUDIT_PASSWORD}';
EOSQL
