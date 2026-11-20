"""U.S. Bank, Corporate Account Information API v2: accounts, balances, transactions.

Read-only. The API key and secret are exchanged for a token that lasts about
fifteen minutes; every data call carries it. Which environment is used is
``settings.usbank_environment``:

- ``sandbox``: simulated data, sign-in with the key and secret alone.
- ``certification`` / ``production``: the same sign-in request, but every
  connection must also present the company's own certificate (mutual TLS):
  ``usbank_client_cert_file`` (the full chain: the company's certificate, the
  intermediate, the root, in one PEM file) and ``usbank_client_key_file``.
  The certificate has to allow client authentication and come from an
  authority the bank accepts; the bank installs it during onboarding.

The sign-in address for the certificate environments is the one in the
bank's general mTLS guide. That guide says a product's Security guide has the
definitive address, so ``usbank_token_url`` overrides it. **This path has
been exercised against a local server that demands a client certificate, not
against the bank**: that needs the bank's onboarding.

What the sandbox taught that the specification does not say: dates are
``YYYY-MM-DD`` only; ``pageSize`` is refused without ``pageNumber``; amounts
and balances arrive as strings. The bank's testing guide shows certification
returning amounts as numbers, dates with a time and ``CREDIT`` in capitals;
``services/finance`` reads both.
"""

from __future__ import annotations

import functools
import os
import ssl
import time
import uuid
from datetime import date
from typing import Any

import httpx

from config import _keyring_get, settings
from services import secret_store

_API = "/commercial-banking/account-management/v2"
_HOSTS = {
    "sandbox": "https://sandbox.usbank.com",
    "certification": "https://cert-api2.usbank.com",
    "production": "https://api2.usbank.com",
}
_SANDBOX_TOKEN = "/oauth2/client-credentials/v2/token"
_TOKEN = "/auth/oauth2/v1/token"
_PAGE = 100
# environment -> (token, good until, in monotonic seconds)
_tokens: dict[str, tuple[str, float]] = {}


class BankError(Exception):
    """The bank answered, and refused."""


class BankUnavailable(BankError):
    """The bank could not be reached, or this install is not set up for it."""


def environment() -> str:
    return settings.usbank_environment if settings.usbank_environment in _HOSTS else "sandbox"


def credentials() -> tuple[str, str] | None:
    """(API key, secret): the environment, then the OS keyring, then what a hub's administrator saved in the app."""
    key = (settings.get_api_key("usbank") or "").strip()
    secret = (
        os.environ.get("USBANK_API_SECRET") or _keyring_get("usbank_api_secret")
        or secret_store.get("usbank_api_secret") or ""
    ).strip()
    return (key, secret) if key and secret else None


def configured() -> bool:
    return credentials() is not None


def keys_source() -> str | None:
    """Where the key and secret come from: 'server', 'keyring', 'app', or None when there are none."""
    if not configured():
        return None
    if os.environ.get("USBANK_API_KEY") and os.environ.get("USBANK_API_SECRET"):
        return "server"
    if _keyring_get("usbank_api_key") and _keyring_get("usbank_api_secret"):
        return "keyring"
    return "app"


async def keys_refused(key: str, secret: str) -> bool:
    """True when the bank turns this key and secret away. Only the sandbox can be asked without a certificate."""
    if environment() != "sandbox":
        return False
    try:
        resp = await _send("POST", token_url(), auth=(key, secret), data={"grant_type": "client_credentials"})
    except (httpx.HTTPError, BankError):
        return False  # could not ask; do not block saving on that
    return resp.status_code in (401, 403)


def forget_tokens() -> None:
    """Drop any sign-in held in memory, so the next call signs in afresh (the keys changed)."""
    _tokens.clear()


def token_url() -> str:
    env = environment()
    return settings.usbank_token_url.strip() or _HOSTS[env] + (_SANDBOX_TOKEN if env == "sandbox" else _TOKEN)


def certificate() -> tuple[str, str] | None:
    """(certificate chain file, private key file) for mutual TLS; None when either is not set."""
    cert, key = settings.usbank_client_cert_file.strip(), settings.usbank_client_key_file.strip()
    return (cert, key) if cert and key else None


@functools.lru_cache(maxsize=4)
def _identity(cert: str, key: str, password: str, ca: str) -> ssl.SSLContext:
    context = httpx.create_ssl_context()
    if ca:
        context.load_verify_locations(cafile=ca)
    # A passphrase is always supplied, even an empty one: without it an
    # encrypted key would make OpenSSL stop and ask at the terminal.
    context.load_cert_chain(certfile=cert, keyfile=key, password=lambda: password)
    return context


