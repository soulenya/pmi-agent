"""
Embeddings service — supports Ollama (local), OpenAI, and Voyage AI (cloud).

Provider is determined by the 'llm.embedding_provider' DB setting:
  - "ollama"  → nomic-embed-text via Ollama HTTP API (768 dims native)
  - "openai"  → text-embedding-3-small or text-embedding-3-large (native dims)
  - "voyage"  → voyage-3 or voyage-3-lite via Voyage AI API (native dims)
                Voyage AI is Anthropic's recommended embedding partner.

Each provider returns its native dimension. If you switch providers, run
POST /documents/reindex to re-embed all documents at the new dimension.
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
EMBEDDING_DIM = 768  # Ollama default; retained for backward compatibility

# Native output dimensions per provider and model.
# Used to detect mismatches when the user switches providers.
PROVIDER_DIMENSIONS: dict[str, dict[str, int]] = {
    "voyage": {
        "voyage-3": 1024,
        "voyage-3-lite": 512,
    },
    "openai": {
        "text-embedding-3-large": 3072,
        "text-embedding-3-small": 1536,
    },
    "ollama": {
        "nomic-embed-text": 768,
    },
}


def get_provider_dimension(provider: str, model: str) -> int:
    """
    Return the native embedding dimension for a given provider + model.
    Falls back to 768 for unknown Ollama models.
    """
    dims = PROVIDER_DIMENSIONS.get(provider, {})
    return dims.get(model, 768)


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
    OpenAI text-embedding-3-small or text-embedding-3-large.
    Returns native dimensions (1536 or 3072) — no forced truncation.
    Use POST /documents/reindex if switching from a different provider.
    """

    def __init__(self, api_key: str, model: str = "text-embedding-3-small") -> None:
        self._api_key = api_key
        self._model = model

    async def embed(self, text: str) -> list[float]:
        import openai
        client = openai.AsyncOpenAI(api_key=self._api_key)
        resp = await client.embeddings.create(
            model=self._model,
            input=text,
        )
        return resp.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import openai
        client = openai.AsyncOpenAI(api_key=self._api_key)
        resp = await client.embeddings.create(
            model=self._model,
            input=texts,
        )
        # Results must be returned in order
        ordered = sorted(resp.data, key=lambda e: e.index)
        return [e.embedding for e in ordered]


