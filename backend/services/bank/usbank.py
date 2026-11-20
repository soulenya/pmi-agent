"""U.S. Bank, Corporate Account Information API v2: accounts, balances, transactions.

Read-only. The API key and secret are exchanged for a token that lasts about
fifteen minutes; every data call carries it. Which environment is used is
``settings.usbank_environment``:

- ``sandbox``: simulated data, sign-in with the key and secret alone.
- ``certification`` / ``production``: the bank also requires a client
  certificate (mutual TLS) and issues the sign-in address during onboarding.
  That is not built yet, and this module says so rather than guessing.

What the sandbox taught that the specification does not say: dates are
``YYYY-MM-DD`` only; ``pageSize`` is refused without ``pageNumber``; amounts
and balances arrive as strings.
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import date
from typing import Any

import httpx

from config import _keyring_get, settings

_API = "/commercial-banking/account-management/v2"
_HOSTS = {
    "sandbox": "https://sandbox.usbank.com",
    "certification": "https://cert-api2.usbank.com",
    "production": "https://api2.usbank.com",
}
_SANDBOX_TOKEN = "/oauth2/client-credentials/v2/token"
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
    """(API key, secret) from the environment or the OS keyring; None when either is missing."""
    key = (settings.get_api_key("usbank") or "").strip()
    secret = (os.environ.get("USBANK_API_SECRET") or _keyring_get("usbank_api_secret") or "").strip()
    return (key, secret) if key and secret else None


def configured() -> bool:
    return credentials() is not None


async def _send(method: str, url: str, **kwargs: Any) -> httpx.Response:
    """The one place a request leaves; tests replace it."""
    async with httpx.AsyncClient(timeout=45) as client:
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
    if env != "sandbox":
        raise BankUnavailable(
            f"U.S. Bank's {env} environment needs the bank's client certificate and the sign-in "
            "address it issues during onboarding. Neither is set up yet."
        )
    try:
        resp = await _send(
            "POST", _HOSTS[env] + _SANDBOX_TOKEN, auth=creds, data={"grant_type": "client_credentials"}
        )
    except httpx.HTTPError as exc:
        raise BankUnavailable(f"Could not reach U.S. Bank: {exc}") from exc
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