def _verify() -> ssl.SSLContext | bool:
    """How a connection proves who it is: nothing extra in the sandbox, the company's certificate elsewhere."""
    if environment() == "sandbox":
        return True
    found = certificate()
    if found is None:
        raise BankUnavailable(
            f"U.S. Bank's {environment()} environment needs the company's certificate and private key. "
            "Neither file is set on this server."
        )
    password = os.environ.get("USBANK_CLIENT_KEY_PASSWORD") or _keyring_get("usbank_client_key_password") or ""
    try:
        return _identity(*found, password, settings.usbank_ca_file.strip())
    except (OSError, ssl.SSLError, ValueError) as exc:
        raise BankUnavailable(f"The company's certificate or private key for U.S. Bank could not be loaded: {exc}") from exc


async def _send(method: str, url: str, **kwargs: Any) -> httpx.Response:
    """The one place a request leaves; tests replace it."""
    async with httpx.AsyncClient(timeout=45, verify=_verify()) as client:
        return await client.request(method, url, **kwargs)


def _refusal(resp: httpx.Response) -> str:
    try:
        error = (resp.json().get("errors") or [{}])[0]
    except (ValueError, AttributeError, IndexError):
        return f"U.S. Bank refused the request ({resp.status_code})."
    reasons = "; ".join(
        f"{d.get('AttributeName') or d.get('attributeName')}: {d.get('reason')}"
        for d in error.get("details") or []
        if isinstance(d, dict)
    )
    return f"U.S. Bank refused the request ({resp.status_code}): {error.get('message') or 'no reason given'}" + (
        f" [{reasons}]" if reasons else ""
    )


async def _token(force: bool = False) -> str:
    env = environment()
    cached = _tokens.get(env)
    if cached and not force and cached[1] > time.monotonic():
        return cached[0]
    creds = credentials()
    if creds is None:
        raise BankUnavailable("The U.S. Bank API key and secret are not set on this server.")
    if env != "sandbox" and certificate() is None:
        raise BankUnavailable(
            f"U.S. Bank's {env} environment needs the company's certificate and private key. "
            "Neither file is set on this server."
        )
    try:
        resp = await _send("POST", token_url(), auth=creds, data={"grant_type": "client_credentials"})
    except httpx.HTTPError as exc:
        raise BankUnavailable(f"Could not reach U.S. Bank: {exc}") from exc
    if resp.status_code == 403 and env != "sandbox":
        # What the bank's testing guide says a 403 here nearly always is.
        raise BankError(
            "U.S. Bank refused the connection (403). That is usually the certificate: the file must hold the "
            "full chain (the company's certificate, the intermediate, then the root), and be the one the bank installed."
        )
    if resp.status_code in (401, 403):
        raise BankError("U.S. Bank did not accept the API key and secret.")
    if resp.status_code != 200:
        raise BankError(_refusal(resp))
    body = resp.json()
    # Renew a minute early so a token never expires mid-request.
    _tokens[env] = (body["accessToken"], time.monotonic() + max(60, int(body.get("expiresIn") or 899) - 60))
    return body["accessToken"]


async def _call(method: str, path: str, *, params: dict | None = None, body: dict | None = None) -> dict[str, Any]:
    for attempt in (1, 2):
        headers = {
            "Authorization": f"Bearer {await _token(force=attempt == 2)}",
            "Accept": "application/json",
            "Correlation-ID": str(uuid.uuid4()),
        }
        try:
            resp = await _send(method, _HOSTS[environment()] + _API + path, headers=headers, params=params, json=body)
        except httpx.HTTPError as exc:
            raise BankUnavailable(f"Could not reach U.S. Bank: {exc}") from exc
        if resp.status_code == 401 and attempt == 1:
            continue  # the token was withdrawn early; sign in again once
        if resp.status_code >= 500:
            raise BankUnavailable(f"U.S. Bank is not answering ({resp.status_code}).")
        if resp.status_code != 200:
            raise BankError(_refusal(resp))
        return resp.json()
    raise BankError("U.S. Bank kept refusing the sign-in.")


async def _pages(method: str, path: str, key: str, *, params: dict | None = None, body: dict | None = None) -> list[dict]:
    rows: list[dict] = []
    for page in range(1, 201):
        data = await _call(
            method, path, params={**(params or {}), "pageNumber": str(page), "pageSize": str(_PAGE)}, body=body
        )
        rows += data.get(key) or []
        meta = data.get("pageMeta") or {}
        if page >= int(meta.get("pageCount") or 1):
            break
    return rows


async def accounts() -> list[dict]:
    """The company's deposit accounts."""
    return await _pages("GET", "/accounts", "accounts")


async def balances(account_ids: list[str]) -> list[dict]:
    """Previous-day balances, as of the bank's last close, for up to fifty accounts a call."""
    rows: list[dict] = []
    for i in range(0, len(account_ids), 50):
        rows += await _pages(
            "POST", "/accounts/previous-day", "accountsSummaryPreviousDay",
            body={"accountsInquiry": {"accountID": account_ids[i:i + 50]}},
        )
    return rows


async def transactions(account_id: str, start: date, end: date) -> list[dict]:
    """Posted transactions for one account between two dates, inclusive."""
    return await _pages(
        "GET", f"/accounts/{account_id}/transactions/previous-day", "transactions",
        params={"startDate": start.isoformat(), "endDate": end.isoformat()},
    )
