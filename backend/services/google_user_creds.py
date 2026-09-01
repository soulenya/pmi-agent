"""Per-user Google credentials, for the shared hub.

On a desktop install one person owns the machine, so a single token file is the
whole story. On the hub every signed-in user holds their own grant and nothing
may ever fall back to somebody else's — one shared identity would make one
person's mailbox readable by everyone.

The `google_credentials` row is the durable record. A process-level cache holds
the live access token so that a token refresh is not needed on every request.
The user is carried in a ContextVar set by `get_current_user`, which means
background work — where there is no request and therefore no user — resolves to
None and Google access fails closed.
"""

from __future__ import annotations

import logging
import threading
import uuid
from contextvars import ContextVar
from datetime import timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.google import GoogleCredential

logger = logging.getLogger(__name__)

_TOKEN_URI = "https://oauth2.googleapis.com/token"

# None outside a request. That is deliberate: it is what stops background jobs
# from silently borrowing whichever identity happens to be cached.
_current_user_id: ContextVar[uuid.UUID | None] = ContextVar(
    "google_current_user_id", default=None
)

_cache: dict[uuid.UUID, Any] = {}
_emails: dict[uuid.UUID, str] = {}
_cache_lock = threading.Lock()


# ── request binding ──────────────────────────────────────────────────────────

def bind_user(user_id: uuid.UUID | None):
    """Attach *user_id* to this context. Returns the ContextVar token."""
    return _current_user_id.set(user_id)


def current_user_id() -> uuid.UUID | None:
    return _current_user_id.get()


def reset_user(token) -> None:
    _current_user_id.reset(token)


async def users_with_credentials(db: AsyncSession) -> list[uuid.UUID]:
    """Everyone who has connected Google. Background jobs iterate this so each
    person's work runs under their own grant rather than a shared one."""
    rows = await db.execute(select(GoogleCredential.user_id))
    return list(rows.scalars())


# ── encryption ───────────────────────────────────────────────────────────────

def _fernet() -> Fernet:
    return Fernet(settings.fernet_key)


def _encrypt(raw: str) -> str:
    return _fernet().encrypt(raw.encode()).decode()


def _decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        # A row encrypted under a different key — a restored backup, usually.
        return None


# ── web OAuth client ─────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def web_client_config() -> dict[str, Any]:
    """The 'web' half of the downloaded OAuth client JSON, or {} if absent."""
    import json

    raw = settings.google_web_client_json.strip()
    if not raw:
        path = Path(settings.google_web_client_file or "")
        if not path.is_file():
            return {}
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            logger.error("Google web client file is unreadable: %s", path)
            return {}
    try:
        data = json.loads(raw)
    except ValueError:
        logger.error("Google web client config is not valid JSON")
        return {}
    return data.get("web") or {}


def redirect_uri() -> str:
    uris = web_client_config().get("redirect_uris") or []
    return uris[0] if uris else ""


def is_configured() -> bool:
    cfg = web_client_config()
    return bool(cfg.get("client_id") and cfg.get("client_secret") and redirect_uri())


# ── cache ────────────────────────────────────────────────────────────────────

def _cache_put(user_id: uuid.UUID, creds: Any) -> None:
    with _cache_lock:
        _cache[user_id] = creds


def _cache_get(user_id: uuid.UUID) -> Any | None:
    with _cache_lock:
        return _cache.get(user_id)


def cache_drop(user_id: uuid.UUID) -> None:
    with _cache_lock:
        _cache.pop(user_id, None)
        _emails.pop(user_id, None)


def cached_email(user_id: uuid.UUID | None = None) -> str:
    """The connected account for *user_id*, defaulting to this request's user."""
    if user_id is None:
        user_id = _current_user_id.get()
    if user_id is None:
        return ""
    with _cache_lock:
        return _emails.get(user_id, "")


def _credentials_from_row(row: GoogleCredential) -> Any | None:
    from google.oauth2.credentials import Credentials

    refresh = _decrypt(row.refresh_token_encrypted)
    if not refresh:
        return None
    cfg = web_client_config()
    expiry = row.token_expiry
    if expiry is not None and expiry.tzinfo is not None:
        # google-auth compares against naive UTC.
        expiry = expiry.astimezone(timezone.utc).replace(tzinfo=None)
    return Credentials(
        token=_decrypt(row.access_token_encrypted or "") or None,
        refresh_token=refresh,
        token_uri=_TOKEN_URI,
        client_id=cfg.get("client_id"),
        client_secret=cfg.get("client_secret"),
        scopes=list(row.scopes or []),
        expiry=expiry,
    )


# ── database ─────────────────────────────────────────────────────────────────

async def _row_for(db: AsyncSession, user_id: uuid.UUID) -> GoogleCredential | None:
    result = await db.execute(
        select(GoogleCredential).where(GoogleCredential.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def load_into_cache(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Populate the process cache for *user_id* if it isn't already there."""
    if _cache_get(user_id) is not None:
        return
    row = await _row_for(db, user_id)
    if row is None:
        return
    creds = _credentials_from_row(row)
    if creds is not None:
        _cache_put(user_id, creds)
        with _cache_lock:
            _emails[user_id] = row.email


async def store(
    db: AsyncSession, user_id: uuid.UUID, email: str, creds: Any
) -> None:
    """Upsert this user's grant. Caller commits."""
    expiry = creds.expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    row = await _row_for(db, user_id)
    if row is None:
        row = GoogleCredential(user_id=user_id, email=email)
        db.add(row)

    row.email = email
    row.access_token_encrypted = _encrypt(creds.token or "")
    row.refresh_token_encrypted = _encrypt(creds.refresh_token or "")
    row.token_expiry = expiry
    row.scopes = list(creds.scopes or [])
    await db.flush()
    _cache_put(user_id, creds)
    with _cache_lock:
        _emails[user_id] = email


async def clear(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Forget this user's grant. Caller commits."""
    await db.execute(delete(GoogleCredential).where(GoogleCredential.user_id == user_id))
    cache_drop(user_id)


async def connected_email(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    row = await _row_for(db, user_id)
    return row.email if row else None


# ── the sync accessor the rest of the app uses ───────────────────────────────

def credentials_for_current_user() -> Any | None:
    """Valid Credentials for the user this request belongs to, or None."""
    user_id = _current_user_id.get()
    if user_id is None:
        return None
    creds = _cache_get(user_id)
    if creds is None:
        return None

    if creds.expired and creds.refresh_token:
        from google.auth.transport.requests import Request

        try:
            creds.refresh(Request())
        except Exception as exc:  # noqa: BLE001 — a dead grant is a disconnect
            logger.warning("Google token refresh failed for %s: %s", user_id, exc)
            cache_drop(user_id)
            return None
        _cache_put(user_id, creds)

    return creds if creds.valid else None


def granted_scopes_for_current_user() -> set[str]:
    creds = credentials_for_current_user()
    return set(creds.scopes or []) if creds else set()
