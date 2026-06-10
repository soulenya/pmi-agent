"""
LLM Model Catalog — discovers available models from each provider whose API
key is configured, and caches the result in system_settings (JSONB).

Rules:
  * A provider's models are only discovered/listed when an active API key is
    present (Ollama: when the local server is reachable). No key → no models.
  * The catalog is refreshed automatically when older than CATALOG_MAX_AGE_DAYS
    (checked daily by a background loop) and can be refreshed on demand.
  * Newly discovered models keep a `first_seen` timestamp so the UI can badge
    recent additions. Models no longer returned by a provider are dropped.

Stored shape (system_settings key 'llm.model_catalog'):
  {
    "updated_at": "<iso>",
    "llm":       {"anthropic": [{"id": ..., "first_seen": ...}], "openai": [...], "ollama": [...]},
    "embedding": {"voyage": [...], "openai": [...], "ollama": [...]}
  }
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings as app_settings
from models.db.settings import SystemSetting

logger = logging.getLogger(__name__)

CATALOG_KEY = "llm.model_catalog"
CATALOG_MAX_AGE_DAYS = 7
NEW_MODEL_BADGE_DAYS = 14

# Voyage has no public list-models endpoint — static list, shown only when a key is set.
_VOYAGE_EMBEDDING_MODELS = ["voyage-3", "voyage-3-lite", "voyage-3-large"]

_OPENAI_CHAT_EXCLUDE = (
    "embedding", "audio", "tts", "whisper", "dall-e", "realtime",
    "moderation", "transcribe", "image", "-instruct", "babbage", "davinci",
)


# ── Per-provider discovery ────────────────────────────────────────────────────

async def _discover_anthropic(api_key: str) -> list[str]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.anthropic.com/v1/models",
            params={"limit": 100},
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )
        resp.raise_for_status()
        data = resp.json()
    return [m["id"] for m in data.get("data", []) if str(m.get("id", "")).startswith("claude-")]


async def _discover_openai(api_key: str) -> tuple[list[str], list[str]]:
    """Return (chat_models, embedding_models)."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        resp.raise_for_status()
        data = resp.json()
    ids = [str(m.get("id", "")) for m in data.get("data", [])]
    chat = [
        i for i in ids
        if (i.startswith("gpt-") or re.match(r"^o\d", i))
        and not any(x in i for x in _OPENAI_CHAT_EXCLUDE)
    ]
    embedding = [i for i in ids if i.startswith("text-embedding")]
    return sorted(chat), sorted(embedding)


async def _discover_ollama(base_url: str) -> tuple[list[str], list[str]]:
    """Return (chat_models, embedding_models) from the local Ollama server."""
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{base_url}/api/tags")
        resp.raise_for_status()
        data = resp.json()
    names = [str(m.get("name", "")) for m in data.get("models", [])]
    chat = [n for n in names if n and "embed" not in n.lower()]
    embedding = [n for n in names if n and "embed" in n.lower()]
    return chat, embedding


# ── Catalog persistence ───────────────────────────────────────────────────────

async def _read_catalog_row(db: AsyncSession) -> SystemSetting | None:
    return (
        await db.execute(select(SystemSetting).where(SystemSetting.key == CATALOG_KEY))
    ).scalar_one_or_none()


def _merge_first_seen(
    discovered: list[str],
    previous: list[dict],
    now_iso: str,
    is_first_scan: bool,
) -> list[dict]:
    """Keep first_seen timestamps for known models; stamp new ones with now.

    On the very first scan there is no baseline, so nothing is marked new —
    every model gets first_seen = epoch-like sentinel (its own now, but the
    caller treats a first scan as 'no new models')."""
    prev_map = {m["id"]: m.get("first_seen") for m in previous}
    out: list[dict] = []
    for model_id in discovered:
        first_seen = prev_map.get(model_id)
        if first_seen is None:
            first_seen = "" if is_first_scan else now_iso
        out.append({"id": model_id, "first_seen": first_seen})
    return out