class VoyageEmbeddingService:
    """
    Voyage AI embeddings — Anthropic's recommended embedding partner.
    Returns native dimensions for the chosen model:
      voyage-3      → 1024 dims
      voyage-3-lite → 512 dims
    No forced truncation. Use POST /documents/reindex when switching providers.
    """

    _MAX_RETRIES = 4
    _RETRY_BASE_WAIT = 8  # seconds — short waits so interactive ops stay within 60s timeout

    def __init__(self, api_key: str, model: str = "voyage-3") -> None:
        self._api_key = api_key
        self._model = model

    async def _embed_with_retry(self, texts: list[str]) -> list[list[float]]:
        """Call Voyage embed with automatic retry on transient errors.

        Retries rate-limit errors (with longer backoff) and transient network /
        server errors such as connection failures, timeouts, and 5xx responses
        (with short backoff) so a momentary blip doesn't fail a whole ingestion.
        """
        import asyncio
        import voyageai
        client = voyageai.AsyncClient(api_key=self._api_key)
        transient_errors = (
            voyageai.error.APIConnectionError,
            voyageai.error.ServiceUnavailableError,
            voyageai.error.ServerError,
            voyageai.error.Timeout,
            voyageai.error.TryAgain,
        )
        for attempt in range(self._MAX_RETRIES):
            try:
                result = await client.embed(texts, model=self._model)
                return result.embeddings
            except voyageai.error.RateLimitError:
                if attempt == self._MAX_RETRIES - 1:
                    raise
                wait = self._RETRY_BASE_WAIT * (attempt + 1)
                logger.warning(
                    "Voyage AI rate limit hit — waiting %ds before retry %d/%d",
                    wait, attempt + 1, self._MAX_RETRIES,
                )
                await asyncio.sleep(wait)
            except transient_errors as exc:
                if attempt == self._MAX_RETRIES - 1:
                    raise
                wait = 2 * (attempt + 1)  # short backoff: 2s, 4s, 6s
                logger.warning(
                    "Voyage AI transient error (%s) — retrying in %ds (%d/%d)",
                    type(exc).__name__, wait, attempt + 1, self._MAX_RETRIES,
                )
                await asyncio.sleep(wait)
        raise RuntimeError("Voyage AI embed failed after retries")

    async def embed(self, text: str) -> list[float]:
        results = await self._embed_with_retry([text])
        return results[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await self._embed_with_retry(texts)


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def get_embedding_service() -> EmbeddingService:
    """Simple dependency — uses config URL. Use get_embedding_service_for_db for DB-aware URL."""
    return EmbeddingService()


# Per-provider default embedding models
_PROVIDER_DEFAULT_MODEL: dict[str, str] = {
    "ollama": "nomic-embed-text",
    "openai": "text-embedding-3-small",
    "voyage": "voyage-3",
}


def _resolve_model(provider: str, stored_model: str) -> str:
    """Return a valid model for the given provider.
    If the stored model belongs to a different provider's namespace, fall back
    to the provider's default (e.g. 'nomic-embed-text' when provider=voyage).
    """
    provider_models = set(PROVIDER_DIMENSIONS.get(provider, {}).keys())
    if provider_models and stored_model not in provider_models:
        return _PROVIDER_DEFAULT_MODEL.get(provider, stored_model)
    return stored_model


async def get_embedding_service_for_db(
    db: AsyncSession,
) -> "EmbeddingService | OpenAIEmbeddingService | VoyageEmbeddingService":
    """
    Awaitable (non-generator) version of get_embedding_service_db.
    Use this from code that cannot use FastAPI dependency injection (e.g., the agent executor).
    """
    embedding_provider = await _read_setting(
        db, "llm.embedding_provider", settings.default_embedding_provider
    )
    stored_model = await _read_setting(
        db, "llm.embedding_model", settings.default_embedding_model
    )
    embedding_model = _resolve_model(embedding_provider, stored_model)

    if embedding_provider == "openai":
        api_key = settings.get_api_key("openai")
        if not api_key:
            raise RuntimeError(
                "OpenAI embedding provider selected but no API key configured."
            )
        return OpenAIEmbeddingService(api_key=api_key, model=embedding_model)

    if embedding_provider == "voyage":
        api_key = settings.get_api_key("voyage")
        if not api_key:
            raise RuntimeError(
                "Voyage AI embedding provider selected but no Voyage API key configured. "
                "Go to Settings → AI Engine and enter your Voyage API key."
            )
        return VoyageEmbeddingService(api_key=api_key, model=embedding_model)

    # Default: Ollama
    url = await _read_ollama_url(db)
    return EmbeddingService(base_url=url)


async def get_embedding_service_db(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[EmbeddingService | OpenAIEmbeddingService | VoyageEmbeddingService, None]:
    """
    DB-aware dependency — resolves the correct embedding backend from settings:
      llm.embedding_provider = "openai"  → OpenAIEmbeddingService (native dims)
      llm.embedding_provider = "voyage"  → VoyageEmbeddingService (native dims)
      llm.embedding_provider = "ollama"  → EmbeddingService (Ollama, 768 dims)
    When no provider is persisted, falls back to the configured default
    (settings.default_embedding_provider) rather than Ollama, so a fresh install
    with a cloud key configured doesn't silently try a non-running local server.
    """
    embedding_provider = await _read_setting(
        db, "llm.embedding_provider", settings.default_embedding_provider
    )
    stored_model = await _read_setting(
        db, "llm.embedding_model", settings.default_embedding_model
    )
    embedding_model = _resolve_model(embedding_provider, stored_model)

    if embedding_provider == "openai":
        api_key = settings.get_api_key("openai")
        if not api_key:
            raise RuntimeError(
                "OpenAI embedding provider is selected but no OpenAI API key is configured. "
                "Go to Settings → AI Engine and enter your OpenAI API key, then save."
            )
        yield OpenAIEmbeddingService(api_key=api_key, model=embedding_model)
        return

    if embedding_provider == "voyage":
        api_key = settings.get_api_key("voyage")
        if not api_key:
            raise RuntimeError(
                "Voyage AI embedding provider is selected but no Voyage API key is configured. "
                "Go to Settings → AI Engine and enter your Voyage API key, then save. "
                "Get a free key at https://dash.voyageai.com"
            )
        yield VoyageEmbeddingService(api_key=api_key, model=embedding_model)
        return

    # Default: Ollama
    url = await _read_ollama_url(db)
    yield EmbeddingService(base_url=url)
