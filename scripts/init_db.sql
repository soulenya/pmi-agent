-- PMI Agent — Initial Database Setup
-- Run automatically by Docker on first start (as superuser)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── Application Role ───────────────────────────────────────────────────────
-- Full CRUD on all tables except audit_events (no UPDATE/DELETE there)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pmi_app') THEN
        CREATE ROLE pmi_app LOGIN PASSWORD 'pmi_dev_password';
    END IF;
END
$$;

-- ─── Audit Writer Role ───────────────────────────────────────────────────────
-- INSERT + SELECT only on audit_events; enforces append-only at the DB level
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pmi_audit') THEN
        CREATE ROLE pmi_audit LOGIN PASSWORD 'pmi_audit_dev_password';
    END IF;
END
$$;

-- Grant schema usage
GRANT CONNECT ON DATABASE pmi_dev TO pmi_app;
GRANT CONNECT ON DATABASE pmi_dev TO pmi_audit;
GRANT USAGE ON SCHEMA public TO pmi_app;
GRANT USAGE ON SCHEMA public TO pmi_audit;

-- After Alembic creates tables, run:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pmi_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pmi_app;
--   REVOKE UPDATE, DELETE ON audit_events FROM pmi_app;
--   GRANT SELECT, INSERT ON audit_events TO pmi_audit;
--   GRANT USAGE, SELECT ON SEQUENCE audit_events_sequence_number_seq TO pmi_audit;
