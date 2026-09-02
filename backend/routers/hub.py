"""The hub, seen from the desktop.

Every shared read and write goes over the wire to the hub and nothing is cached
locally, so the hub stays the single copy and custody keeps meaning what it
says. The desktop is a window onto it, not a second master.
"""

from __future__ import annotations

import logging
import os
import threading
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services.hub import client as hub

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hub", tags=["hub"])

# Scopes IAP tokens to the shared workspace. The desktop has no business
# proxying a person's private hub data, and an open proxy would hand the
# renderer a way to call anything at all on the far side.
_ALLOWED_PREFIXES = ("/projects", "/tasks", "/workrooms")

_SCOPES = ["openid", "email"]

# Keyed by auth_id, same shape as the Google SSO flow the login page uses.
_connect_sessions: dict[str, dict] = {}
_connect_lock = threading.Lock()


class ConnectRequest(BaseModel):
    hub_url: str | None = None


class HubStatus(BaseModel):
    available: bool
    connected: bool
    hub_url: str
    email: str | None = None
    last_error: str | None = None


def _hub_url(requested: str | None = None) -> str:
    url = (requested or settings.hub_url or "").strip().rstrip("/")
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No hub address is configured for this build.",
        )
    if not url.startswith("https://"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The hub address must be an https:// URL.",
        )
    return url


def _guard_desktop() -> None:
    if settings.hub_mode:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This is the hub.",
        )


@router.get("/status", response_model=HubStatus)
async def hub_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HubStatus:
    _guard_desktop()
    await hub.ensure_client_file()
    configured = hub.configured()
    link = await hub.get_link(db, current_user.id)
    return HubStatus(
        available=configured,
        connected=link is not None,
        hub_url=(link.hub_url if link else (settings.hub_url or "")),
        email=link.email if link else None,
        last_error=link.last_error if link else None,
    )


def _run_connect_flow(auth_id: str, hub_url: str) -> None:
    """Sign in to Google in a browser and keep the refresh token."""
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow

        # Asking for `email` gets userinfo.email back, so the granted set never
        # equals the requested set and oauthlib would call that an error.
        os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

        client_id, client_secret = hub.desktop_client()
        flow = InstalledAppFlow.from_client_config(
            {
                "installed": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": hub.TOKEN_URL,
                }
            },
            _SCOPES,
        )
        creds = flow.run_local_server(port=0, open_browser=True, prompt="consent")
        if not creds.refresh_token:
            raise ValueError(
                "Google did not return a lasting sign-in. Remove the app from "
                "your Google account permissions and try again."
            )
        from routers.auth import _decode_id_token

        claims = _decode_id_token(creds.id_token) if creds.id_token else {}
        email = (claims.get("email") or "").lower()
        if not email:
            raise ValueError("Google did not say which account signed in.")
        with _connect_lock:
            _connect_sessions[auth_id] = {
                "status": "done",
                "email": email,
                "refresh_token": creds.refresh_token,
                "hub_url": hub_url,
            }
    except Exception as exc:  # noqa: BLE001 — surfaced to the user verbatim
        logger.warning("Hub connect failed: %s", exc)
        with _connect_lock:
            _connect_sessions[auth_id] = {"status": "error", "error_msg": str(exc)}


@router.post("/connect/initiate")
async def connect_initiate(
    body: ConnectRequest | None = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Open a browser so this person can sign in to the hub as themselves."""
    _guard_desktop()
    url = _hub_url(body.hub_url if body else None)
    await hub.ensure_client_file()
    try:
        hub.desktop_client()
    except hub.HubError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    auth_id = str(_uuid.uuid4())
    with _connect_lock:
        _connect_sessions[auth_id] = {"status": "pending"}
    threading.Thread(target=_run_connect_flow, args=(auth_id, url), daemon=True).start()
    return {"auth_id": auth_id}


@router.get("/connect/poll/{auth_id}")
async def connect_poll(
    auth_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _guard_desktop()
    with _connect_lock:
        data = dict(_connect_sessions.get(auth_id, {}))
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such sign-in.")
    if data["status"] == "pending":
        return {"status": "pending"}

    with _connect_lock:
        _connect_sessions.pop(auth_id, None)

    if data["status"] == "error":
        return {"status": "error", "message": data.get("error_msg", "Sign-in failed.")}

    await hub.save_link(
        db,
        current_user.id,
        data["hub_url"],
        data["email"],
        data["refresh_token"],
    )
    await db.commit()
    return {"status": "success", "email": data["email"]}


@router.post("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
async def hub_disconnect(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    _guard_desktop()
    if await hub.disconnect(db, current_user.id):
        await db.commit()


def _check_path(path: str) -> str:
    """Refuse anything outside the shared workspace."""
    target = "/" + path.lstrip("/")
    if ".." in target:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bad path.")
    if not any(
        target == prefix or target.startswith(prefix + "/") for prefix in _ALLOWED_PREFIXES
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only shared project work can be reached through the hub.",
        )
    return target


@router.api_route(
    "/api/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"]
)
async def hub_proxy(
    path: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Pass a shared-workspace call through to the hub and hand back its answer."""
    _guard_desktop()
    target = _check_path(path)

    body: object | None = None
    if request.method in ("POST", "PATCH", "PUT"):
        raw = await request.body()
        if raw:
            try:
                import json

                body = json.loads(raw)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Body must be JSON."
                ) from exc

    try:
        resp = await hub.request(
            db,
            current_user.id,
            request.method,
            target,
            params=dict(request.query_params),
            json_body=body,
        )
    except hub.HubNotConnected as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except hub.HubError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    await db.commit()

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type"),
    )
