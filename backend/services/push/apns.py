"""Apple Push Notification service (APNs) sender.

Token-based (.p8) auth over HTTP/2. This module is intentionally self-contained
and *guarded*: if APNs settings are not configured it becomes a no-op, so the
rest of the app runs unchanged on machines without push credentials.

Configuration (see config.Settings):
  apns_key_id       — the 10-char Key ID of the APNs Auth Key (.p8)
  apns_team_id      — your 10-char Apple Developer Team ID
  apns_bundle_id    — the app bundle id, used as the APNs `apns-topic`
  apns_key_path     — filesystem path to the AuthKey_XXXXXXXXXX.p8 file
  apns_use_sandbox  — True to target api.sandbox.push.apple.com (dev builds)

NOTE: TestFlight builds use the PRODUCTION APNs host (apns_use_sandbox=False),
even though they are "test" builds. Only local Xcode debug builds use sandbox.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from config import settings

logger = logging.getLogger(__name__)

_PROD_HOST = "https://api.push.apple.com"
_SANDBOX_HOST = "https://api.sandbox.push.apple.com"

# Cached signing token — APNs JWTs are valid up to 60 min; refresh well inside that.
_jwt_cache: dict[str, Any] = {"token": None, "issued_at": 0.0}
_JWT_TTL_SECONDS = 50 * 60


def is_configured() -> bool:
    """True only when every APNs setting needed to send is present."""
    return bool(
        getattr(settings, "apns_key_id", None)
        and getattr(settings, "apns_team_id", None)
        and getattr(settings, "apns_bundle_id", None)
        and getattr(settings, "apns_key_path", None)
        and Path(str(getattr(settings, "apns_key_path", ""))).expanduser().is_file()
    )


def _host() -> str:
    return _SANDBOX_HOST if getattr(settings, "apns_use_sandbox", False) else _PROD_HOST


def _signing_token() -> str:
    """Return a cached (or freshly minted) ES256 JWT for APNs auth."""
    now = time.time()
    if _jwt_cache["token"] and (now - _jwt_cache["issued_at"]) < _JWT_TTL_SECONDS:
        return _jwt_cache["token"]

    from jose import jwt  # python-jose — same lib the auth service uses

    key = Path(str(settings.apns_key_path)).expanduser().read_text()
    token = jwt.encode(
        {"iss": settings.apns_team_id, "iat": int(now)},
        key,
        algorithm="ES256",
        headers={"kid": settings.apns_key_id},
    )
    _jwt_cache["token"] = token
    _jwt_cache["issued_at"] = now
    return token


async def send_push(
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> list[str]:
    """Send an alert push to each device token.

    Returns the list of tokens APNs reported as permanently invalid (HTTP 410 or
    BadDeviceToken) so the caller can prune them from the database. No-ops and
    returns ``[]`` when APNs is not configured.
    """
    if not tokens or not is_configured():
        return []

    import httpx  # lazy import; httpx ships with the backend already

    payload = {
        "aps": {"alert": {"title": title, "body": body}, "sound": "default"},
    }
    if data:
        payload.update(data)

    headers = {
        "authorization": f"bearer {_signing_token()}",
        "apns-topic": str(settings.apns_bundle_id),
        "apns-push-type": "alert",
    }

    invalid: list[str] = []
    # HTTP/2 multiplexes all device sends over one connection.
    async with httpx.AsyncClient(http2=True, base_url=_host(), timeout=10.0) as client:
        for token in tokens:
            try:
                resp = await client.post(
                    f"/3/device/{token}", json=payload, headers=headers
                )
            except Exception as exc:  # noqa: BLE001 — never let push break a request
                logger.warning("APNs send failed for token: %s", exc)
                continue
            if resp.status_code == 410:
                invalid.append(token)
            elif resp.status_code >= 400:
                reason = ""
                try:
                    reason = resp.json().get("reason", "")
                except Exception:  # noqa: BLE001
                    reason = resp.text
                if reason in {"BadDeviceToken", "Unregistered"}:
                    invalid.append(token)
                logger.warning("APNs %s for token: %s", resp.status_code, reason)
    return invalid
