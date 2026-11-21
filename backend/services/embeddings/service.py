"""
Embeddings service — supports Ollama (local), OpenAI, Voyage AI, and any
OpenAI-compatible service that has an embedding model (Gemini, Mistral).

Provider is determined by the 'llm.embedding_provider' DB setting:
  - "ollama"  → nomic-embed-text via Ollama HTTP API (768 dims native)
  - "openai"  → text-embedding-3-small or text-embedding-3-large (native dims)
  - "voyage"  → voyage-3 or voyage-3-lite via Voyage AI API (native dims)
                Voyage AI is Anthropic's recommended embedding partner.
  - others    → CompatibleEmbeddingService; the models and their sizes are
                listed in services/llm/providers.py.

If you switch providers, run POST /documents/reindex to re-embed all
documents at the new dimension.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

import httpx
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from services.llm import providers as llm_providers

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "nomic-embed-text"
EMBEDDING_DIM = 768  # Ollama default; retained for backward compatibility

# Stored vector size per provider and model, from the provider registry.
# Used to detect mismatches when the user switches providers.
PROVIDER_DIMENSIONS: dict[str, dict[str, int]] = {
    p.key: {name: spec.dimension for name, spec in p.embeddings.items()}
    for p in llm_providers.PROVIDERS.values()
    if p.embeddings
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


class CompatibleEmbeddingService:
    """Embeddings from a service that speaks OpenAI's API at its own address
    (Gemini, Mistral: services/llm/providers.py).

    ``truncate_to`` cuts a longer vector down and re-normalises it, for models
    whose maker documents that as supported: pgvector cannot index more than
    2000 dimensions, and Gemini's models return 3072.
    """

    def __init__(self, api_key: str, model: str, base_url: str, truncate_to: int | None = None) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url
        self._truncate_to = truncate_to

    def _fit(self, vector: list[float]) -> list[float]:
        if not self._truncate_to or len(vector) <= self._truncate_to:
            return vector
        cut = vector[: self._truncate_to]
        length = sum(x * x for x in cut) ** 0.5
        return [x / length for x in cut] if length else cut

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import openai

        client = openai.AsyncOpenAI(api_key=self._api_key, base_url=self._base_url)
        out: list[list[float]] = []
        # Some services cap how many texts one request may carry.
        for i in range(0, len(texts), 64):
            resp = await client.embeddings.create(model=self._model, input=texts[i:i + 64])
            out += [self._fit(list(e.embedding)) for e in sorted(resp.data, key=lambda e: e.index)]
        return out


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def get_embedding_service() -> EmbeddingService:
    """Simple dependency — uses config URL. Use get_embedding_service_for_db for DB-aware URL."""
    return EmbeddingService()


def _resolve_model(provider: str, stored_model: str) -> str:
    """Return a valid model for the given provider.
    If the stored model belongs to a different provider's namespace, fall back
    to the provider's default (e.g. 'nomic-embed-text' when provider=voyage).
    """
    spec = llm_providers.get(provider)
    if spec is None or spec.kind == "ollama" or not spec.embeddings:
        return stored_model
    return stored_model if stored_model in spec.embeddings else spec.default_embedding


AnyEmbeddingService = (
    EmbeddingService | OpenAIEmbeddingService | VoyageEmbeddingService | CompatibleEmbeddingService
)


async def _build(db: AsyncSession) -> AnyEmbeddingService:
    """The embedding backend the settings name. Raises RuntimeError when its key is missing."""
    provider = await _read_setting(db, "llm.embedding_provider", settings.default_embedding_provider)
    stored_model = await _read_setting(db, "llm.embedding_model", settings.default_embedding_model)
    model = _resolve_model(provider, stored_model)
    spec = llm_providers.get(provider)

    if spec is not None and spec.needs_key and spec.has_embeddings:
        api_key = settings.get_api_key(provider)
        if not api_key:
            raise RuntimeError(
                f"{spec.label} is selected for embeddings but no {spec.label} API key is configured. "
                f"Go to Settings → AI Engine and enter your {spec.label} API key, then save."
                + (f" Get one at {spec.key_url}" if spec.key_url else "")
            )
        if provider == "openai":
            return OpenAIEmbeddingService(api_key=api_key, model=model)
        if provider == "voyage":
            return VoyageEmbeddingService(api_key=api_key, model=model)
        found = spec.embeddings.get(model)
        return CompatibleEmbeddingService(
            api_key=api_key, model=model, base_url=spec.base_url,
            truncate_to=found.dimension if found and found.truncate else None,
        )

    # Ollama, and anything unrecognised.
    return EmbeddingService(base_url=await _read_ollama_url(db))


async def get_embedding_service_for_db(db: AsyncSession) -> AnyEmbeddingService:
    """
    Awaitable (non-generator) version of get_embedding_service_db.
    Use this from code that cannot use FastAPI dependency injection (e.g., the agent executor).
    """
    return await _build(db)


async def get_embedding_service_db(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[AnyEmbeddingService, None]:
    """
    DB-aware dependency: the embedding backend named by ``llm.embedding_provider``
    and ``llm.embedding_model``. When no provider is persisted it falls back to the
    configured default (settings.default_embedding_provider) rather than Ollama,
    so a fresh install with a cloud key doesn't silently try a local server.
    """
    yield await _build(db)
