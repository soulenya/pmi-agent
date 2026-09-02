"""Per-user preferences, layered over the system-wide defaults.

A desktop install has one person, so a single SystemSetting row was the whole
story. On the hub the same keys have to answer per person: Aurora's morning
scan runs at seven whether or not Brian turned his off. A missing row means
"use the system default", so nothing had to be backfilled and the desktop
behaves exactly as before.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.settings import UserSetting


async def get(
    db: AsyncSession, user_id: uuid.UUID, key: str, default: Any = None
) -> Any:
    """This user's value for *key*, or *default* when they haven't set one."""
    row = (
        await db.execute(
            select(UserSetting).where(
                UserSetting.user_id == user_id, UserSetting.key == key
            )
        )
    ).scalar_one_or_none()
    if row is None or row.value is None:
        return default
    return _coerce(row.value, default)


async def set_value(
    db: AsyncSession, user_id: uuid.UUID, key: str, value: Any
) -> None:
    """Upsert one preference. Caller commits."""
    row = (
        await db.execute(
            select(UserSetting).where(
                UserSetting.user_id == user_id, UserSetting.key == key
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = UserSetting(user_id=user_id, key=key)
        db.add(row)
    row.value = "" if value is None else str(value)
    await db.flush()


async def all_for(db: AsyncSession, user_id: uuid.UUID) -> dict[str, str]:
    rows = (
        await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
    ).scalars()
    return {r.key: r.value or "" for r in rows}


def _coerce(raw: str, default: Any) -> Any:
    """Values are stored as text; give the caller back the default's type."""
    if isinstance(default, bool):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(default, int):
        try:
            return int(raw)
        except ValueError:
            return default
    return raw
