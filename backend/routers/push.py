"""Push notification API — the iOS app registers its APNs device token here.

Exposes:
  POST   /push/register   — register (or refresh) this device's APNs token
  DELETE /push/register   — unregister this device (e.g. on logout)
  GET    /push/devices    — list the current user's registered devices

The token itself is unique across the table, so a device that re-registers on
each launch simply updates its existing row (and re-homes to the current user
if the phone was handed to a different account).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.device_token import DeviceToken
from models.db.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["push"])

_VALID_PLATFORMS = {"ios"}


class RegisterDeviceRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=512, description="APNs device token (hex)")
    platform: str = Field("ios", max_length=20)
    app_version: str | None = Field(None, max_length=50)


class DeviceTokenOut(BaseModel):
    id: uuid.UUID
    platform: str
    app_version: str | None
    created_at: datetime
    last_seen_at: datetime

    model_config = {"from_attributes": True}


@router.post("/register", response_model=DeviceTokenOut, status_code=status.HTTP_200_OK)
async def register_device(
    body: RegisterDeviceRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeviceTokenOut:
    """Idempotently register the calling device's push token for this user."""
    platform = body.platform if body.platform in _VALID_PLATFORMS else "ios"

    existing = (
        await db.execute(select(DeviceToken).where(DeviceToken.token == body.token))
    ).scalar_one_or_none()

    if existing is not None:
        # Same physical device re-registering: refresh ownership + metadata.
        existing.user_id = user.id
        existing.platform = platform
        existing.app_version = body.app_version
        existing.last_seen_at = datetime.now(timezone.utc)
        row = existing
    else:
        row = DeviceToken(
            user_id=user.id,
            token=body.token,
            platform=platform,
            app_version=body.app_version,
        )
        db.add(row)

    await db.commit()
    await db.refresh(row)
    logger.info("Device registered for push: user=%s platform=%s", user.id, platform)
    return DeviceTokenOut.model_validate(row)


@router.delete("/register", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_device(
    token: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Remove a device token (called on logout / push opt-out)."""
    await db.execute(
        delete(DeviceToken).where(
            DeviceToken.token == token, DeviceToken.user_id == user.id
        )
    )
    await db.commit()


@router.get("/devices", response_model=list[DeviceTokenOut])
async def list_devices(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DeviceTokenOut]:
    """List the calling user's registered devices."""
    rows = (
        await db.execute(
            select(DeviceToken)
            .where(DeviceToken.user_id == user.id)
            .order_by(DeviceToken.last_seen_at.desc())
        )
    ).scalars().all()
    return [DeviceTokenOut.model_validate(r) for r in rows]
