"""Talking to the hub from a desktop install.

The desktop is a full application in its own right; the hub is a second one
that happens to hold the shared project spaces. Rather than copy that data down
and reconcile it later, the desktop asks the hub directly and shows the answer.
Nothing shared is ever stored locally, so there is nothing to fall out of step.

Two credentials are in play on every call, and they are not the same thing:

* IAP guards the door. It wants a Google ID token, sent in ``Proxy-Authorization``
  rather than ``Authorization`` because the application behind it uses
  ``Authorization`` for its own sessions.
* The hub application wants its own session token, which it issues from
  ``POST /auth/iap`` once IAP has vouched for who is calling.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.hub_link import HubLink

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"

# IAP tokens last an hour. Renew a little early so a call that is already in
# flight when the clock runs out does not fail for the sake of a few seconds.
_SKEW_SECONDS = 300


class HubError(Exception):
    """Something went wrong reaching the hub. The message is shown to the user."""


class HubNotConnected(HubError):
    pass


@dataclass
class _Cached:
    value: str
    expires_at: float


# Keyed by user id. Process-level: tokens are short-lived and a restart simply
# fetches new ones, so persisting them would add risk without adding value.
_id_tokens: dict[uuid.UUID, _Cached] = {}
_session_tokens: dict[uuid.UUID, _Cached] = {}


def _fernet() -> Fernet:
    return Fernet(settings.fernet_key)


def encrypt(raw: str) -> str:
    return _fernet().encrypt(raw.encode()).decode()


def decrypt(raw: str) -> str:
    try:
        return _fernet().decrypt(raw.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise HubError(
            "The saved hub credential can't be read on this machine. "
            "Disconnect and connect again."
        ) from exc


def desktop_client() -> tuple[str, str]:
    """The OAuth client the hub's IAP accepts for programmatic access.

    This is deliberately not the same client the app uses for Google sign-in:
    IAP only lets through tokens minted by a client on its allowlist.
    """
    client_id = settings.hub_desktop_client_id.strip()
    client_secret = settings.hub_desktop_client_secret.strip()
    if not client_id or not client_secret:
        raise HubError(
            "This build has no hub sign-in client configured, so it cannot reach "
            "the hub. Ask an administrator to set the hub desktop client."
        )
    return client_id, client_secret


async def get_link(db: AsyncSession, user_id: uuid.UUID) -> HubLink | None:
    return (
        await db.execute(select(HubLink).where(HubLink.user_id == user_id))
    ).scalar_one_or_none()


async def save_link(
    db: AsyncSession,
    user_id: uuid.UUID,
    hub_url: str,
    email: str,
    refresh_token: str,
) -> HubLink:
    link = await get_link(db, user_id)
    if link is None:
        link = HubLink(user_id=user_id, hub_url=hub_url, email=email, refresh_token_encrypted="")
        db.add(link)
    link.hub_url = hub_url.rstrip("/")
    link.email = email
    link.refresh_token_encrypted = encrypt(refresh_token)
    link.last_error = None
    await db.flush()
    _forget(user_id)
    return link


async def disconnect(db: AsyncSession, user_id: uuid.UUID) -> bool:
    link = await get_link(db, user_id)
    if link is None:
        return False
    await db.delete(link)
    _forget(user_id)
    return True


def _forget(user_id: uuid.UUID) -> None:
    _id_tokens.pop(user_id, None)
    _session_tokens.pop(user_id, None)


async def _id_token(link: HubLink) -> str:
    """A Google ID token IAP will accept, minted from the stored refresh token."""
    cached = _id_tokens.get(link.user_id)
    if cached is not None and cached.expires_at > time.time():
        return cached.value

    client_id, client_secret = desktop_client()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": decrypt(link.refresh_token_encrypted),
                    "grant_type": "refresh_token",
                },
            )
    except httpx.HTTPError as exc:
        raise HubError(f"Couldn't reach Google to renew the hub sign-in: {exc}") from exc

    if resp.status_code != 200:
        # A revoked or expired grant is the common case and reconnecting fixes
        # it, so say that rather than showing Google's raw error.
        raise HubError(
            "The hub sign-in has expired. Connect to the hub again from Settings."
        )
    payload = resp.json()
    token = payload.get("id_token")
    if not token:
        raise HubError("Google did not return an identity token for the hub.")

    expires_in = int(payload.get("expires_in") or 3600)
    _id_tokens[link.user_id] = _Cached(token, time.time() + max(expires_in - _SKEW_SECONDS, 60))
    return token


async def _session_token(link: HubLink) -> str:
    """The hub application's own session token for this person."""
    cached = _session_tokens.get(link.user_id)
    if cached is not None and cached.expires_at > time.time():
        return cached.value

    id_token = await _id_token(link)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            resp = await client.post(
                f"{link.hub_url}/auth/iap",
                headers={"Proxy-Authorization": f"Bearer {id_token}"},
            )
    except httpx.HTTPError as exc:
        raise HubError(f"Couldn't reach the hub: {exc}") from exc

    if resp.status_code in (401, 403):
        raise HubError(
            "The hub refused the sign-in. Your account may not have access yet."
        )
    if resp.status_code >= 400:
        raise HubError(f"The hub refused the sign-in ({resp.status_code}).")

    payload = resp.json()
    token = payload.get("access_token")
    if not token:
        raise HubError("The hub did not return a session.")
    expires_in = int(payload.get("expires_in") or 3600)
    _session_tokens[link.user_id] = _Cached(
        token, time.time() + max(expires_in - _SKEW_SECONDS, 60)
    )
    return token


async def request(
    db: AsyncSession,
    user_id: uuid.UUID,
    method: str,
    path: str,
    *,
    params: dict | None = None,
    json_body: object | None = None,
) -> httpx.Response:
    """Make one call to the hub as this user."""
    link = await get_link(db, user_id)
    if link is None:
        raise HubNotConnected("This machine is not connected to the hub.")

    async def _send(session_token: str) -> httpx.Response:
        headers = {
            "Proxy-Authorization": f"Bearer {await _id_token(link)}",
            "Authorization": f"Bearer {session_token}",
        }
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            return await client.request(
                method.upper(),
                f"{link.hub_url}{path}",
                headers=headers,
                params=params,
                json=json_body,
            )

    try:
        resp = await _send(await _session_token(link))
        # The hub can revoke a session before it expires; one silent retry with
        # a fresh one is the difference between a working page and a logout.
        if resp.status_code == 401:
            _session_tokens.pop(user_id, None)
            resp = await _send(await _session_token(link))
    except HubError:
        raise
    except httpx.HTTPError as exc:
        raise HubError(f"Couldn't reach the hub: {exc}") from exc

    link.last_ok_at = _now()
    link.last_error = None
    return resp


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)
