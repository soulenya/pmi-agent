"""Odoo provider — a thin adapter over ``services.odoo_service`` (unchanged)."""

from __future__ import annotations

from typing import Any

from brand import get_brand
from models.db.erp import ErpConnection
from services import odoo_service as odoo
from services.erp.base import ConnectField, ProviderInfo


class OdooProvider:
    key = "odoo"
    label = "Odoo"

    def info(self) -> ProviderInfo:
        cfg = (get_brand().raw.get("erp") or {}).get("odoo") or {}
        return ProviderInfo(
            key=self.key,
            label=self.label,
            description="Odoo (hosted or self-managed) over its XML-RPC External API, with a per-user API key.",
            fields=(
                ConnectField("url", "Odoo URL", "url", "https://yourcompany.odoo.com"),
                ConnectField("database", "Database name", "text", "yourcompany"),
                ConnectField("username", "Login email", "text", "you@company.com"),
                ConnectField("api_key", "API key", "password", "••••••••••••"),
            ),
            defaults={
                "url": str(cfg.get("url") or ""),
                "database": str(cfg.get("database") or ""),
                # The form turns this into "<local part>@<domain>" for the signed-in user.
                "email_domain": str(cfg.get("email_domain") or ""),
            },
            supports_writes=True,
            supports_bank_balances=True,
        )

    # ── Connection ──────────────────────────────────────────────────────
    @staticmethod
    def _secret(conn: ErpConnection) -> str:
        return odoo.decrypt_secret(conn.api_key_encrypted)

    async def test_connection(self, values: dict[str, str]) -> dict[str, Any]:
        return await odoo.test_connection(
            values.get("url", ""), values.get("database", ""), values.get("username", ""), values.get("api_key", "")
        )

    def apply_connection(self, conn: ErpConnection, values: dict[str, str], info: dict[str, Any]) -> None:
        conn.provider = self.key
        conn.url = odoo._normalize_url(values.get("url", ""))
        conn.database = values.get("database", "")
        conn.username = values.get("username", "")
        conn.api_key_encrypted = odoo.encrypt_secret(values.get("api_key", ""))
        conn.config = None
        conn.display_name = info.get("display_name")
        conn.server_version = info.get("server_version")

    def status_details(self, conn: ErpConnection) -> dict[str, Any]:
        return {"url": conn.url, "database": conn.database, "username": conn.username}

    # ── Reads ───────────────────────────────────────────────────────────
    def datasets(self) -> list[dict[str, str]]:
        return odoo.model_catalog()

    def dataset_keys(self) -> tuple[str, ...]:
        return tuple(odoo.MODEL_CONFIG)

    async def search_read(self, conn: ErpConnection, key: str, search: str | None, limit: int) -> dict[str, Any]:
        return await odoo.search_read(conn.url, conn.database, conn.username, self._secret(conn), key, search, limit)

    async def read_records(self, conn: ErpConnection, key: str, ids: list[int] | None, limit: int) -> list[dict[str, Any]]:
        return await odoo.read_records(conn.url, conn.database, conn.username, self._secret(conn), key, ids, limit)

    def record_to_text(self, key: str, row: dict[str, Any]) -> tuple[str, str]:
        return odoo.record_to_text(key, row)

    def field_text(self, value: Any) -> str:
        return odoo._field_text(value)

    async def bank_balances(self, conn: ErpConnection) -> dict[str, Any]:
        return await odoo.bank_balances(conn.url, conn.database, conn.username, self._secret(conn))

    async def fetch_alerts(self, conn: ErpConnection) -> list[dict[str, Any]]:
        return await odoo.fetch_alerts(conn.url, conn.database, conn.username, self._secret(conn))

    # ── Writes ──────────────────────────────────────────────────────────
    def write_catalog(self) -> list[dict[str, str]]:
        return odoo.write_catalog()

    def default_risk(self, action: str) -> str:
        return odoo.default_risk(action)

    def validate_write(self, action: str, params: dict[str, Any]) -> None:
        odoo.validate_write(action, params)

    def describe_write(self, action: str, params: dict[str, Any]) -> tuple[str, str]:
        return odoo.describe_write(action, params)

    async def execute_write(self, conn: ErpConnection, action: str, params: dict[str, Any]) -> dict[str, Any]:
        return await odoo.execute_write(conn.url, conn.database, conn.username, self._secret(conn), action, params)
