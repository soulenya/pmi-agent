"""project canvases, nodes and edges (Project Space phase 1b)

Revision ID: 038
Revises: 037
Create Date: 2026-09-03 00:00:00.000000

Nodes are either free-form (sticky, text, frame, shape, image, ink, link) or a
reference to something that already exists elsewhere in the app, in which case
`ref_id` holds the target id or URL — the same shape as `workroom_items`, so
anything pinnable is already placeable.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project_canvases (
            id          uuid PRIMARY KEY,
            project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name        varchar(255) NOT NULL DEFAULT 'Canvas',
            viewport    jsonb NOT NULL DEFAULT '{"x": 0, "y": 0, "zoom": 1}'::jsonb,
            created_by  uuid REFERENCES users(id),
            created_at  timestamptz NOT NULL DEFAULT now(),
            updated_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_project_canvases_project"
        " ON project_canvases (project_id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS canvas_nodes (
            id             uuid PRIMARY KEY,
            canvas_id      uuid NOT NULL REFERENCES project_canvases(id) ON DELETE CASCADE,
            parent_node_id uuid REFERENCES canvas_nodes(id) ON DELETE SET NULL,
            kind           varchar(30) NOT NULL,
            ref_id         text,
            label          text NOT NULL DEFAULT '',
            content        text NOT NULL DEFAULT '',
            x              double precision NOT NULL DEFAULT 0,
            y              double precision NOT NULL DEFAULT 0,
            width          double precision NOT NULL DEFAULT 200,
            height         double precision NOT NULL DEFAULT 120,
            z              integer NOT NULL DEFAULT 0,
            style          jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_by     uuid REFERENCES users(id),
            created_at     timestamptz NOT NULL DEFAULT now(),
            updated_at     timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_canvas_nodes_canvas ON canvas_nodes (canvas_id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS canvas_edges (
            id             uuid PRIMARY KEY,
            canvas_id      uuid NOT NULL REFERENCES project_canvases(id) ON DELETE CASCADE,
            source_node_id uuid NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
            target_node_id uuid NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
            source_handle  varchar(30),
            target_handle  varchar(30),
            kind           varchar(30) NOT NULL DEFAULT 'link',
            label          text NOT NULL DEFAULT '',
            style          jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_by     uuid REFERENCES users(id),
            created_at     timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_canvas_edge UNIQUE (canvas_id, source_node_id, target_node_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_canvas_edges_canvas ON canvas_edges (canvas_id)"
    )
    for table in ("project_canvases", "canvas_nodes", "canvas_edges"):
        op.execute(f"ALTER TABLE {table} OWNER TO pmi_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS canvas_edges")
    op.execute("DROP TABLE IF EXISTS canvas_nodes")
    op.execute("DROP TABLE IF EXISTS project_canvases")
