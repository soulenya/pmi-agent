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

router = APIRouter(prefix="/health", tags=["health"])


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
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
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
