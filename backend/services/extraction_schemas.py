"""Saved extraction schemas — named JSON shapes for vision document extraction.

Stored as a single JSONB list under SystemSetting key "extraction.schemas".
Defaults ship for common document types; saving replaces the whole list.
Each entry: {"name": str, "description": str, "schema": dict}.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.settings import SystemSetting

SETTING_KEY = "extraction.schemas"

DEFAULT_SCHEMAS: list[dict] = [
    {
        "name": "invoice",
        "description": "Vendor invoices and receipts",
        "schema": {
            "vendor": "string",
            "invoice_number": "string",
            "date": "YYYY-MM-DD",
            "due_date": "YYYY-MM-DD or null",
            "line_items": [
                {"description": "string", "quantity": "number", "unit_price": "number", "total": "number"}
            ],
            "subtotal": "number or null",
            "tax": "number or null",
            "total": "number",
            "currency": "string (e.g. USD)",
        },
    },
    {
        "name": "certificate",
        "description": "Certificates of conformance, calibration, or ISO registration",
        "schema": {
            "certificate_type": "string",
            "certificate_number": "string",
            "issued_to": "string",
            "issued_by": "string",
            "standard": "string or null (e.g. ISO 13485)",
            "issue_date": "YYYY-MM-DD",
            "expiry_date": "YYYY-MM-DD or null",
            "scope": "string or null",
        },
    },
    {
        "name": "purchase_order",
        "description": "Purchase orders",
        "schema": {
            "po_number": "string",
            "vendor": "string",
            "buyer": "string",
            "date": "YYYY-MM-DD",
            "line_items": [
                {"description": "string", "quantity": "number", "unit_price": "number", "total": "number"}
            ],
            "total": "number",
            "currency": "string",
        },
    },
    {
        "name": "dd214",
        "description": "DD Form 214 — military discharge/separation record",
        "schema": {
            "name": "string",
            "ssn_last4": "string or null",
            "branch": "string",
            "rank_grade": "string",
            "entry_date": "YYYY-MM-DD",
            "separation_date": "YYYY-MM-DD",
            "character_of_service": "string",
            "decorations": ["string"],
        },
    },
]


class SchemaValidationError(ValueError):
    """Raised when a saved-schemas payload is malformed."""


def validate_schemas(schemas: list) -> list[dict]:
    """Validate shape; returns the cleaned list. Raises SchemaValidationError."""
    if not isinstance(schemas, list):
        raise SchemaValidationError("Expected a JSON list of schema entries.")
    cleaned: list[dict] = []
    seen: set[str] = set()
    for i, entry in enumerate(schemas):
        if not isinstance(entry, dict):
            raise SchemaValidationError(f"Entry {i + 1} is not an object.")
        name = str(entry.get("name", "")).strip()
        if not name:
            raise SchemaValidationError(f"Entry {i + 1} is missing a name.")
        if name.lower() in seen:
            raise SchemaValidationError(f'Duplicate schema name "{name}".')
        seen.add(name.lower())
        schema = entry.get("schema")
        if not isinstance(schema, dict) or not schema:
            raise SchemaValidationError(f'Schema "{name}" must have a non-empty "schema" object.')
        cleaned.append({
            "name": name[:100],
            "description": str(entry.get("description", ""))[:500],
            "schema": schema,
        })
    return cleaned


async def list_schemas(db: AsyncSession) -> list[dict]:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == SETTING_KEY))
    ).scalar_one_or_none()
    if row is None or not isinstance(row.value, list):
        return DEFAULT_SCHEMAS
    return row.value


async def save_schemas(db: AsyncSession, schemas: list) -> list[dict]:
    """Validate and persist the full list (commits). Returns the saved list."""
    cleaned = validate_schemas(schemas)
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == SETTING_KEY))
    ).scalar_one_or_none()
    if row is None:
        row = SystemSetting(
            key=SETTING_KEY,
            value=cleaned,
            description="Saved vision-extraction schemas (name/description/schema).",
        )
        db.add(row)
    else:
        row.value = cleaned
    await db.commit()
    return cleaned


async def find_schema(db: AsyncSession, name: str) -> dict | None:
    """Case-insensitive lookup; returns the entry dict or None."""
    want = name.strip().lower()
    for entry in await list_schemas(db):
        if str(entry.get("name", "")).lower() == want:
            return entry
    return None
