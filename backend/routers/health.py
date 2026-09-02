"""
Health-check router.

GET /health        — full system check (DB, LLM live ping, embedding live ping, disk)
GET /health/live   — liveness only, for load balancer probes
"""

from __future__ import annotations

import shutil
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models.db.settings import SystemSetting

router = APIRouter(prefix="/health", tags=["health"])

_PING_TIMEOUT = 5.0  # seconds for all live API pings


async def _get_setting_value(db: AsyncSession, key: str, default: str = "") -> str:
    """Read a setting from DB, falling back to default."""
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return str(row.value) if row and row.value else default


# ── Live ping helpers ─────────────────────────────────────────────────────────

async def _ping_llm(provider: str, model: str, db: AsyncSession) -> dict:
    """
    Perform a lightweight live ping against the active LLM provider.
    Returns {"status": "ok"|"error", "provider": ..., "model": ..., "detail"?: ...}
    """
    try:
        if provider == "anthropic":
            api_key = settings.get_api_key("anthropic")
            if not api_key:
                return {"status": "error", "provider": "anthropic", "model": model,
                        "detail": "No API key — add it in Settings → AI Engine"}
            import anthropic as _anthropic
            client = _anthropic.AsyncAnthropic(api_key=api_key)
            # count_tokens is a free, non-billable API call
            await client.messages.count_tokens(
                model=model,
                messages=[{"role": "user", "content": "ping"}],
            )
            return {"status": "ok", "provider": "anthropic", "model": model}

        if provider == "openai":
            api_key = settings.get_api_key("openai")
            if not api_key:
                return {"status": "error", "provider": "openai", "model": model,
                        "detail": "No API key — add it in Settings → AI Engine"}
            import openai as _openai
            client = _openai.AsyncOpenAI(api_key=api_key)
            # models.retrieve is a free metadata call
            await client.models.retrieve(model)
            return {"status": "ok", "provider": "openai", "model": model}

        if provider == "ollama":
            ollama_url = await _get_setting_value(db, "llm.ollama_url", settings.ollama_base_url)
            async with httpx.AsyncClient(timeout=_PING_TIMEOUT) as client:
                resp = await client.get(f"{ollama_url}/api/tags")
                resp.raise_for_status()
            return {"status": "ok", "provider": "ollama", "model": model}

        return {"status": "error", "provider": provider, "model": model,
                "detail": f"Unknown provider: {provider}"}

    except Exception as exc:
        return {"status": "error", "provider": provider, "model": model, "detail": str(exc)}


async def _ping_embedding(provider: str, model: str, db: AsyncSession) -> dict:
    """
    Perform a lightweight live ping against the active embedding provider.
    Returns {"status": "ok"|"error", "provider": ..., "model": ..., "dimension"?: ..., "detail"?: ...}
    """
    from services.embeddings.service import get_provider_dimension

    try:
        if provider == "voyage":
            api_key = settings.get_api_key("voyage")
            if not api_key:
                return {"status": "error", "provider": "voyage", "model": model,
                        "detail": "No Voyage AI API key — add it in Settings → AI Engine"}
            import voyageai
            client = voyageai.AsyncClient(api_key=api_key)
            result = await client.embed(["ping"], model=model)
            dim = len(result.embeddings[0]) if result.embeddings else get_provider_dimension(provider, model)
            return {"status": "ok", "provider": "voyage", "model": model, "dimension": dim}

        if provider == "openai":
            api_key = settings.get_api_key("openai")
            if not api_key:
                return {"status": "error", "provider": "openai", "model": model,
                        "detail": "No OpenAI API key — add it in Settings → AI Engine"}
            import openai as _openai
            client = _openai.AsyncOpenAI(api_key=api_key)
            resp = await client.embeddings.create(model=model, input=["ping"])
            dim = len(resp.data[0].embedding)
            return {"status": "ok", "provider": "openai", "model": model, "dimension": dim}

        if provider == "ollama":
            ollama_url = await _get_setting_value(db, "llm.ollama_url", settings.ollama_base_url)
            async with httpx.AsyncClient(timeout=_PING_TIMEOUT) as client:
                resp = await client.post(
                    f"{ollama_url}/api/embeddings",
                    json={"model": model, "prompt": "ping"},
                )
                resp.raise_for_status()
                data = resp.json()
            dim = len(data.get("embedding", []))
            return {"status": "ok", "provider": "ollama", "model": model, "dimension": dim}

        return {"status": "error", "provider": provider, "model": model,
                "detail": f"Unknown embedding provider: {provider}"}

    except Exception as exc:
        return {"status": "error", "provider": provider, "model": model, "detail": str(exc)}

# ── Liveness ──────────────────────────────────────────────────────────────

@router.get("/live")
async def liveness() -> dict:
    """Load balancers poll this every few seconds — it must touch nothing."""
    return {"status": "ok"}

# ── Full health check ─────────────────────────────────────────────────────────

@router.get("")
async def health_check(db: AsyncSession = Depends(get_db)) -> dict:
    status_info: dict = {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": {},
    }
    overall_ok = True

    # ── Database ──────────────────────────────────────────────────────────────
    try:
        await db.execute(text("SELECT 1"))
        status_info["checks"]["database"] = {"status": "ok"}
    except Exception as exc:
        status_info["checks"]["database"] = {"status": "error", "detail": str(exc)}
        overall_ok = False

    # ── LLM provider (live ping) ──────────────────────────────────────────────
    llm_provider = await _get_setting_value(db, "llm.provider", settings.default_llm_provider)
    llm_model = await _get_setting_value(db, "llm.model", settings.default_llm_model)
    llm_result = await _ping_llm(llm_provider, llm_model, db)
    status_info["checks"]["llm"] = llm_result
    if llm_result["status"] != "ok":
        overall_ok = False

    # ── Embedding provider (live ping) ────────────────────────────────────────
    emb_provider = await _get_setting_value(db, "llm.embedding_provider", settings.default_embedding_provider)
    emb_model = await _get_setting_value(db, "llm.embedding_model", settings.default_embedding_model)
    emb_result = await _ping_embedding(emb_provider, emb_model, db)
    status_info["checks"]["embedding"] = emb_result
    if emb_result["status"] != "ok":
        overall_ok = False

    # ── Re-index flag ─────────────────────────────────────────────────────────
    reindex_raw = await _get_setting_value(db, "llm.kb_needs_reindex", "false")
    status_info["checks"]["kb_needs_reindex"] = reindex_raw.lower() == "true"

    # ── Disk space (warn if < 1 GB free) ─────────────────────────────────────
    try:
        usage = shutil.disk_usage("/")
        free_gb = usage.free / (1024**3)
        status_info["checks"]["disk"] = {
            "status": "ok" if free_gb >= 1.0 else "warn",
            "free_gb": round(free_gb, 2),
        }
    except Exception as exc:
        status_info["checks"]["disk"] = {"status": "error", "detail": str(exc)}

    if not overall_ok:
        status_info["status"] = "degraded"

    return status_info
