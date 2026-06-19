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
import logging
import xmlrpc.client
from datetime import date, timedelta
from typing import Any

from cryptography.fernet import Fernet

from config import settings

logger = logging.getLogger(__name__)


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


# ── Bank balances ────────────────────────────────────────────────────────────

def _bank_balances_sync(
    url: str,
    database: str,
    username: str,
    api_key: str,
) -> dict[str, Any]:
    """Compute current balances for each bank/cash journal.

    The ``balance`` field on ``account.move.line`` is always stored in the
    company currency, so we sum the posted move lines for each journal's GL
    account and report everything (and the grand total) in company currency.
    """
    url = _normalize_url(url)
    uid = _authenticate(url, database, username, api_key)

    journals = _execute_kw(
        url,
        database,
        uid,
        api_key,
        "account.journal",
        "search_read",
        [[["type", "in", ["bank", "cash"]]]],
        {
            "fields": ["name", "type", "default_account_id"],
            "order": "type desc, name asc",
        },
    )
    if not journals:
        return {"accounts": [], "currency": "", "total": 0.0}

    account_ids = [
        j["default_account_id"][0] for j in journals if j.get("default_account_id")
    ]

    # Sum posted move-line balances per bank/cash GL account in one read_group.
    balances_by_account: dict[int, float] = {}
    if account_ids:
        groups = _execute_kw(
            url,
            database,
            uid,
            api_key,
            "account.move.line",
            "read_group",
            [[["account_id", "in", account_ids], ["parent_state", "=", "posted"]]],
            {"fields": ["balance:sum"], "groupby": ["account_id"]},
        )
        for g in groups:
            acct = g.get("account_id")
            if acct:
                balances_by_account[acct[0]] = float(g.get("balance") or 0.0)

    # Company currency for display (move-line balances are in company currency).
    company_currency = ""
    try:
        users = _execute_kw(
            url, database, uid, api_key, "res.users", "read", [[uid]], {"fields": ["company_id"]}
        )
        company_id = (
            users[0]["company_id"][0] if users and users[0].get("company_id") else None
        )
        if company_id:
            comps = _execute_kw(
                url,
                database,
                uid,
                api_key,
                "res.company",
                "read",
                [[company_id]],
                {"fields": ["currency_id"]},
            )
            cur = comps[0].get("currency_id") if comps else None
            if cur:
                company_currency = str(cur[1])
    except OdooError:
        pass

    accounts: list[dict[str, Any]] = []
    total = 0.0
    for j in journals:
        acct = j.get("default_account_id")
        acct_id = acct[0] if acct else None
        bal = balances_by_account.get(acct_id, 0.0) if acct_id is not None else 0.0
        accounts.append(
            {
                "journal": j.get("name", ""),
                "type": j.get("type", ""),
                "account": _m2o_name(j.get("default_account_id")),
                "balance": round(bal, 2),
            }
        )
        total += bal

    return {
        "accounts": accounts,
        "currency": company_currency,
        "total": round(total, 2),
    }


async def bank_balances(url: str, database: str, username: str, api_key: str) -> dict[str, Any]:
    """Return ``{accounts, currency, total}`` for all bank/cash journals."""
    return await asyncio.to_thread(_bank_balances_sync, url, database, username, api_key)


# ── Knowledge Base ingestion helpers ─────────────────────────────────────────

def _m2o_name(value: Any) -> str:
    """Render an Odoo many2one ``[id, "Name"]`` (or ``False``) as text."""
    if isinstance(value, (list, tuple)) and len(value) > 1:
        return str(value[1])
    return ""


def _field_text(value: Any) -> str:
    if value is False or value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return _m2o_name(value)
    return str(value)


