"""Gerry's sidecar contact store (Phase 4).

Contacts are auto-derived from inbox senders and editable by hand. They live in
the ``SystemSetting`` JSONB row under :data:`CONTACTS_KEY` (no Gmail write, no
``gmail.modify`` scope, no new DB table) and tie into the email tag memory.

Stored shape — a dict keyed by lowercase email::

    {
      "smith@acme.com": {
        "email": "smith@acme.com", "name": "John Smith", "company": "Acme",
        "domain": "acme.com", "notes": "", "source": "derived" | "manual",
        "count": 12, "last_seen": "2026-06-30T12:00:00+00:00"
      }
    }
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.settings import SystemSetting

CONTACTS_KEY = "email.contacts"

# Personal-email providers — we never guess a company name from these.
_GENERIC_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com",
    "hotmail.com", "live.com", "icloud.com", "me.com", "mac.com", "aol.com",
    "proton.me", "protonmail.com", "msn.com", "gmx.com", "mail.com",
}


def extract_email(addr: str) -> str:
    """Return the bare, lowercased email from a 'Name <email>' header."""
    m = re.search(r"<([^>]+)>", addr or "")
    return (m.group(1) if m else (addr or "")).strip().lower()


def extract_name(addr: str) -> str:
    """Return the display name from a 'Name <email>' header ('' if none)."""
    raw = (addr or "").strip()
    m = re.match(r'^\s*"?([^"<]+?)"?\s*<.*>$', raw)
    return m.group(1).strip() if m else ""


def domain_of(email: str) -> str:
    """Return the lowercase domain part of an email ('' if none)."""
    email = (email or "").strip().lower()
    return email.rsplit("@", 1)[-1] if "@" in email else ""


def company_from_domain(domain: str) -> str:
    """Best-effort company label from a domain ('' for personal providers)."""
    domain = (domain or "").strip().lower()
    if not domain or domain in _GENERIC_DOMAINS:
        return ""
    label = domain.split(".")[0]
    return label.capitalize() if label else ""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_contacts(db: AsyncSession) -> dict:
    """Load the contact store ({} if unset)."""
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == CONTACTS_KEY))
    ).scalar_one_or_none()
    val = row.value if row is not None and row.value is not None else {}
    return val if isinstance(val, dict) else {}


async def save_contacts(db: AsyncSession, contacts: dict, user_id) -> None:
    """Persist the contact store. A fresh top-level dict is stored so the JSONB
    column is reliably flagged dirty even after in-place edits."""
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == CONTACTS_KEY))
    ).scalar_one_or_none()
    payload = dict(contacts)
    if row is None:
        db.add(SystemSetting(key=CONTACTS_KEY, value=payload, updated_by=user_id))
    else:
        row.value = payload
        row.updated_by = user_id
    await db.flush()


async def derive_from_senders(db: AsyncSession, senders: list[str], user_id) -> dict:
    """Upsert contacts from raw 'From' header values. Returns
    ``{added, updated, total}``. Manually edited fields are never overwritten."""
    contacts = await get_contacts(db)
    now = _now_iso()
    added = 0
    updated = 0
    for raw in senders:
        email = extract_email(raw)
        if not email or "@" not in email:
            continue
        name = extract_name(raw)
        domain = domain_of(email)
        existing = contacts.get(email)
        if existing is None:
            contacts[email] = {
                "email": email,
                "name": name,
                "company": company_from_domain(domain),
                "domain": domain,
                "notes": "",
                "source": "derived",
                "count": 1,
                "last_seen": now,
            }
            added += 1
        else:
            existing["count"] = int(existing.get("count", 0) or 0) + 1
            existing["last_seen"] = now
            if not existing.get("name") and name and existing.get("source") != "manual":
                existing["name"] = name
            if not existing.get("domain"):
                existing["domain"] = domain
            updated += 1
    await save_contacts(db, contacts, user_id)
    return {"added": added, "updated": updated, "total": len(contacts)}


def search_contacts_store(contacts: dict, query: str, limit: int = 10) -> list[dict]:
    """Filter + rank contacts by a free-text query (name/email/company/domain).

    An empty query returns the most-seen contacts. Results are ordered by how
    often the contact has been seen, then alphabetically.
    """
    q = (query or "").strip().lower()
    items = [c for c in contacts.values() if isinstance(c, dict)]
    if q:
        items = [
            c for c in items
            if q in (c.get("name", "") or "").lower()
            or q in (c.get("email", "") or "").lower()
            or q in (c.get("company", "") or "").lower()
            or q in (c.get("domain", "") or "").lower()
        ]
    items.sort(
        key=lambda c: (
            -int(c.get("count", 0) or 0),
            (c.get("name") or c.get("email") or "").lower(),
        )
    )
    return items[:limit]
