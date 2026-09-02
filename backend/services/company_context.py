"""
Company context — a short, always-injected markdown block giving every agent
persistent knowledge of the company (people, products, partners, regulatory
context), independent of Knowledge Base retrieval.

Source of truth is shared Google Drive content (Little Gerry is local-first
per install, so Drive — not the local DB — is what keeps all teammates'
machines consistent). The configured Drive ID may be either:
  • a single FILE (original mode) — its text is the whole context, or
  • a FOLDER ("company truth folder") — every markdown/text/Google Doc inside
    becomes one SECTION (ordered by filename; prefix names like 01-legal.md to
    control order), composed into the same single cached block.
The local SystemSetting rows are a read-through cache, refreshed on backend
startup and via manual refresh; they never diverge per install by design.

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

# Every agent pays for this on every turn, so the ceiling is a real cost, not
# a formality. Roughly 4k tokens.
MAX_COMPANY_CONTEXT_CHARS = 16_000

KEY_MD = "company.profile_md"
KEY_SYNCED_AT = "company.profile_synced_at"
KEY_DRIVE_FILE_ID = "company.profile_drive_file_id"
# Folder mode: JSON manifest of the synced sections —
# [{"name": str, "file_id": str, "chars": int}] plus skipped-file notes.
KEY_SECTIONS = "company.profile_sections"

# Folder mode accepts these child types as sections.
_SECTION_MIMES = {"text/plain", "text/markdown", "application/vnd.google-apps.document"}
_SECTION_EXTS = (".md", ".markdown", ".txt")


async def _read_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return str(row.value) if row and row.value else default


async def _write_setting(db: AsyncSession, key: str, value) -> None:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        row = SystemSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    await db.flush()


async def get_drive_file_id(db: AsyncSession) -> str:
    """The effective Drive file ID: the local SystemSetting override if set,
    otherwise the default baked into the build (zero per-user setup)."""
    override = (await _read_setting(db, KEY_DRIVE_FILE_ID, "")).strip()
    if override:
        return override
    from config import settings as app_settings

    return (app_settings.company_context_drive_file_id or "").strip()


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


async def get_company_context_for_prompt(db: AsyncSession) -> str:
    """Company facts for one-shot prompts (email drafting, summaries) that have
    no tools to fall back on, so the fallback is a placeholder, not a guess."""
    content = (await _read_setting(db, KEY_MD, "")).strip()
    if not content:
        return ""
    content = content[:MAX_COMPANY_CONTEXT_CHARS]
    return (
        "\n\n# COMPANY CONTEXT — the only facts you may state about PMI\n"
        f"{content}\n"
        "Never invent company details. Addresses, phone numbers, names, titles, "
        "dates, prices and figures must come from this block or from the material "
        "you were given. If a detail you need is missing, write a bracketed "
        "placeholder such as [company address] for the user to fill in.\n"
    )


def _section_title(file_name: str) -> str:
    """Filename → section heading: strip extension and ordering prefix,
    separators → spaces ('02_corporate-structure.md' → 'corporate structure')."""
    import re

    name = file_name
    for ext in _SECTION_EXTS:
        if name.lower().endswith(ext):
            name = name[: -len(ext)]
            break
    name = re.sub(r"^\d+[\s._-]*", "", name)
    return re.sub(r"[_-]+", " ", name).strip() or file_name


async def get_sections_manifest(db: AsyncSession) -> list[dict]:
    """Folder mode's synced-sections manifest, or [] (single-file mode)."""
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == KEY_SECTIONS))
    ).scalar_one_or_none()
    return row.value if row is not None and isinstance(row.value, list) else []


async def _sync_from_folder(db: AsyncSession, folder_id: str) -> bool:
    """Compose the context block from every readable text file in the folder.
    Sections are ordered by filename. Unreadable children are skipped and
    recorded honestly in the manifest — never silently dropped."""
    from services.google_service import drive_get_content, drive_list_folder

    children = await asyncio.get_event_loop().run_in_executor(
        None, lambda: drive_list_folder(folder_id, max_results=50)
    )
    manifest: list[dict] = []
    parts: list[str] = []
    for child in children:
        ctype = child.get("type", "")
        name = child.get("name", "")
        if ctype == "folder":
            continue
        if ctype not in _SECTION_MIMES and not name.lower().endswith(_SECTION_EXTS):
            manifest.append({"name": name, "file_id": child["id"], "chars": 0,
                             "skipped": f"unsupported type ({ctype})"})
            continue
        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None, lambda c=child: drive_get_content(c["id"], max_chars=MAX_COMPANY_CONTEXT_CHARS)
            )
            content = (result.get("content") or "").strip()
        except Exception as exc:  # noqa: BLE001 — skip this section, record why
            logger.warning("Company context: could not read section %s: %s", name, exc)
            manifest.append({"name": name, "file_id": child["id"], "chars": 0,
                             "skipped": "could not read"})
            continue
        if not content:
            manifest.append({"name": name, "file_id": child["id"], "chars": 0,
                             "skipped": "no readable text"})
            continue
        parts.append(f"## {_section_title(name)}\n{content}")
        manifest.append({"name": name, "file_id": child["id"], "chars": len(content)})

    if not parts:
        logger.warning("Company context sync skipped: folder %s has no readable sections.", folder_id)
        return False
    composed = "\n\n".join(parts)
    if len(composed) > MAX_COMPANY_CONTEXT_CHARS:
        logger.warning(
            "Company context sync skipped: folder %s composes to %d chars (cap %d) — "
            "trim sections; long-form content belongs in the Knowledge Base.",
            folder_id, len(composed), MAX_COMPANY_CONTEXT_CHARS,
        )
        return False

    await _write_setting(db, KEY_MD, composed)
    await _write_setting(db, KEY_SECTIONS, manifest)
    await _write_setting(db, KEY_SYNCED_AT, datetime.now(timezone.utc).isoformat())
    await db.commit()
    logger.info(
        "Company context synced from folder %s: %d section(s), %d chars.",
        folder_id, len(parts), len(composed),
    )
    return True


async def sync_company_context_from_drive(db: AsyncSession) -> bool:
    """Pull the current content of the designated Drive file OR folder and
    refresh the local SystemSetting cache (content, sections manifest, and the
    synced-at timestamp).

    Never raises — Google not connected, nothing configured, network errors,
    not found, and over-cap content are all expected conditions: log a
    warning, leave the existing cached value untouched, and return False.
    Returns True on a successful sync (cache updated and committed).
    """
    try:
        from services.google_service import (
            drive_get_content,
            drive_get_file_meta,
            get_credentials,
        )

        if not get_credentials():
            logger.warning("Company context sync skipped: Google not connected.")
            return False

        file_id = await get_drive_file_id(db)
        if not file_id:
            logger.warning("Company context sync skipped: no Drive file ID configured.")
            return False

        # Folder = "company truth folder": one markdown per section.
        try:
            meta = await asyncio.get_event_loop().run_in_executor(
                None, lambda: drive_get_file_meta(file_id)
            )
        except Exception as exc:  # noqa: BLE001 — Drive/network errors are expected
            logger.warning("Company context sync failed reading metadata for %s: %s", file_id, exc)
            return False
        if meta.get("mime_type") == "application/vnd.google-apps.folder":
            return await _sync_from_folder(db, file_id)

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
        await _write_setting(db, KEY_SECTIONS, [])  # single-file mode: no sections
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
