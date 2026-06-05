"""Health-check router — GET /health"""

from __future__ import annotations

import shutil
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models.db.settings import SystemSetting
from sqlalchemy import select

router = APIRouter(prefix="/health", tags=["health"])


async def _get_ollama_url(db: AsyncSession) -> str:
    """Read ollama URL from DB, falling back to env-var default."""
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == "llm.ollama_url"))).scalar_one_or_none()
    return str(row.value) if row and row.value else settings.ollama_base_url


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

    # ── Ollama ────────────────────────────────────────────────────────────────
    try:
        ollama_url = await _get_ollama_url(db)
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{ollama_url}/api/tags")
            resp.raise_for_status()
        status_info["checks"]["ollama"] = {"status": "ok"}
    except Exception as exc:
        status_info["checks"]["ollama"] = {"status": "error", "detail": str(exc)}
        overall_ok = False

    # ── Disk space (warn if < 1 GB free) ─────────────────────────────────────
    usage = shutil.disk_usage("/")
    free_gb = usage.free / (1024**3)
    status_info["checks"]["disk"] = {
        "status": "ok" if free_gb >= 1.0 else "warn",
        "free_gb": round(free_gb, 2),
    }

    if not overall_ok:
        status_info["status"] = "degraded"

    return status_info
