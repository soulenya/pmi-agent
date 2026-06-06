"""Health-check router — GET /health"""

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


async def _get_setting_value(db: AsyncSession, key: str, default: str = "") -> str:
    """Read a setting from DB, falling back to default."""
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()
    return str(row.value) if row and row.value else default


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

    # ── Active LLM provider ───────────────────────────────────────────────────
    provider = await _get_setting_value(db, "llm.provider", "ollama")
    try:
        if provider == "ollama":
            ollama_url = await _get_setting_value(
                db, "llm.ollama_url", settings.ollama_base_url
            )
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{ollama_url}/api/tags")
                resp.raise_for_status()
            status_info["checks"]["llm"] = {"status": "ok", "provider": "ollama"}
        elif provider == "openai":
            api_key = settings.get_api_key("openai")
            if api_key:
                status_info["checks"]["llm"] = {"status": "ok", "provider": "openai"}
            else:
                status_info["checks"]["llm"] = {
                    "status": "error",
                    "provider": "openai",
                    "detail": "No API key configured — add it in Settings › AI Configuration",
                }
                overall_ok = False
        elif provider == "anthropic":
            api_key = settings.get_api_key("anthropic")
            if api_key:
                status_info["checks"]["llm"] = {"status": "ok", "provider": "anthropic"}
            else:
                status_info["checks"]["llm"] = {
                    "status": "error",
                    "provider": "anthropic",
                    "detail": "No API key configured — add it in Settings › AI Configuration",
                }
                overall_ok = False
        else:
            status_info["checks"]["llm"] = {
                "status": "error",
                "provider": provider,
                "detail": f"Unknown provider: {provider}",
            }
            overall_ok = False
    except Exception as exc:
        status_info["checks"]["llm"] = {
            "status": "error",
            "provider": provider,
            "detail": str(exc),
        }
        overall_ok = False

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
