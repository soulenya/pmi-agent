"""Database role names for migrations.

Every table-creating migration hands ownership to the runtime role so the API
can use the table. The role is ``pmi_app`` on PMI's installs and a generic
name on a white-label brand; ``DB_APP_ROLE`` in the environment wins, then the
brand file, then the historical default — so an unconfigured PMI install emits
exactly the SQL it always has.
"""

from __future__ import annotations

import os


def _brand_default(key: str, fallback: str) -> str:
    try:
        from brand import get_brand

        return get_brand().db[key]
    except Exception:  # noqa: BLE001 — migrations must run without the app importable
        return fallback


APP_ROLE: str = os.environ.get("DB_APP_ROLE", "").strip() or _brand_default("app_role", "pmi_app")
AUDIT_ROLE: str = os.environ.get("DB_AUDIT_ROLE", "").strip() or _brand_default("audit_role", "pmi_audit")
