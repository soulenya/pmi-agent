"""QuickBooks routes: the connection, reports and lists. Mounted only with the ``finance`` feature.

Everything under ``/finance/quickbooks`` is refused to anyone not on the
finance list, and a desktop reaches it through the hub proxy
(``/hub/api/finance/quickbooks``). ``/api/quickbooks/callback`` is where
Intuit sends a person's browser back after they approve; it carries no
session, so it trusts only the signed ``state`` this server issued.
"""

from __future__ import annotations

import html
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from brand import get_brand
from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services import finance
from services.quickbooks import client
from services.quickbooks import service as svc

router = APIRouter(prefix="/finance/quickbooks", tags=["finance"])
callback_router = APIRouter(tags=["finance"])


class KeysIn(BaseModel):
    client_id: str
    client_secret: str
    environment: str = "sandbox"


def _refuse(exc: Exception) -> HTTPException:
    if isinstance(exc, finance.NotAllowed):
        code = status.HTTP_403_FORBIDDEN
    elif isinstance(exc, (client.ReconnectNeeded, svc.NotConnected)):
        code = status.HTTP_409_CONFLICT
    elif isinstance(exc, client.QuickBooksUnavailable):
        code = status.HTTP_503_SERVICE_UNAVAILABLE
    elif isinstance(exc, client.QuickBooksError):
        code = status.HTTP_502_BAD_GATEWAY
    else:
        code = status.HTTP_400_BAD_REQUEST
    return HTTPException(code, str(exc))


_ERRORS = (finance.FinanceError, client.QuickBooksError)


@router.get("/status")
async def get_status(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return await svc.status(db, user)
    except _ERRORS as exc:
        raise _refuse(exc) from exc


@router.put("/keys")
async def put_keys(
    body: KeysIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, Any]:
    """Save the Intuit app's client ID and secret on a hub. They are never sent back."""
    try:
        await svc.save_keys(db, user, body.client_id, body.client_secret, body.environment)
        await db.commit()
        return await svc.status(db, user)
    except _ERRORS as exc:
        raise _refuse(exc) from exc


@router.post("/connect")
async def connect(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)) -> dict[str, str]:
    """The Intuit address where this person approves the connection."""
    try:
        return {"url": await svc.connect_url(db, user)}
    except _ERRORS as exc:
        raise _refuse(exc) from exc


@router.post("/disconnect")
async def disconnect(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)) -> dict[str, Any]:
    try:
        out = await svc.disconnect(db, user)
    except _ERRORS as exc:
        raise _refuse(exc) from exc
    await db.commit()
    return out


@router.get("/reports/{name}")
async def get_report(
    name: str,
    start: date | None = None,
    end: date | None = None,
    by: str = "",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return await svc.report(db, user, name, start=start, end=end, by=by)
    except _ERRORS as exc:
        raise _refuse(exc) from exc


@router.get("/lists/{dataset}")
async def get_list(
    dataset: str,
    search: str = "",
    days: int = Query(365, ge=1, le=3650),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return await svc.listing(db, user, dataset, search=search, days=days, limit=limit)
    except _ERRORS as exc:
        raise _refuse(exc) from exc


def _page(title: str, message: str, *, ok: bool) -> HTMLResponse:
    app_name = html.escape(get_brand().product_name)
    body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.25rem;color:#1c1917}}
h1{{font-size:1.25rem}}p{{color:#57534e}}</style></head>
<body><h1>{html.escape(title)}</h1><p>{html.escape(message)}</p>
<p>You can close this tab and go back to {app_name}.</p></body></html>"""
    return HTMLResponse(body, status_code=200 if ok else 400)


@callback_router.get("/api/quickbooks/callback", include_in_schema=False)
async def callback(
    code: str = "",
    state: str = "",
    realmId: str = "",  # noqa: N803 - Intuit's name for it
    error: str = "",
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    """Intuit sends the person here after they approve, or decline."""
    if error:
        declined = error == "access_denied"
        return _page(
            "QuickBooks was not connected",
            "The connection was declined at Intuit." if declined else "Intuit did not complete the connection.",
            ok=False,
        )
    # Every refusal below happens before anything is written, so there is nothing to undo.
    try:
        conn = await svc.finish_connect(db, code=code, state=state, realm_id=realmId)
        await db.commit()
    except _ERRORS as exc:
        return _page("QuickBooks was not connected", str(exc), ok=False)
    return _page("QuickBooks is connected", f"Connected to {conn.company_name}. Only reading is done through it.", ok=True)
