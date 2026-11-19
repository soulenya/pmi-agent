"""The setup guide: what the first-open "Would you like to..." popup needs to know.

The popup itself, and everything it explains, lives in the frontend
(components/setup). This answers the three things only the server knows:
whether this person has put the guide away, where each provider key comes
from, and whether they are allowed to set one.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from brand import get_brand
from config import settings
from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services import secret_store, user_settings
from services.push import web as web_push

router = APIRouter(prefix="/setup-guide", tags=["setup-guide"])

_DISMISSED = "setup_guide.dismissed"


class SetupGuideOut(BaseModel):
    #: The brand shows the guide by itself on first open.
    enabled: bool
    #: This person has closed it for good ("Don't show this again").
    dismissed: bool
    on_hub: bool
    #: A desktop user manages their own keys; on a hub only an administrator does.
    can_set_keys: bool
    #: Per provider: "server" (set by whoever runs the server; not changeable
    #: here), "keyring", "app" (saved in the app), or null when there is none.
    keys: dict[str, str | None]
    #: The server can send notifications to a browser or phone.
    push_ready: bool


class SetupGuideIn(BaseModel):
    dismissed: bool


async def _state(db: AsyncSession, user: User) -> SetupGuideOut:
    return SetupGuideOut(
        enabled=get_brand().feature("setup_guide"),
        dismissed=bool(await user_settings.get(db, user.id, _DISMISSED, False)),
        on_hub=settings.hub_mode,
        can_set_keys=(not settings.hub_mode) or user.role == "admin",
        keys={p: secret_store.key_source(p) for p in secret_store.PROVIDERS},
        push_ready=settings.hub_mode and web_push.configured(),
    )


@router.get("", response_model=SetupGuideOut)
async def get_setup_guide(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SetupGuideOut:
    return await _state(db, user)


@router.put("", response_model=SetupGuideOut)
async def put_setup_guide(
    body: SetupGuideIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SetupGuideOut:
    await user_settings.set_value(db, user.id, _DISMISSED, body.dismissed)
    await db.commit()
    return await _state(db, user)
