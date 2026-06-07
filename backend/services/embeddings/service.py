"""
Embeddings service — supports Ollama (local), OpenAI, and Voyage AI (cloud).

Provider is determined by the 'llm.embedding_provider' DB setting:
  - "ollama"  → nomic-embed-text via Ollama HTTP API (768 dims)
  - "openai"  → text-embedding-3-small via OpenAI API (truncated to 768 dims)
  - "voyage"  → voyage-3 via Voyage AI API (truncated to 768 dims)
                Voyage AI is Anthropic's recommended embedding partner.

Defaults to "ollama" for backward compatibility.
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


async def _read_setting(db: AsyncSession, key: str, default: str = "") -> str:
    """Read a single system_setting key from DB, falling back to default."""
    try:
        from sqlalchemy import select
        from models.db.settings import SystemSetting
        row = (
            await db.execute(
                select(SystemSetting).where(SystemSetting.key == key)
            )
        ).scalar_one_or_none()
        if row and row.value:
            return str(row.value).strip()
    except Exception:
        pass
    return default


async def _read_ollama_url(db: AsyncSession) -> str:
    """Read llm.ollama_url from the DB, falling back to env-var config."""
    url = await _read_setting(db, "llm.ollama_url")
    return (url or settings.ollama_base_url).rstrip("/")


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


class OpenAIEmbeddingService:
    """
    OpenAI text-embedding-3-small with dimensions=768.
    Matches the existing pgvector schema exactly without any DB migration.
    """

    _MODEL = "text-embedding-3-small"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def embed(self, text: str) -> list[float]:
        import openai
        client = openai.AsyncOpenAI(api_key=self._api_key)
        resp = await client.embeddings.create(
            model=self._MODEL,
            input=text,
            dimensions=EMBEDDING_DIM,
        )
        return resp.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import openai
        client = openai.AsyncOpenAI(api_key=self._api_key)
        resp = await client.embeddings.create(
            model=self._MODEL,
            input=texts,
            dimensions=EMBEDDING_DIM,
        )
        # Results must be returned in order
        ordered = sorted(resp.data, key=lambda e: e.index)
        return [e.embedding for e in ordered]


class VoyageEmbeddingService:
    """
    Voyage AI embeddings — Anthropic's recommended embedding partner.
    Uses voyage-3 with output_dimension=768 to match the existing pgvector schema.
    No database migration needed.
    """

    _MODEL = "voyage-3"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def embed(self, text: str) -> list[float]:
        import voyageai
        client = voyageai.AsyncClient(api_key=self._api_key)
        result = await client.embed(
            [text],
            model=self._MODEL,
            output_dimension=EMBEDDING_DIM,
        )
        return result.embeddings[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import voyageai
        client = voyageai.AsyncClient(api_key=self._api_key)
        result = await client.embed(
            texts,
            model=self._MODEL,
            output_dimension=EMBEDDING_DIM,
        )
        return result.embeddings


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def get_embedding_service() -> EmbeddingService:
    """Simple dependency — uses config URL. Use get_embedding_service_db for DB-aware URL."""
    return EmbeddingService()


async def get_embedding_service_db(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[EmbeddingService | OpenAIEmbeddingService | VoyageEmbeddingService, None]:
    """
    DB-aware dependency — resolves the correct embedding backend from settings:
      llm.embedding_provider = "openai"  → OpenAIEmbeddingService
      llm.embedding_provider = "voyage"  → VoyageEmbeddingService (Anthropic partner)
      llm.embedding_provider = "ollama"  → EmbeddingService (Ollama, default)
    """
    embedding_provider = await _read_setting(db, "llm.embedding_provider", "ollama")

    if embedding_provider == "openai":
        api_key = settings.get_api_key("openai")
        if not api_key:
            raise RuntimeError(
                "OpenAI embedding provider is selected but no OpenAI API key is configured. "
                "Go to Settings → AI Engine and enter your OpenAI API key, then save."
            )
        yield OpenAIEmbeddingService(api_key=api_key)
        return

    if embedding_provider == "voyage":
        api_key = settings.get_api_key("voyage")
        if not api_key:
            raise RuntimeError(
                "Voyage AI embedding provider is selected but no Voyage API key is configured. "
                "Go to Settings → AI Engine and enter your Voyage API key, then save. "
                "Get a free key at https://dash.voyageai.com"
            )
        yield VoyageEmbeddingService(api_key=api_key)
        return

    # Default: Ollama
    url = await _read_ollama_url(db)
    yield EmbeddingService(base_url=url)
