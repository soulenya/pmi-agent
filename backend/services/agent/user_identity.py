"""Current-user identity block for agent system prompts.

Both chat engines inject this so Gerry always knows WHO she is assisting —
their name for sign-offs, their app account email, and (when Google is
connected) the Gmail address mail actually sends from. Fixes the "placeholder
sign-off since I don't know which account this is" failure mode.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# The connected Gmail address changes rarely — cache it for the process
# lifetime so every chat turn doesn't cost a Google API round-trip.
_gmail_cache: str | None = None
_gmail_checked = False


async def _connected_gmail() -> str:
    global _gmail_cache, _gmail_checked
    if _gmail_checked:
        return _gmail_cache or ""
    _gmail_checked = True
    try:
        from services.google_service import get_credentials, gmail_profile_email

        if get_credentials():
            _gmail_cache = await asyncio.get_event_loop().run_in_executor(
                None, gmail_profile_email
            )
    except Exception:
        _gmail_cache = ""
    return _gmail_cache or ""


async def get_user_identity_context(db: AsyncSession, user_id: uuid.UUID) -> str:
    """Return a short CURRENT USER block for the system prompt ('' on failure)."""
    try:
        from models.db.user import User

        user = (
            await db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if user is None:
            return ""
        name = (user.display_name or "").strip()
        email = (user.email or "").strip()
        gmail = await _connected_gmail()
        lines = [
            "\nCURRENT USER: You are assisting "
            + (f"{name} ({email})" if name else email or "an unknown user")
            + "."
        ]
        if gmail:
            lines.append(
                f"Their connected Google account (email sends from this address): {gmail}."
            )
        if name:
            lines.append(
                f"Sign emails and documents you draft for them as \"{name}\" — never a placeholder."
            )
        lines.append(
            "If this person appears in the COMPANY CONTEXT Key People list, use that "
            "entry for their role, title, and company email address."
        )
        return "\n".join(lines) + "\n"
    except Exception:
        logger.exception("Failed to build user identity context")
        return ""
