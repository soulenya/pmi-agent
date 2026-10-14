"""The 'none' provider — a company with no ERP. Every call says so plainly."""

from __future__ import annotations

from typing import Any

from models.db.erp import ErpConnection
from services.erp.base import ProviderInfo
from services.erp.errors import ErpError

NOT_CONNECTED = (
    "No ERP is connected. An administrator chooses a provider in Settings → ERP "
    "(or the ERP step of Company Setup)."
)


class NoneProvider:
    key = "none"
    label = "No ERP"

    def info(self) -> ProviderInfo:
        return ProviderInfo(
            key=self.key,
            label=self.label,
            description="The company does not use an ERP. ERP tools report that honestly instead of failing.",
        )

    async def test_connection(self, values: dict[str, str]) -> dict[str, Any]:
        raise ErpError("'No ERP' has nothing to connect to.")

    def apply_connection(self, conn: ErpConnection, values: dict[str, str], info: dict[str, Any]) -> None:
        raise ErpError("'No ERP' has nothing to connect to.")

    def status_details(self, conn: ErpConnection) -> dict[str, Any]:
        return {}

    def datasets(self) -> list[dict[str, str]]:
        return []

    def dataset_keys(self) -> tuple[str, ...]:
        return ()

    async def search_read(self, conn, key, search, limit) -> dict[str, Any]:
        raise ErpError(NOT_CONNECTED)

    async def read_records(self, conn, key, ids, limit) -> list[dict[str, Any]]:
        raise ErpError(NOT_CONNECTED)

    def record_to_text(self, key: str, row: dict[str, Any]) -> tuple[str, str]:
        raise ErpError(NOT_CONNECTED)

    def field_text(self, value: Any) -> str:
        return "" if value in (None, False) else str(value)

    async def bank_balances(self, conn) -> dict[str, Any]:
        raise ErpError(NOT_CONNECTED)

    async def fetch_alerts(self, conn) -> list[dict[str, Any]]:
        return []

    def write_catalog(self) -> list[dict[str, str]]:
        return []

    def default_risk(self, action: str) -> str:
        return "medium"

    def validate_write(self, action: str, params: dict[str, Any]) -> None:
        raise ErpError(NOT_CONNECTED)

    def describe_write(self, action: str, params: dict[str, Any]) -> tuple[str, str]:
        return action, ""

    async def execute_write(self, conn, action, params) -> dict[str, Any]:
        raise ErpError(NOT_CONNECTED)
