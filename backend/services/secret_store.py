"""Keys entered in the app on a host that has no OS keyring (the hub).

``config.Settings.get_api_key`` is synchronous and called from everywhere, so
the decrypted values are held in memory: loaded once at startup and updated
whenever one is saved. The hub runs a single API process, so that copy is the
only one.

Order of precedence for a provider key stays: environment, then the OS
keyring, then this store. A hub whose operator supplies a key through Secret
Manager is therefore unaffected by anything saved here.
"""

from __future__ import annotations

import base64
import logging
import os
import uuid

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.app_secret import AppSecret
from models.db.user import User

logger = logging.getLogger(__name__)

PROVIDERS = ("anthropic", "openai", "voyage", "google")

_cache: dict[str, str] = {}


def get(name: str) -> str | None:
    """A stored secret, or None. Never touches the database."""
    return _cache.get(name) or None


async def load(db: AsyncSession) -> None:
    """Read every stored secret into memory. One that no longer decrypts is skipped."""
    fernet = Fernet(settings.fernet_key)
    found: dict[str, str] = {}
    for row in (await db.execute(select(AppSecret))).scalars():
        try:
            found[row.name] = fernet.decrypt(row.value_encrypted.encode()).decode()
        except InvalidToken:
            logger.warning("Stored secret %s cannot be decrypted with this install's key; ignored", row.name)
    _cache.clear()
    _cache.update(found)


async def put(db: AsyncSession, name: str, value: str, user_id: uuid.UUID | None = None) -> None:
    """Store one secret, encrypted. Caller commits."""
    encrypted = Fernet(settings.fernet_key).encrypt(value.encode()).decode()
    row = await db.get(AppSecret, name)
    if row is None:
        db.add(AppSecret(name=name, value_encrypted=encrypted, updated_by=user_id))
    else:
        row.value_encrypted = encrypted
        row.updated_by = user_id
    await db.flush()
    _cache[name] = value


def key_source(provider: str) -> str | None:
    """Where this provider's key comes from: 'server', 'keyring', 'app', or None."""
    if os.environ.get(f"{provider.upper()}_API_KEY"):
        return "server"
    from config import _keyring_get

    if _keyring_get(f"{provider}_api_key"):
        return "keyring"
    if get(f"{provider}_api_key"):
        return "app"
    return None


async def save_api_key(db: AsyncSession, user: User, provider: str, key: str) -> None:
    """Keep a provider API key where this kind of install keeps them.

    A desktop is one person's computer: the key goes into their keyring, as
    before. The hub is shared, so only an administrator may set a key there,
    and it goes into this store. Caller commits.
    """
    key = key.strip()
    if not settings.hub_mode:
        settings.set_api_key(provider, key)
        return
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can set the company's API keys.",
        )
    await put(db, f"{provider}_api_key", key, user.id)


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


async def ensure_push_keys(db: AsyncSession) -> bool:
    """Give a hub its Web Push key pair when the environment supplies none.

    Returns True when ``settings`` now holds a pair. The pair is made once and
    kept: replacing it would silently cancel every device's subscription.
    """
    if settings.vapid_public_key and settings.vapid_private_key:
        return True
    public, private = get("vapid_public_key"), get("vapid_private_key")
    if not (public and private):
        key = ec.generate_private_key(ec.SECP256R1())
        # The two forms py_vapid writes and pywebpush reads: the raw 32-byte
        # private value and the uncompressed public point, base64url, unpadded.
        private = _b64url(key.private_numbers().private_value.to_bytes(32, "big"))
        public = _b64url(
            key.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
        )
        await put(db, "vapid_public_key", public)
        await put(db, "vapid_private_key", private)
        await db.commit()
        logger.info("Web Push: made this hub's key pair")
    settings.vapid_public_key, settings.vapid_private_key = public, private
    return True
