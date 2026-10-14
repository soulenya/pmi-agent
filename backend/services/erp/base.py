"""The provider interface every ERP adapter implements.

A *provider* turns the app's generic questions (datasets, bank balances,
alerts, approved writes) into calls against one ERP. The connection row
(``models.db.erp.ErpConnection``) is the same for every provider; what the
columns mean is the provider's business.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from models.db.erp import ErpConnection


@dataclass(frozen=True)
class ConnectField:
    """One input on the connect form."""

    name: str
    label: str
    kind: str = "text"        # text | password | url
    placeholder: str = ""
    required: bool = True


@dataclass(frozen=True)
class ProviderInfo:
    key: str
    label: str
    description: str
    fields: tuple[ConnectField, ...] = field(default_factory=tuple)
    #: Prefilled values for the connect form (from the brand file), by field name.
    defaults: dict[str, str] = field(default_factory=dict)
    supports_writes: bool = False
    supports_bank_balances: bool = False


class ErpProvider(Protocol):
    key: str
    label: str

    def info(self) -> ProviderInfo: ...

    # ── Connection ──────────────────────────────────────────────────────
    async def test_connection(self, values: dict[str, str]) -> dict[str, Any]:
        """Verify the form values; return identity/server info or raise ErpError."""

    def apply_connection(self, conn: ErpConnection, values: dict[str, str], info: dict[str, Any]) -> None:
        """Write the form values (secret encrypted) into the row."""

    def status_details(self, conn: ErpConnection) -> dict[str, Any]:
        """Non-secret facts about the stored connection for the status endpoint."""

    # ── Reads ───────────────────────────────────────────────────────────
    def datasets(self) -> list[dict[str, str]]:
        """``[{key, label, model}]`` the user may browse."""

    def dataset_keys(self) -> tuple[str, ...]: ...

    async def search_read(self, conn: ErpConnection, key: str, search: str | None, limit: int) -> dict[str, Any]:
        """``{key, label, model, fields, rows}``."""

    async def read_records(self, conn: ErpConnection, key: str, ids: list[int] | None, limit: int) -> list[dict[str, Any]]: ...

    def record_to_text(self, key: str, row: dict[str, Any]) -> tuple[str, str]: ...

    def field_text(self, value: Any) -> str: ...

    async def bank_balances(self, conn: ErpConnection) -> dict[str, Any]:
        """``{accounts: [{journal, type, account, balance}], currency, total}``."""

    async def fetch_alerts(self, conn: ErpConnection) -> list[dict[str, Any]]:
        """Daily-assistant alert candidates (see odoo_service._alerts_sync for the shape)."""

    # ── Writes (always behind an approval) ─────────────────────────────
    def write_catalog(self) -> list[dict[str, str]]: ...

    def default_risk(self, action: str) -> str: ...

    def validate_write(self, action: str, params: dict[str, Any]) -> None: ...

    def describe_write(self, action: str, params: dict[str, Any]) -> tuple[str, str]: ...

    async def execute_write(self, conn: ErpConnection, action: str, params: dict[str, Any]) -> dict[str, Any]: ...
