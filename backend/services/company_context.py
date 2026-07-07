"""
Company context — a short, always-injected markdown block giving every agent
persistent knowledge of the company (people, products, partners, regulatory
context), independent of Knowledge Base retrieval.

Source of truth is a single shared Google Drive file (Little Gerry is
local-first per install, so this file — not the local DB — is what keeps all
teammates' machines consistent). The local SystemSetting row is a read-through
cache, refreshed on backend startup and via manual refresh; it never diverges
per install by design.

Unlike the Knowledge Base (opt-in RAG via search_knowledge_base), this content
is injected into every agent's system prompt on every turn, so it must stay
small. Long-form documents belong in the Knowledge Base, not here.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.settings import SystemSetting

logger = logging.getLogger(__name__)

MAX_COMPANY_CONTEXT_CHARS = 4_000

KEY_MD = "company.profile_md"
KEY_SYNCED_AT = "company.profile_synced_at"
KEY_DRIVE_FILE_ID = "company.profile_drive_file_id"


async def _read_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return str(row.value) if row and row.value else default


async def _write_setting(db: AsyncSession, key: str, value: str) -> None:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        row = SystemSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    await db.flush()


async def get_company_context(db: AsyncSession) -> str:
    """Return the formatted company-context block for injection into an agent's
    system prompt, from the local cache, or "" if none is cached yet.
    Does NOT hit Drive — this is the fast, per-turn read path.
    """
    content = (await _read_setting(db, KEY_MD, "")).strip()
    if not content:
        return ""
    # Defensive cap on every read — the content originates outside the app.
    content = content[:MAX_COMPANY_CONTEXT_CHARS]
    return (
        "\n\n# COMPANY CONTEXT (always available — do not fabricate beyond this)\n"
        f"{content}\n"
        "For anything beyond this summary, use search_knowledge_base.\n"
    )


async def sync_company_context_from_drive(db: AsyncSession) -> bool:
    """Pull the current content of the designated Drive file and refresh the
    local SystemSetting cache (both the content and the synced-at timestamp).

    Never raises — Google not connected, no file configured, network errors,
    file not found, and over-cap content are all expected conditions: log a
    warning, leave the existing cached value untouched, and return False.
    Returns True on a successful sync (cache updated and committed).
    """
    try:
        from services.google_service import drive_get_content, get_credentials

        if not get_credentials():
            logger.warning("Company context sync skipped: Google not connected.")
            return False

        file_id = (await _read_setting(db, KEY_DRIVE_FILE_ID, "")).strip()
        if not file_id:
            logger.warning("Company context sync skipped: no Drive file ID configured.")
            return False

        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None, lambda: drive_get_content(file_id)
            )
        except Exception as exc:  # noqa: BLE001 — Drive/network errors are expected
            logger.warning("Company context sync failed reading Drive file %s: %s", file_id, exc)
            return False

        content = (result.get("content") or "").strip()
        if not content:
            logger.warning(
                "Company context sync skipped: Drive file %s has no readable text content.",
                file_id,
            )
            return False
        if len(content) > MAX_COMPANY_CONTEXT_CHARS:
            logger.warning(
                "Company context sync skipped: Drive file %s is %d chars (cap is %d) — "
                "trim it; long-form content belongs in the Knowledge Base.",
                file_id,
                len(content),
                MAX_COMPANY_CONTEXT_CHARS,
            )
            return False

        await _write_setting(db, KEY_MD, content)
        await _write_setting(
            db, KEY_SYNCED_AT, datetime.now(timezone.utc).isoformat()
        )
        await db.commit()
        logger.info("Company context synced from Drive file %s (%d chars).", file_id, len(content))
        return True
    except Exception:  # noqa: BLE001 — sync must never take down the caller
        logger.exception("Company context sync failed unexpectedly.")
        try:
            await db.rollback()
        except Exception:
            pass
        return False
