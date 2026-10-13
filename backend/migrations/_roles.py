"""Database role names for migrations.

Every table-creating migration hands ownership to the runtime role so the API
can use the table. The role is ``pmi_app`` on PMI's installs and a generic
name on a white-label brand; ``DB_APP_ROLE`` in the environment wins, then the
brand file, then the historical default — so an unconfigured PMI install emits
exactly the SQL it always has.
"""

from __future__ import annotations

import os


def _brand_default() -> str:
    try:
        from brand import get_brand

        return get_brand().db["app_role"]
    except Exception:  # noqa: BLE001 — migrations must run without the app importable
        return "pmi_app"


APP_ROLE: str = os.environ.get("DB_APP_ROLE", "").strip() or _brand_default()
