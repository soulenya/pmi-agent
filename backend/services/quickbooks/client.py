"""Intuit QuickBooks Online: the sign-in, and reading. Nothing here changes the books.

Intuit's permission for accounting data (``com.intuit.quickbooks.accounting``)
covers writing as well as reading; there is no read-only one. What keeps this
read-only is that ``read`` is the only way a request reaches the books, and
it is a GET.

Sign-in is OAuth 2.0 with the authorization code: a person approves in their
browser, Intuit sends them back to ``redirect_uri()`` with a code, and the
code is exchanged for an access token (one hour) and a refresh token (about a
hundred days, and replaced by a new one as it is used).

The app's client ID and secret come from the environment
(``QUICKBOOKS_CLIENT_ID``, ``QUICKBOOKS_CLIENT_SECRET``), then the OS keyring,
then what a hub's administrator saved in the app.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from config import _keyring_get, settings
from services import secret_store

AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2"
TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"
SCOPE = "com.intuit.quickbooks.accounting"
# Intuit retires older minor versions; this pins the shape of what comes back.
MINOR_VERSION = "75"
_HOSTS = {
    "sandbox": "https://sandbox-quickbooks.api.intuit.com",
    "production": "https://quickbooks.api.intuit.com",
}
_NAMES = ("quickbooks_client_id", "quickbooks_client_secret")


class QuickBooksError(Exception):
    """Intuit answered, and refused."""


class QuickBooksUnavailable(QuickBooksError):
    """Intuit could not be reached, or this install is not set up for it."""


class ReconnectNeeded(QuickBooksError):
    """Intuit no longer accepts the saved sign-in: a person has to connect again."""


class Unauthorized(QuickBooksError):
    """The access token was refused; a fresh one may work."""


@dataclass
class Tokens:
    access: str
    refresh: str
    access_seconds: int
    refresh_seconds: int


def _stored(name: str) -> str:
    return (os.environ.get(name.upper()) or _keyring_get(name) or secret_store.get(name) or "").strip()


def credentials() -> tuple[str, str] | None:
    """(client ID, client secret), or None when either is missing."""
    client_id, secret = (_stored(n) for n in _NAMES)
    return (client_id, secret) if client_id and secret else None


def configured() -> bool:
    return credentials() is not None


def keys_source() -> str | None:
    """Where the keys come from: 'server', 'keyring', 'app', or None when there are none."""
    if not configured():
        return None
    if all(os.environ.get(n.upper()) for n in _NAMES):
        return "server"
    if all(_keyring_get(n) for n in _NAMES):
        return "keyring"
    return "app"


def environment() -> str:
    for value in (settings.quickbooks_environment, secret_store.get("quickbooks_environment")):
        if value in _HOSTS:
            return value
    return "sandbox"


def redirect_uri() -> str:
    if settings.quickbooks_redirect_uri:
        return settings.quickbooks_redirect_uri
    if settings.hub_mode and settings.hub_url:
        return settings.hub_url.rstrip("/") + "/api/quickbooks/callback"
    return f"http://localhost:{settings.port}/api/quickbooks/callback"


async def _send(method: str, url: str, **kwargs: Any) -> httpx.Response:
    """The one place a request leaves; tests replace it."""
    async with httpx.AsyncClient(timeout=45) as client:
        return await client.request(method, url, **kwargs)


def _creds() -> tuple[str, str]:
    creds = credentials()
    if creds is None:
        raise QuickBooksUnavailable("The QuickBooks client ID and secret are not set on this server.")
    return creds


def authorize_url(state: str) -> str:
    """Where to send the person to approve the connection."""
    return AUTHORIZE_URL + "?" + urlencode({
        "client_id": _creds()[0],
        "response_type": "code",
        "scope": SCOPE,
        "redirect_uri": redirect_uri(),
        "state": state,
    })


async def _token_request(data: dict[str, str], *, refreshing: bool) -> Tokens:
    try:
        resp = await _send("POST", TOKEN_URL, auth=_creds(), headers={"Accept": "application/json"}, data=data)
    except httpx.HTTPError as exc:
        raise QuickBooksUnavailable(f"Could not reach Intuit: {exc}") from exc
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if resp.status_code == 200 and body.get("access_token") and body.get("refresh_token"):
        return Tokens(
            access=body["access_token"],
            refresh=body["refresh_token"],
            access_seconds=int(body.get("expires_in") or 3600),
            refresh_seconds=int(body.get("x_refresh_token_expires_in") or 0),
        )
    if resp.status_code >= 500:
        raise QuickBooksUnavailable(f"Intuit is not answering ({resp.status_code}).")
    error = str(body.get("error") or "")
    if error == "invalid_client":
        raise QuickBooksError("Intuit did not accept this app's client ID and secret.")
    if error == "invalid_grant" and refreshing:
        raise ReconnectNeeded("QuickBooks needs to be connected again: Intuit no longer accepts the saved sign-in.")
    reason = body.get("error_description") or error or f"status {resp.status_code}"
    raise QuickBooksError(f"Intuit refused the sign-in: {reason}.")


async def exchange(code: str) -> Tokens:
    """Turn the code Intuit sent back with the person into tokens."""
    return await _token_request(
        {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri()}, refreshing=False
    )


async def refresh(refresh_token: str) -> Tokens:
    """A new access token, and the refresh token that replaces the one given."""
    return await _token_request({"grant_type": "refresh_token", "refresh_token": refresh_token}, refreshing=True)


async def revoke(token: str) -> bool:
    """Tell Intuit to forget this sign-in. True when it said it did."""
    try:
        resp = await _send(
            "POST", REVOKE_URL, auth=_creds(), headers={"Accept": "application/json"}, json={"token": token}
        )
    except (httpx.HTTPError, QuickBooksError):
        return False
    return resp.status_code == 200


async def keys_refused(client_id: str, secret: str) -> bool:
    """True when Intuit says this client ID and secret are not a pair it knows.

    Asked with a code that cannot be real: a known pair is told the code is
    invalid, an unknown pair is told the client is.
    """
    try:
        resp = await _send(
            "POST", TOKEN_URL, auth=(client_id, secret), headers={"Accept": "application/json"},
            data={"grant_type": "authorization_code", "code": "checking-the-keys", "redirect_uri": redirect_uri()},
        )
        return resp.json().get("error") == "invalid_client"
    except (httpx.HTTPError, ValueError, AttributeError):
        return False  # could not ask; do not block saving on that


def _fault(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        fault = body.get("Fault") or body.get("fault") or {}
        error = (fault.get("Error") or fault.get("error") or [{}])[0]
        message = error.get("Message") or error.get("message") or ""
        detail = error.get("Detail") or error.get("detail") or ""
    except (ValueError, AttributeError, IndexError, TypeError):
        message = detail = ""
    text = "; ".join(dict.fromkeys(p.strip() for p in (message, detail) if p and p.strip()))
    return f"QuickBooks refused the request ({resp.status_code})" + (f": {text}" if text else ".")


async def read(env: str, realm_id: str, access_token: str, path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
    """GET one thing from a QuickBooks company. The only call that reaches the books."""
    url = f"{_HOSTS[env]}/v3/company/{realm_id}/{path}"
    try:
        resp = await _send(
            "GET", url,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            params={**(params or {}), "minorversion": MINOR_VERSION},
        )
    except httpx.HTTPError as exc:
        raise QuickBooksUnavailable(f"Could not reach QuickBooks: {exc}") from exc
    if resp.status_code == 401:
        raise Unauthorized(_fault(resp))
    if resp.status_code == 429:
        raise QuickBooksUnavailable("QuickBooks is limiting requests just now. Try again in a minute.")
    if resp.status_code >= 500:
        raise QuickBooksUnavailable(f"QuickBooks is not answering ({resp.status_code}).")
    if resp.status_code != 200:
        raise QuickBooksError(_fault(resp))
    return resp.json()
