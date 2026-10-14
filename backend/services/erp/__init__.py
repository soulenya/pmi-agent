"""ERP providers — the company's ERP behind one interface.

``brand.erp`` decides which providers a build offers (``providers``) and which
one is preselected (``default``). PMI: ``["odoo"]`` / ``"odoo"``. A company
with no ERP ships ``["odoo"]`` / ``"none"`` and sees the ERP step of Company
Setup instead of a connect form; its ERP tools answer "No ERP is connected".

The connection row is per user (``models.db.erp.ErpConnection``); this module
loads it and hands back the provider that knows how to use it.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brand import get_brand
from models.db.erp import ErpConnection
from services.erp.base import ErpProvider, ProviderInfo
from services.erp.errors import ErpAuthError, ErpError
from services.erp.none import NOT_CONNECTED, NoneProvider
from services.erp.odoo import OdooProvider

__all__ = [
    "ErpAuthError",
    "ErpConnection",
    "ErpError",
    "ErpProvider",
    "NOT_CONNECTED",
    "PROVIDERS",
    "available",
    "default_key",
    "get",
    "load_connection",
    "not_connected_message",
    "provider_for",
]

PROVIDERS: dict[str, ErpProvider] = {
    "odoo": OdooProvider(),
    "none": NoneProvider(),
}


def _erp_block() -> dict[str, Any]:
    return get_brand().raw.get("erp") or {}


def available() -> list[ProviderInfo]:
    """Providers this build offers, in brand order; 'none' is always last."""
    wanted = [str(k) for k in (_erp_block().get("providers") or ["odoo"])]
    infos = [PROVIDERS[k].info() for k in wanted if k in PROVIDERS and k != "none"]
    infos.append(PROVIDERS["none"].info())
    return infos


def default_key() -> str:
    key = str(_erp_block().get("default") or "none")
    return key if key in PROVIDERS else "none"


def get(key: str) -> ErpProvider:
    return PROVIDERS.get(key) or PROVIDERS["none"]


def provider_for(conn: ErpConnection | None) -> ErpProvider:
    """The provider of a stored connection, or the brand default when there is none."""
    if conn is None:
        return get(default_key())
    return get(conn.provider or "odoo")


async def load_connection(db: AsyncSession, user_id: uuid.UUID) -> ErpConnection | None:
    return (
        await db.execute(select(ErpConnection).where(ErpConnection.user_id == user_id))
    ).scalar_one_or_none()


def not_connected_message() -> str:
    """What a tool says when the user has no connection: Odoo wording for an
    Odoo-default brand (PMI's text, unchanged), the generic sentence otherwise."""
    if default_key() == "odoo":
        return "Odoo is not connected. Ask the user to connect it on the Odoo page first."
    return NOT_CONNECTED
