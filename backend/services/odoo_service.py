"""
Odoo ERP integration service.

Talks to Odoo's External API over XML-RPC (``xmlrpc.client``, stdlib — no extra
dependency). All network calls are blocking, so every public coroutine offloads
to a worker thread via ``asyncio.to_thread`` to keep the FastAPI event loop free.

Phase 1 is read-only: ``search_read`` against a curated set of models. Write
support (create/write) will be added later behind the approval flow.
"""

from __future__ import annotations

import asyncio
import xmlrpc.client
from typing import Any

from cryptography.fernet import Fernet

from config import settings


# ── Errors ───────────────────────────────────────────────────────────────────

class OdooError(RuntimeError):
    """Base error for Odoo integration failures."""


class OdooAuthError(OdooError):
    """Raised when authentication against Odoo fails."""


# ── Secret handling ──────────────────────────────────────────────────────────

def _fernet() -> Fernet:
    return Fernet(settings.fernet_key)


def encrypt_secret(raw: str) -> str:
    """Fernet-encrypt a secret (e.g. an Odoo API key) for storage."""
    return _fernet().encrypt(raw.encode()).decode()


def decrypt_secret(token: str) -> str:
    """Reverse :func:`encrypt_secret`."""
    return _fernet().decrypt(token.encode()).decode()


# ── Curated read models ──────────────────────────────────────────────────────
# Friendly key → display metadata + the Odoo model and fields we expose.
# Keeping this server-side means the frontend never has to know Odoo internals.

MODEL_CONFIG: dict[str, dict[str, Any]] = {
    "customers": {
        "label": "Customers & Contacts",
        "model": "res.partner",
        "fields": ["name", "email", "phone", "city", "country_id", "customer_rank", "supplier_rank"],
        "order": "name asc",
        "search_field": "name",
    },
    "sales": {
        "label": "Sales Orders",
        "model": "sale.order",
        "fields": ["name", "partner_id", "date_order", "amount_total", "state"],
        "order": "date_order desc",
        "search_field": "name",
    },
    "invoices": {
        "label": "Invoices & Accounting",
        "model": "account.move",
        "fields": ["name", "partner_id", "invoice_date", "amount_total", "amount_residual", "state", "move_type"],
        "order": "invoice_date desc",
        "search_field": "name",
        "domain": [["move_type", "in", ["out_invoice", "in_invoice", "out_refund", "in_refund"]]],
    },
    "products": {
        "label": "Products & Inventory",
        "model": "product.product",
        "fields": ["name", "default_code", "list_price", "qty_available", "type"],
        "order": "name asc",
        "search_field": "name",
    },
    "leads": {
        "label": "CRM Leads & Opportunities",
        "model": "crm.lead",
        "fields": ["name", "contact_name", "email_from", "stage_id", "expected_revenue", "probability"],
        "order": "create_date desc",
        "search_field": "name",
    },
    "purchases": {
        "label": "Purchase Orders",
        "model": "purchase.order",
        "fields": ["name", "partner_id", "date_order", "amount_total", "state"],
        "order": "date_order desc",
        "search_field": "name",
    },
    "manufacturing": {
        "label": "Manufacturing Orders",
        "model": "mrp.production",
        "fields": ["name", "product_id", "product_qty", "state", "date_start"],
        "order": "date_start desc",
        "search_field": "name",
    },
    "employees": {
        "label": "Employees",
        "model": "hr.employee",
        "fields": ["name", "job_title", "work_email", "department_id"],
        "order": "name asc",
        "search_field": "name",
    },
}


def model_catalog() -> list[dict[str, str]]:
    """Return the list of exposed models for the frontend."""
    return [
        {"key": key, "label": cfg["label"], "model": cfg["model"]}
        for key, cfg in MODEL_CONFIG.items()
    ]


# ── Low-level XML-RPC helpers (blocking — call only via to_thread) ────────────

def _normalize_url(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if not url:
        raise OdooError("Odoo URL is required.")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def _proxy(url: str, endpoint: str) -> xmlrpc.client.ServerProxy:
    return xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/{endpoint}", allow_none=True)


def _authenticate(url: str, database: str, username: str, api_key: str) -> int:
    try:
        uid = _proxy(url, "common").authenticate(database, username, api_key, {})
    except Exception as exc:  # noqa: BLE001 — surface a clean message to the UI
        raise OdooError(f"Could not reach Odoo at {url}: {exc}") from exc
    if not uid:
        raise OdooAuthError("Authentication failed — check the database name, email, and API key.")
    return int(uid)


def _execute_kw(
    url: str,
    database: str,
    uid: int,
    api_key: str,
    model: str,
    method: str,
    args: list[Any],
    kwargs: dict[str, Any] | None = None,
) -> Any:
    try:
        return _proxy(url, "object").execute_kw(
            database, uid, api_key, model, method, args, kwargs or {}
        )
    except xmlrpc.client.Fault as exc:
        raise OdooError(exc.faultString.strip().splitlines()[-1]) from exc


def _test_connection_sync(url: str, database: str, username: str, api_key: str) -> dict[str, Any]:
    url = _normalize_url(url)
    uid = _authenticate(url, database, username, api_key)
    version = _proxy(url, "common").version()
    rows = _execute_kw(
        url, database, uid, api_key, "res.users", "read", [[uid]], {"fields": ["name", "login"]}
    )
    user = rows[0] if rows else {}
    return {
        "uid": uid,
        "display_name": user.get("name"),
        "login": user.get("login", username),
        "server_version": str(version.get("server_version", "")),
    }


def _search_read_sync(
    url: str,
    database: str,
    username: str,
    api_key: str,
    key: str,
    search: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    cfg = MODEL_CONFIG.get(key)
    if cfg is None:
        raise OdooError(f"Unknown Odoo dataset '{key}'.")
    url = _normalize_url(url)
    uid = _authenticate(url, database, username, api_key)

    domain: list[Any] = list(cfg.get("domain", []))
    if search and cfg.get("search_field"):
        domain = domain + [[cfg["search_field"], "ilike", search]]

    return _execute_kw(
        url,
        database,
        uid,
        api_key,
        cfg["model"],
        "search_read",
        [domain],
        {"fields": cfg["fields"], "limit": max(1, min(limit, 200)), "order": cfg.get("order", "")},
    )


# ── Public async API ─────────────────────────────────────────────────────────

async def test_connection(url: str, database: str, username: str, api_key: str) -> dict[str, Any]:
    """Authenticate and return identity/server info, or raise OdooError."""
    return await asyncio.to_thread(_test_connection_sync, url, database, username, api_key)


async def search_read(
    url: str,
    database: str,
    username: str,
    api_key: str,
    key: str,
    search: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Read rows for one curated dataset key. Returns ``{fields, rows}``."""
    cfg = MODEL_CONFIG[key]
    rows = await asyncio.to_thread(
        _search_read_sync, url, database, username, api_key, key, search, limit
    )
    return {"key": key, "label": cfg["label"], "model": cfg["model"], "fields": cfg["fields"], "rows": rows}
