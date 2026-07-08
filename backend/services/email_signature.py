"""Shared email-signature resolution for every Gerry-drafted email.

The user picks a signature source in the Inbox signature settings:
  "gmail"  — the live Gmail signature of the connected account
  "custom" — a plain-text signature stored in SystemSetting
  "none"   — no signature

Every path that produces a Gerry draft (Inbox reply/compose builders, the
Email Drafts page generator, and the agent's create_email_draft tool) applies
the same resolved signature through this module.
"""

from __future__ import annotations

import html as _html
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

SIG_MODE_KEY = "email.signature_mode"      # "gmail" | "custom" | "none"
SIG_CUSTOM_KEY = "email.signature_custom"  # plain-text signature


async def _get_setting_value(db: AsyncSession, key: str, default):
    from models.db.settings import SystemSetting

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return row.value if row is not None and row.value is not None else default


def html_to_text(html: str) -> str:
    """Crudely flatten an HTML signature to plain text (drafts are plain text)."""
    text = re.sub(r"(?i)<br\s*/?>", "\n", html or "")
    text = re.sub(r"(?i)</p\s*>", "\n", text)
    text = re.sub(r"(?i)</div\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return _html.unescape(text).strip()


async def resolve_signature(db: AsyncSession) -> str:
    """Return the plain-text signature to append to Gerry drafts ('' if none)."""
    mode = str(await _get_setting_value(db, SIG_MODE_KEY, "none"))
    if mode == "custom":
        return str(await _get_setting_value(db, SIG_CUSTOM_KEY, "") or "").strip()
    if mode == "gmail":
        try:
            from services import google_service as gs

            if not gs.get_credentials():
                return ""
            return html_to_text(gs.gmail_get_signature())
        except Exception:
            return ""
    return ""


def apply_signature(body: str, signature: str) -> str:
    """Append the signature to a draft body unless it's already present."""
    body = (body or "").rstrip()
    signature = (signature or "").strip()
    if not signature:
        return body
    if signature in body:
        return body  # already signed (e.g. the model echoed it)
    return f"{body}\n\n{signature}"
