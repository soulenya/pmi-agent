"""Financial data routes. Mounted only for a brand with the ``finance`` feature.

Everything here is refused to anyone not on the finance list
(``services/finance.py``). A desktop reaches these through the hub proxy
(``/hub/api/finance``).
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services import finance as svc
from services.bank import usbank

router = APIRouter(prefix="/finance", tags=["finance"])


class ViewersIn(BaseModel):
    emails: list[str]


class BankKeysIn(BaseModel):
    api_key: str
    api_secret: str


def _refuse(exc: svc.FinanceError) -> HTTPException:
    code = status.HTTP_403_FORBIDDEN if isinstance(exc, svc.NotAllowed) else status.HTTP_400_BAD_REQUEST
    return HTTPException(code, str(exc))


async def _viewer(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)) -> User:
    try:
        await svc.require_view(db, user)
    except svc.NotAllowed as exc:
        raise _refuse(exc) from exc
    return user


@router.get("/access")
async def get_access(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)) -> dict[str, Any]:
    """Whether this person may see financial data, and may change who can."""
    out = await svc.access(db, user)
    synced = await svc.last_synced(db) if out["can_view"] else None
    source = usbank.keys_source()
    return {
        **out,
        "environment": usbank.environment(),
        "bank_configured": source is not None,
        # Keys saved in the app live on a hub and are an administrator's to set;
        # ones the server is given directly would win over anything saved here.
        "can_save_bank_keys": out["can_view"] and settings.hub_mode and user.role == "admin" and source in (None, "app"),
        "last_synced": synced.isoformat() if synced else None,
    }


@router.put("/bank/keys")
async def put_bank_keys(
    body: BankKeysIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, Any]:
    """Save the bank's API key and secret on a hub. They are never sent back."""
    try:
        await svc.save_bank_keys(db, user, body.api_key, body.api_secret)
    except svc.FinanceError as exc:
        raise _refuse(exc) from exc
    await db.commit()
    return {"bank_configured": usbank.configured()}


@router.put("/viewers")
async def put_viewers(
    body: ViewersIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, Any]:
    try:
        await svc.set_viewers(db, user, body.emails)
    except svc.FinanceError as exc:
        raise _refuse(exc) from exc
    await db.commit()
    return await svc.access(db, user)


@router.get("/bank/accounts")
async def bank_accounts(db: AsyncSession = Depends(get_db), _user: User = Depends(_viewer)) -> list[dict]:
    return await svc.list_accounts(db)


@router.get("/bank/transactions")
async def bank_transactions(
    account_id: uuid.UUID | None = None,
    q: str | None = None,
    start: date | None = None,
    end: date | None = None,
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(_viewer),
) -> list[dict]:
    return await svc.list_transactions(db, account_id=account_id, q=q, start=start, end=end, limit=limit)


@router.post("/bank/sync")
async def bank_sync(db: AsyncSession = Depends(get_db), _user: User = Depends(_viewer)) -> dict[str, Any]:
    """Read the bank now. Only reads; the tables here are updated."""
    try:
        report = await svc.sync_bank(db)
    except usbank.BankUnavailable as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except usbank.BankError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    await db.commit()
    return report


@router.get("/overview")
async def get_overview(
    search: str = "",
    days: int = Query(30, ge=1, le=730),
    limit: int = Query(40, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """What Gerry reads: balances and recent or matching transactions."""
    try:
        return await svc.overview(db, user, search=search, days=days, limit=limit)
    except svc.FinanceError as exc:
        raise _refuse(exc) from exc
