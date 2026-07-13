"""Live-document following — Gerry works alongside a Google Doc in real time.

The user pins ("follows") a Drive document to a conversation. On EVERY
subsequent turn the CURRENT contents are re-fetched and injected into the
system prompt, so Gerry always sees the latest edits when she answers —
the practical equivalent of watching the doc while the user writes.

The mapping lives in a SystemSetting row per conversation (the established
sidecar pattern — no schema migration), keyed by conversation id.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.settings import SystemSetting

logger = logging.getLogger(__name__)

_KEY_PREFIX = "chat.live_doc."  # + conversation_id → {"file_id": ..., "name": ...}
MAX_LIVE_DOC_CHARS = 30_000


def extract_drive_file_id(raw: str) -> str:
    """Return the file ID from a bare ID or any pasted Docs/Drive/Sheets URL."""
    raw = (raw or "").strip()
    m = re.search(r"/d/([\w-]{20,})", raw) or re.search(r"[?&]id=([\w-]{20,})", raw)
    return m.group(1) if m else raw


async def get_followed_doc(db: AsyncSession, conversation_id: uuid.UUID) -> dict | None:
    row = (
        await db.execute(
            select(SystemSetting).where(SystemSetting.key == f"{_KEY_PREFIX}{conversation_id}")
        )
    ).scalar_one_or_none()
    return row.value if row is not None and isinstance(row.value, dict) else None


async def set_followed_doc(
    db: AsyncSession, conversation_id: uuid.UUID, file_id: str, name: str, url: str
) -> None:
    key = f"{_KEY_PREFIX}{conversation_id}"
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    value = {"file_id": file_id, "name": name, "url": url}
    if row is None:
        db.add(SystemSetting(key=key, value=value))
    else:
        row.value = value
    await db.flush()


async def clear_followed_doc(db: AsyncSession, conversation_id: uuid.UUID) -> bool:
    key = f"{_KEY_PREFIX}{conversation_id}"
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True


async def build_live_doc_context(db: AsyncSession, conversation_id: uuid.UUID) -> str:
    """Fetch the CURRENT contents of the conversation's followed doc ('' if none).

    Called on every agent turn — this is what makes the follow feel real-time.
    Failures never break the turn; Gerry is told the doc couldn't be re-read.
    """
    doc = await get_followed_doc(db, conversation_id)
    if not doc:
        return ""
    try:
        from services.google_service import drive_get_content, get_credentials

        if not get_credentials():
            return ""
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: drive_get_content(doc["file_id"])
        )
        content = (result.get("content") or "").strip()
        name = result.get("name") or doc.get("name") or "document"
        url = result.get("url") or doc.get("url") or ""
        if not content:
            return (
                f"\n\nLIVE DOCUMENT: \"{name}\" is being followed in this conversation "
                "but it currently has no readable text (it may be empty).\n"
            )
        truncated = ""
        if len(content) > MAX_LIVE_DOC_CHARS:
            content = content[:MAX_LIVE_DOC_CHARS]
            truncated = "\n[...document truncated for length...]"
        return (
            f"\n\nLIVE DOCUMENT (re-read moments ago — this IS the current state of "
            f"\"{name}\", {url}):\n---\n{content}{truncated}\n---\n"
            "The user is actively working on this document. Ground your feedback and "
            "recommendations in the text above; it refreshes on every message.\n"
        )
    except Exception:
        logger.exception("Failed to refresh live document for conversation %s", conversation_id)
        return (
            "\n\nLIVE DOCUMENT: the followed document could not be re-read this turn "
            "(network or permissions). Say so if the user asks about it.\n"
        )
