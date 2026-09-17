"""Push notification API.

Web Push (phones and browsers on the hub, VAPID):
  GET    /push/vapid-public-key  — the key a browser subscribes with; 404 when push is off
  POST   /push/subscribe         — record this browser's PushSubscription
  DELETE /push/subscribe         — forget it (endpoint in the query string)
  GET    /push/subscriptions     — the caller's browsers
  POST   /push/test              — push a test message to the caller's browsers

APNs device tokens (an iOS app that was never built; kept for the table):
  POST   /push/register   — register (or refresh) this device's APNs token
  DELETE /push/register   — unregister this device (e.g. on logout)
  GET    /push/devices    — list the current user's registered devices
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from dependencies import get_current_user
from models.db.device_token import DeviceToken
from models.db.user import User
from services.push import web as push

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["push"])

_VALID_PLATFORMS = {"ios"}


# ── Web Push ────────────────────────────────────────────────────────────────────

class WebPushKeys(BaseModel):
    p256dh: str = Field(..., min_length=1, max_length=200)
    auth: str = Field(..., min_length=1, max_length=100)


class WebPushSubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=10, max_length=2000)
    keys: WebPushKeys


class WebPushSubscriptionOut(BaseModel):
    id: uuid.UUID
    endpoint: str
    user_agent: str | None
    created_at: datetime
    last_used_at: datetime | None
    model_config = {"from_attributes": True}


@router.get("/vapid-public-key")
async def vapid_public_key(_user: User = Depends(get_current_user)) -> dict:
    if not push.configured():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Push is not set up on this server.")
    return {"key": settings.vapid_public_key}


@router.post("/subscribe", response_model=WebPushSubscriptionOut)
async def web_push_subscribe(
    body: WebPushSubscribeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WebPushSubscriptionOut:
    if not push.configured():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Push is not set up on this server.")
    if not body.endpoint.startswith("https://"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A push endpoint must be https.")
    row = await push.subscribe(
        db, user.id, body.endpoint, body.keys.p256dh, body.keys.auth, request.headers.get("user-agent")
    )
    await db.commit()
    await db.refresh(row)
    return WebPushSubscriptionOut.model_validate(row)


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def web_push_unsubscribe(
    endpoint: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    await push.unsubscribe(db, user.id, endpoint)
    await db.commit()


@router.get("/subscriptions", response_model=list[WebPushSubscriptionOut])
async def web_push_subscriptions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[WebPushSubscriptionOut]:
    return [WebPushSubscriptionOut.model_validate(r) for r in await push.list_for_user(db, user.id)]


@router.post("/test")
async def web_push_test(user: User = Depends(get_current_user)) -> dict:
    """Push a test message to every browser this person has subscribed."""
    if not push.configured():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Push is not set up on this server.")
    delivered = await push.send_to_user(
        user.id, "Little Gerry", "Notifications reach this device.", "/waiting?tab=notifications", tag="test"
    )
    return {"delivered": delivered}


# ── APNs device tokens ────────────────────────────────────────────────────────────────


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
