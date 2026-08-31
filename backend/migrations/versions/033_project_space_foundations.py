"""project space foundations — goal/visibility on projects, members, workroom link

Revision ID: 033
Revises: 032
Create Date: 2026-08-31 00:00:00.000000

Backfills one project per existing workroom so a Project is the single
container from here on, and gives every project an owner membership row.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS goal text NOT NULL DEFAULT ''")
    op.execute(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility "
        "varchar(20) NOT NULL DEFAULT 'private'"
    )
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz")
    op.execute(
        "ALTER TABLE workrooms ADD COLUMN IF NOT EXISTS project_id uuid "
        "REFERENCES projects(id) ON DELETE SET NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workrooms_project_id ON workrooms (project_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project_members (
            id          uuid PRIMARY KEY,
            project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role        varchar(20) NOT NULL DEFAULT 'viewer',
            created_at  timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_project_members_project_user UNIQUE (project_id, user_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_project_members_user_id ON project_members (user_id)"
    )

    # Every existing workroom becomes a project, so the two top-level concepts
    # collapse into one without touching the workroom's pins, journal or chat.
    op.execute(
        """
        DO $$
        DECLARE r RECORD; new_id uuid;
        BEGIN
            FOR r IN SELECT * FROM workrooms WHERE project_id IS NULL LOOP
                new_id := gen_random_uuid();
                INSERT INTO projects (
                    id, name, description, status, owner_id, created_by,
                    goal, visibility, is_archived, archived_at,
                    created_at, updated_at
                ) VALUES (
                    new_id, r.title, NULL,
                    CASE WHEN r.status = 'archived' THEN 'archived' ELSE 'active' END,
                    r.user_id, r.user_id,
                    COALESCE(r.goal, ''), 'private',
                    r.status = 'archived',
                    CASE WHEN r.status = 'archived' THEN r.updated_at END,
                    r.created_at, r.updated_at
                );
                UPDATE workrooms SET project_id = new_id WHERE id = r.id;
            END LOOP;
        END $$
        """
    )

    op.execute(
        """
        INSERT INTO project_members (id, project_id, user_id, role, created_at)
        SELECT gen_random_uuid(), p.id, COALESCE(p.owner_id, p.created_by),
               'owner', COALESCE(p.created_at, now())
        FROM projects p
        WHERE COALESCE(p.owner_id, p.created_by) IS NOT NULL
        ON CONFLICT ON CONSTRAINT uq_project_members_project_user DO NOTHING
        """
    )

    # Migrations run as the superuser `pmi`; the API runs as `pmi_app`, which has
    # no CREATE rights and must own the table to be able to read or write it.
    op.execute("ALTER TABLE project_members OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS project_members")
    op.execute("ALTER TABLE workrooms DROP COLUMN IF EXISTS project_id")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS archived_at")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS visibility")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS goal")
