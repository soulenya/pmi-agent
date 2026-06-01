"""
Embeddings service — wraps the Ollama /api/embeddings endpoint.
Model: nomic-embed-text (768 dimensions).
"""

from __future__ import annotations

import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "nomic-embed-text"
EMBEDDING_DIM = 768


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


# ── FastAPI dependency ────────────────────────────────────────────────────────

def get_embedding_service() -> EmbeddingService:
    return EmbeddingService()