async def refresh_model_catalog(db: AsyncSession) -> dict:
    """
    Re-discover models from every provider with an active key (plus Ollama if
    reachable), merge with the stored catalog, persist, and return it.
    Providers that error keep their previous entries (no silent wipe-outs).
    """
    row = await _read_catalog_row(db)
    previous: dict = dict(row.value) if row and isinstance(row.value, dict) else {}
    prev_llm: dict = previous.get("llm", {})
    prev_emb: dict = previous.get("embedding", {})
    is_first_scan = not previous

    now_iso = datetime.now(timezone.utc).isoformat()
    llm: dict[str, list[dict]] = {}
    embedding: dict[str, list[dict]] = {}

    # Anthropic — chat only
    anthropic_key = app_settings.get_api_key("anthropic")
    if anthropic_key:
        try:
            models = await _discover_anthropic(anthropic_key)
            llm["anthropic"] = _merge_first_seen(models, prev_llm.get("anthropic", []), now_iso, is_first_scan)
        except Exception as exc:
            logger.warning("Model discovery (anthropic) failed: %s", exc)
            llm["anthropic"] = prev_llm.get("anthropic", [])

    # OpenAI — chat + embeddings
    openai_key = app_settings.get_api_key("openai")
    if openai_key:
        try:
            chat, emb = await _discover_openai(openai_key)
            llm["openai"] = _merge_first_seen(chat, prev_llm.get("openai", []), now_iso, is_first_scan)
            embedding["openai"] = _merge_first_seen(emb, prev_emb.get("openai", []), now_iso, is_first_scan)
        except Exception as exc:
            logger.warning("Model discovery (openai) failed: %s", exc)
            llm["openai"] = prev_llm.get("openai", [])
            embedding["openai"] = prev_emb.get("openai", [])

    # Voyage — embeddings only, static list gated on key presence
    if app_settings.get_api_key("voyage"):
        embedding["voyage"] = _merge_first_seen(
            _VOYAGE_EMBEDDING_MODELS, prev_emb.get("voyage", []), now_iso, is_first_scan
        )

    # Ollama — local, no key; include only when reachable
    try:
        ollama_row = (
            await db.execute(select(SystemSetting).where(SystemSetting.key == "llm.ollama_url"))
        ).scalar_one_or_none()
        ollama_url = str(ollama_row.value) if ollama_row and ollama_row.value else app_settings.ollama_base_url
        chat, emb = await _discover_ollama(ollama_url)
        if chat:
            llm["ollama"] = _merge_first_seen(chat, prev_llm.get("ollama", []), now_iso, is_first_scan)
        if emb:
            embedding["ollama"] = _merge_first_seen(emb, prev_emb.get("ollama", []), now_iso, is_first_scan)
    except Exception:
        pass  # Ollama not running — omit

    catalog = {"updated_at": now_iso, "llm": llm, "embedding": embedding}

    if row is None:
        db.add(SystemSetting(key=CATALOG_KEY, value=catalog))
    else:
        row.value = catalog
    await db.commit()
    logger.info(
        "Model catalog refreshed: %s LLM provider(s), %s embedding provider(s)",
        len(llm), len(embedding),
    )
    return catalog


async def get_model_catalog(db: AsyncSession, refresh_if_stale: bool = True) -> dict:
    """Return the stored catalog, refreshing first if missing or stale."""
    row = await _read_catalog_row(db)
    catalog = dict(row.value) if row and isinstance(row.value, dict) else None
    if catalog and refresh_if_stale:
        try:
            updated = datetime.fromisoformat(catalog.get("updated_at", ""))
            if datetime.now(timezone.utc) - updated <= timedelta(days=CATALOG_MAX_AGE_DAYS):
                return catalog
        except ValueError:
            pass
    elif catalog:
        return catalog
    return await refresh_model_catalog(db)


def is_new_model(entry: dict) -> bool:
    """True if a catalog entry was first seen within the badge window."""
    first_seen = entry.get("first_seen") or ""
    if not first_seen:
        return False
    try:
        seen = datetime.fromisoformat(first_seen)
    except ValueError:
        return False
    return datetime.now(timezone.utc) - seen <= timedelta(days=NEW_MODEL_BADGE_DAYS)
