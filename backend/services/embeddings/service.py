"""
Embeddings service — wraps the Ollama /api/embeddings endpoint.
Model: nomic-embed-text (768 dimensions).

The Ollama base URL is read from the DB settings table (llm.ollama_url) at
request time so changes made in Settings take effect immediately without a
server restart. Falls back to the env-var default if no DB row exists.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

import httpx
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "nomic-embed-text"
EMBEDDING_DIM = 768


async def _read_ollama_url(db: AsyncSession) -> str:
    """Read llm.ollama_url from the DB, falling back to env-var config."""
    try:
        from sqlalchemy import select
        from models.db.settings import SystemSetting
        row = (
            await db.execute(
                select(SystemSetting).where(SystemSetting.key == "llm.ollama_url")
            )
        ).scalar_one_or_none()
        if row and row.value:
            return str(row.value).rstrip("/")
    except Exception:
        pass
    return settings.ollama_base_url.rstrip("/")


class EmbeddingService:
    """Thin async wrapper around Ollama's embeddings API."""

    def __init__(self, base_url: str | None = None) -> None:
        self._base_url = (base_url or settings.ollama_base_url).rstrip("/")

    async def embed(self, text: str) -> list[float]:
        """Return a 768-dimensional embedding for *text*."""
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self._base_url}/api/embeddings",
                json={"model": EMBEDDING_MODEL, "prompt": text},
            )
            response.raise_for_status()
        data = response.json()
        embedding: list[float] = data["embedding"]
        if len(embedding) != EMBEDDING_DIM:
            raise ValueError(
                f"Expected {EMBEDDING_DIM}-dim embedding, got {len(embedding)}"
            )
        return embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts sequentially (Ollama has no batch endpoint)."""
        return [await self.embed(t) for t in texts]


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def get_embedding_service() -> EmbeddingService:
    """Simple dependency — uses config URL. Use get_embedding_service_db for DB-aware URL."""
    return EmbeddingService()


async def get_embedding_service_db(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[EmbeddingService, None]:
    """DB-aware dependency — reads Ollama URL from settings table at request time."""
    url = await _read_ollama_url(db)
    yield EmbeddingService(base_url=url)
