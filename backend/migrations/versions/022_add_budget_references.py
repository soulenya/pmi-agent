"""budget_references — budgets referencing other budgets' numbers

A budget (e.g. a master budget) can reference any other budget. The
reference always shows the target's live numbers in the app; with
``include_as_entry`` it ALSO maintains one clearly-marked ledger row in the
referencing budget's sheet ("[Budget] <title>", source='budget-ref') kept
in sync with the target's total on every refresh — so master-sheet
formulas incorporate sub-budget numbers on both surfaces. Cycles are
rejected at link time.

Revision ID: 022
Revises: 021
Create Date: 2026-07-22 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS budget_references (
            id               uuid PRIMARY KEY,
            budget_id        uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
            ref_budget_id    uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
            include_as_entry boolean NOT NULL DEFAULT FALSE,
            created_at       timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_budget_reference UNIQUE (budget_id, ref_budget_id),
            CONSTRAINT ck_budget_reference_not_self CHECK (budget_id <> ref_budget_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_budget_references_budget_id ON budget_references (budget_id)"
    )
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmi_app') THEN
                ALTER TABLE budget_references OWNER TO pmi_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS budget_references")