def record_to_text(key: str, row: dict[str, Any]) -> tuple[str, str]:
    """Turn one Odoo record into ``(title, body)`` for KB ingestion."""
    cfg = MODEL_CONFIG[key]
    primary = _field_text(row.get("name")) or _field_text(row.get(cfg["fields"][0])) or f"#{row.get('id')}"
    title = f"{cfg['label'][:-1] if cfg['label'].endswith('s') else cfg['label']}: {primary}"
    lines = [f"Odoo {cfg['model']} record from {cfg['label']}.", ""]
    for field in cfg["fields"]:
        rendered = _field_text(row.get(field))
        if rendered:
            label = field.replace("_id", "").replace("_", " ").title()
            lines.append(f"{label}: {rendered}")
    return title[:500], "\n".join(lines)


def _read_records_sync(
    url: str,
    database: str,
    username: str,
    api_key: str,
    key: str,
    ids: list[int] | None,
    limit: int,
) -> list[dict[str, Any]]:
    cfg = MODEL_CONFIG[key]
    url = _normalize_url(url)
    uid = _authenticate(url, database, username, api_key)
    domain: list[Any] = list(cfg.get("domain", []))
    if ids:
        domain = domain + [["id", "in", ids]]
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


async def read_records(
    url: str,
    database: str,
    username: str,
    api_key: str,
    key: str,
    ids: list[int] | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Read specific records (by id) or the first ``limit`` of a dataset."""
    return await asyncio.to_thread(
        _read_records_sync, url, database, username, api_key, key, ids, limit
    )


# ── Daily Assistant alert rules ──────────────────────────────────────────────

def _money(value: Any) -> str:
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return str(value)


def _form_url(url: str, model: str, rid: Any) -> str:
    return f"{url}/web#id={rid}&model={model}&view_type=form"


def _alerts_sync(
    url: str,
    database: str,
    username: str,
    api_key: str,
    low_stock_threshold: float,
    draft_age_days: int,
) -> list[dict[str, Any]]:
    """Run the business-rule queries that feed the Daily Assistant.

    Each rule is isolated so a missing Odoo module (or field) only drops that
    one rule rather than failing the whole scan.
    """
    url = _normalize_url(url)
    uid = _authenticate(url, database, username, api_key)
    today = date.today()
    today_str = today.isoformat()
    alerts: list[dict[str, Any]] = []

    def _read(model: str, domain: list[Any], fields: list[str], order: str, limit: int) -> list[dict[str, Any]]:
        return _execute_kw(
            url, database, uid, api_key, model, "search_read",
            [domain], {"fields": fields, "order": order, "limit": limit},
        )

    # 1. Overdue customer invoices
    try:
        for r in _read(
            "account.move",
            [["move_type", "=", "out_invoice"], ["state", "=", "posted"],
             ["payment_state", "in", ["not_paid", "partial"]],
             ["invoice_date_due", "<", today_str]],
            ["name", "partner_id", "invoice_date_due", "amount_residual"],
            "invoice_date_due asc", 5,
        ):
            partner = _m2o_name(r.get("partner_id"))
            due = _field_text(r.get("invoice_date_due"))
            amt = _money(r.get("amount_residual"))
            alerts.append({
                "source_id": f"odoo_overdue_invoice_{r['id']}",
                "source_type": "odoo_invoice",
                "title": f"Overdue invoice {r.get('name')} — {partner}"[:500],
                "summary": f"{partner} has an overdue balance of {amt} (due {due}).",
                "source_url": _form_url(url, "account.move", r["id"]),
                "task": {
                    "title": f"Follow up on overdue invoice {r.get('name')} ({partner})"[:500],
                    "description": f"Customer {partner} owes {amt}, due {due}. Reach out about payment.",
                    "priority": "high",
                    "due_in_days": 0,
                },
                "action": {
                    "name": "register_payment",
                    "label": "Register payment",
                    "params": {"move_id": r["id"], "move_name": r.get("name"), "amount": r.get("amount_residual")},
                },
            })
    except Exception as exc:  # noqa: BLE001
        logger.info("Odoo alert rule overdue_invoice failed: %s", exc)

    # 2. Quotations / sales orders awaiting confirmation, aging
    try:
        cutoff = (today - timedelta(days=draft_age_days)).isoformat()
        for r in _read(
            "sale.order",
            [["state", "in", ["draft", "sent"]], ["date_order", "<", cutoff]],
            ["name", "partner_id", "date_order", "amount_total"],
            "date_order asc", 5,
        ):
            partner = _m2o_name(r.get("partner_id"))
            amt = _money(r.get("amount_total"))
            when = _field_text(r.get("date_order"))[:10]
            alerts.append({
                "source_id": f"odoo_draft_sale_{r['id']}",
                "source_type": "odoo_sale",
                "title": f"Quotation {r.get('name')} awaiting confirmation — {partner}"[:500],
                "summary": f"Quotation {r.get('name')} for {partner} ({amt}) has been open since {when}.",
                "source_url": _form_url(url, "sale.order", r["id"]),
                "task": {
                    "title": f"Confirm or follow up on quotation {r.get('name')} ({partner})"[:500],
                    "description": f"Quotation for {partner}, total {amt}, created {when}. Confirm it or chase the customer.",
                    "priority": "medium",
                    "due_in_days": 2,
                },
                "action": {
                    "name": "confirm_quotation",
                    "label": "Confirm quotation",
                    "params": {"order_id": r["id"], "order_name": r.get("name")},
                },
            })
    except Exception as exc:  # noqa: BLE001
        logger.info("Odoo alert rule draft_sale failed: %s", exc)

    # 3. Overdue vendor bills
    try:
        for r in _read(
            "account.move",
            [["move_type", "=", "in_invoice"], ["state", "=", "posted"],
             ["payment_state", "in", ["not_paid", "partial"]],
             ["invoice_date_due", "<", today_str]],
            ["name", "partner_id", "invoice_date_due", "amount_residual"],
            "invoice_date_due asc", 5,
        ):
            vendor = _m2o_name(r.get("partner_id"))
            due = _field_text(r.get("invoice_date_due"))
            amt = _money(r.get("amount_residual"))
            alerts.append({
                "source_id": f"odoo_overdue_bill_{r['id']}",
                "source_type": "odoo_bill",
                "title": f"Overdue vendor bill {r.get('name')} — {vendor}"[:500],
                "summary": f"Bill from {vendor} of {amt} is past due ({due}).",
                "source_url": _form_url(url, "account.move", r["id"]),
                "task": {
                    "title": f"Pay overdue vendor bill {r.get('name')} ({vendor})"[:500],
                    "description": f"Bill from {vendor}, balance {amt}, due {due}.",
                    "priority": "high",
                    "due_in_days": 0,
                },
            })
    except Exception as exc:  # noqa: BLE001
        logger.info("Odoo alert rule overdue_bill failed: %s", exc)

    # 4. Low product stock — qty_available is computed, so filter in Python.
    try:
        rows = _read(
            "product.product",
            [["type", "=", "product"]],
            ["name", "default_code", "qty_available"],
            "name asc", 200,
        )
        low = [
            r for r in rows
            if isinstance(r.get("qty_available"), (int, float)) and r["qty_available"] < low_stock_threshold
        ]
        low.sort(key=lambda r: r["qty_available"])
        for r in low[:5]:
            code = _field_text(r.get("default_code"))
            qty = r.get("qty_available")
            label = r.get("name") + (f" [{code}]" if code else "")
            alerts.append({
                "source_id": f"odoo_low_stock_{r['id']}",
                "source_type": "odoo_product",
                "title": f"Low stock: {label} ({qty} on hand)"[:500],
                "summary": f"{label} is down to {qty} units on hand (below {low_stock_threshold:g}).",
                "source_url": _form_url(url, "product.product", r["id"]),
                "task": {
                    "title": f"Restock {label} (only {qty} left)"[:500],
                    "description": f"{label} has {qty} units on hand, below the threshold of {low_stock_threshold:g}. Consider reordering.",
                    "priority": "medium",
                    "due_in_days": 3,
                },
            })
    except Exception as exc:  # noqa: BLE001
        logger.info("Odoo alert rule low_stock failed: %s", exc)

    return alerts


async def fetch_alerts(
    url: str,
    database: str,
    username: str,
    api_key: str,
    low_stock_threshold: float = 5,
    draft_age_days: int = 3,
) -> list[dict[str, Any]]:
    """Return Daily Assistant alert candidates derived from Odoo business rules."""
    return await asyncio.to_thread(
        _alerts_sync, url, database, username, api_key, low_stock_threshold, draft_age_days
    )


# ── Write actions (Phase 3 — every write goes through the approval flow) ──────
# Nothing here executes until a human approves the resulting ApprovalIntent.

WRITE_ACTIONS: dict[str, dict[str, Any]] = {
    "confirm_quotation": {"label": "Confirm quotation", "risk": "medium", "required": ["order_id"]},
    "register_payment": {"label": "Register invoice payment", "risk": "high", "required": ["move_id"]},
    "create_lead": {"label": "Create CRM lead", "risk": "medium", "required": ["name"]},
    "log_note": {"label": "Log internal note", "risk": "low", "required": ["model", "record_id", "body"]},
    "update_field": {"label": "Update record fields", "risk": "medium", "required": ["model", "record_id", "values"]},
    "create_contact": {"label": "Create contact", "risk": "medium", "required": ["name"]},
}

# Defence-in-depth allow-list for the generic log_note / update_field actions.
_WRITABLE_MODELS = {
    "sale.order", "account.move", "crm.lead", "res.partner",
    "product.product", "product.template", "purchase.order",
    "mrp.production", "hr.employee",
}


def write_catalog() -> list[dict[str, str]]:
    """Expose the available write actions (for the frontend / agent)."""
    return [{"action": k, "label": v["label"], "risk": v["risk"]} for k, v in WRITE_ACTIONS.items()]


def default_risk(action: str) -> str:
    return WRITE_ACTIONS.get(action, {}).get("risk", "medium")


def validate_write(action: str, params: dict[str, Any]) -> None:
    """Raise :class:`OdooError` if the action is unknown or params are invalid."""
    cfg = WRITE_ACTIONS.get(action)
    if cfg is None:
        raise OdooError(f"Unknown Odoo write action '{action}'.")
    missing = [k for k in cfg["required"] if params.get(k) in (None, "", [], {})]
    if missing:
        raise OdooError(f"Missing required field(s) for {action}: {', '.join(missing)}.")
    if action in ("log_note", "update_field") and params.get("model") not in _WRITABLE_MODELS:
        raise OdooError(f"Writes to model '{params.get('model')}' are not permitted.")
    if action == "update_field" and not isinstance(params.get("values"), dict):
        raise OdooError("update_field requires a 'values' object.")


def describe_write(action: str, params: dict[str, Any]) -> tuple[str, str]:
    """Human-readable ``(title, description)`` for the approval card."""
    if action == "confirm_quotation":
        name = params.get("order_name") or f"#{params.get('order_id')}"
        return (
            f"Confirm quotation {name}",
            f"Confirm sales quotation {name} in Odoo, turning it into a confirmed sales order.",
        )
    if action == "register_payment":
        name = params.get("move_name") or f"#{params.get('move_id')}"
        amt = params.get("amount")
        amt_str = f" of {_money(amt)}" if amt else ""
        return (
            f"Register payment for {name}",
            f"Register a payment{amt_str} against invoice {name} in Odoo and reconcile it.",
        )
    if action == "create_lead":
        who = f" for {params.get('contact_name')}" if params.get("contact_name") else ""
        return (
            f"Create CRM lead: {params.get('name')}",
            f"Create a new CRM lead/opportunity '{params.get('name')}'{who} in Odoo.",
        )
    if action == "log_note":
        return (
            f"Log note on {params.get('model')} #{params.get('record_id')}",
            f"Post an internal note to {params.get('model')} record #{params.get('record_id')} in Odoo:\n\n{params.get('body')}",
        )
    if action == "update_field":
        vals = params.get("values") or {}
        pretty = ", ".join(f"{k} → {v}" for k, v in vals.items())
        return (
            f"Update {params.get('model')} #{params.get('record_id')}",
            f"Update fields on {params.get('model')} record #{params.get('record_id')} in Odoo: {pretty}.",
        )
    if action == "create_contact":
        extra = f" ({params.get('email')})" if params.get("email") else ""
        return (
            f"Create contact: {params.get('name')}",
            f"Create a new contact '{params.get('name')}'{extra} in Odoo.",
        )
    return WRITE_ACTIONS.get(action, {}).get("label", action), ""


def _execute_write_sync(
    url: str,
    database: str,
    username: str,
    api_key: str,
    action: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    validate_write(action, params)
    url = _normalize_url(url)
    uid = _authenticate(url, database, username, api_key)

    def kw(model: str, method: str, args: list[Any], kwargs: dict[str, Any] | None = None) -> Any:
        return _execute_kw(url, database, uid, api_key, model, method, args, kwargs)

    if action == "confirm_quotation":
        oid = int(params["order_id"])
        kw("sale.order", "action_confirm", [[oid]])
        rows = kw("sale.order", "read", [[oid]], {"fields": ["name", "state"]})
        r = rows[0] if rows else {}
        return {
            "detail": f"Quotation {r.get('name', oid)} is now '{r.get('state')}'.",
            "record_id": oid,
            "url": _form_url(url, "sale.order", oid),
        }

    if action == "register_payment":
        mid = int(params["move_id"])
        ctx = {"active_model": "account.move", "active_ids": [mid]}
        vals: dict[str, Any] = {}
        if params.get("journal_id"):
            vals["journal_id"] = int(params["journal_id"])
        if params.get("amount"):
            vals["amount"] = float(params["amount"])
        wizard_id = kw("account.payment.register", "create", [vals], {"context": ctx})
        kw("account.payment.register", "action_create_payments", [[wizard_id]])
        rows = kw("account.move", "read", [[mid]], {"fields": ["name", "payment_state", "amount_residual"]})
        r = rows[0] if rows else {}
        return {
            "detail": f"Payment registered on {r.get('name', mid)} — state '{r.get('payment_state')}', residual {_money(r.get('amount_residual'))}.",
            "record_id": mid,
            "url": _form_url(url, "account.move", mid),
        }

    if action == "create_lead":
        vals = {"name": params["name"]}
        for f in ("contact_name", "email_from", "phone", "description"):
            if params.get(f):
                vals[f] = params[f]
        if params.get("expected_revenue") not in (None, ""):
            try:
                vals["expected_revenue"] = float(params["expected_revenue"])
            except (TypeError, ValueError):
                pass
        new_id = kw("crm.lead", "create", [vals])
        return {
            "detail": f"Created CRM lead '{params['name']}' (#{new_id}).",
            "record_id": new_id,
            "url": _form_url(url, "crm.lead", new_id),
        }

    if action == "log_note":
        model = str(params["model"])
        rid = int(params["record_id"])
        kw(model, "message_post", [[rid]], {"body": str(params["body"])})
        return {
            "detail": f"Note posted to {model} #{rid}.",
            "record_id": rid,
            "url": _form_url(url, model, rid),
        }

    if action == "update_field":
        model = str(params["model"])
        rid = int(params["record_id"])
        values = dict(params["values"])
        kw(model, "write", [[rid], values])
        return {
            "detail": f"Updated {model} #{rid} ({', '.join(values)}).",
            "record_id": rid,
            "url": _form_url(url, model, rid),
        }

    if action == "create_contact":
        vals = {"name": params["name"]}
        for f in ("email", "phone", "city"):
            if params.get(f):
                vals[f] = params[f]
        if params.get("is_company") is not None:
            vals["is_company"] = bool(params["is_company"])
        new_id = kw("res.partner", "create", [vals])
        return {
            "detail": f"Created contact '{params['name']}' (#{new_id}).",
            "record_id": new_id,
            "url": _form_url(url, "res.partner", new_id),
        }

    raise OdooError(f"Unhandled write action '{action}'.")


async def execute_write(
    url: str,
    database: str,
    username: str,
    api_key: str,
    action: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Execute an approved Odoo write action. Raises :class:`OdooError` on failure."""
    return await asyncio.to_thread(
        _execute_write_sync, url, database, username, api_key, action, params
    )

