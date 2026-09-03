"""Encrypted storage for images pasted onto a canvas.

They use the same Fernet key and storage root as the knowledge base, but not
the same pipeline: a picture has no text to chunk or embed, so it is stored
and served rather than ingested.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from cryptography.fernet import Fernet

from config import settings

ALLOWED_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def _root() -> Path:
    root = (Path(settings.storage_root).expanduser().resolve()) / "canvas"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _path(node_id: uuid.UUID) -> Path:
    return _root() / f"{node_id}.enc"


def store(node_id: uuid.UUID, raw: bytes) -> None:
    _path(node_id).write_bytes(Fernet(settings.fernet_key).encrypt(raw))


def read(node_id: uuid.UUID) -> bytes | None:
    path = _path(node_id)
    if not path.exists():
        return None
    return Fernet(settings.fernet_key).decrypt(path.read_bytes())


def delete(node_id: uuid.UUID) -> None:
    _path(node_id).unlink(missing_ok=True)
