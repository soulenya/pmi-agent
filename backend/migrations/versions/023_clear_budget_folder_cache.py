"""Clear the cached budgets-folder override — central folder is now baked in

The Phase-1 code auto-created a per-install "Little Gerry Budgets" folder and
CACHED its id into the budgets.folder_id_override SystemSetting. With the
company budgets folder now baked into the code (Morgan, 2026-07-22), that
stale cache would silently keep new budgets in the old per-install folder.
Existing budget sheets are untouched (they're linked by file id); only where
NEW sheets get created changes. A deliberate manual override can simply be
set again after this upgrade.

Revision ID: 023
Revises: 022
Create Date: 2026-07-22 00:00:00.000000

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM system_settings WHERE key = 'budgets.folder_id_override'")


def downgrade() -> None:
    pass  # nothing to restore — the old value was an auto-created cache
