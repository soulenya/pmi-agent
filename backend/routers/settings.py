"""
Settings API.

Exposes:
  GET  /settings        — return current settings (LLM config, app preferences)
  PUT  /settings        — update one or more settings
  GET  /settings/me     — current user profile
  PUT  /settings/me     — update display name / password

Settings are stored in the `system_settings` table as key-value JSONB rows.
Keys are namespaced: e.g. "llm.model", "llm.ollama_url", "app.theme".
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings as app_settings
from database import get_db
from dependencies import get_current_user, require_admin
from models.db.settings import SystemSetting
from models.db.user import User
from models.schemas.auth import UserOut
from services.auth.service import hash_password, verify_password

router = APIRouter(prefix="/settings", tags=["settings"])

# ── Setting keys that are safe to expose ────────────────────────────────────

EXPOSED_KEYS = {
    "llm.provider",
    "llm.model",
    "llm.ollama_url",
    "llm.embedding_model",
    "llm.embedding_provider",
    "llm.embedding_dimension",
    "llm.kb_needs_reindex",
    "llm.use_langgraph",
    "app.theme",
    "app.timezone",
    "notifications.email_enabled",
    "voice.speak_replies",
    "voice.voice_name",
}

DEFAULTS: dict[str, object] = {
    "llm.provider": "anthropic",
    "llm.model": "claude-sonnet-4-6",
    "llm.ollama_url": "http://localhost:11434",
    "llm.embedding_provider": "voyage",
    "llm.embedding_model": "voyage-3",
    "llm.embedding_dimension": "1024",
    "llm.kb_needs_reindex": "false",
    "llm.use_langgraph": "false",
    "app.theme": "system",
    "app.timezone": "UTC",
    "notifications.email_enabled": False,
    "voice.speak_replies": False,
    "voice.voice_name": "en-US-Chirp3-HD-Kore",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_setting(db: AsyncSession, key: str) -> object:
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()
    if row is None:
        return DEFAULTS.get(key)
    return row.value


async def _set_setting(db: AsyncSession, key: str, value: object, user_id) -> None:
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()
    if row is None:
        row = SystemSetting(key=key, value=value, updated_by=user_id)
        db.add(row)
    else:
        row.value = value
        row.updated_by = user_id
    await db.flush()


# ── Schemas ───────────────────────────────────────────────────────────────────

class SettingsOut(BaseModel):
    llm_provider: str
    llm_model: str
    ollama_url: str
    embedding_model: str
    embedding_provider: str
    embedding_dimension: int
    reindex_required: bool
    theme: str
    timezone: str
    notifications_email_enabled: bool
    voice_speak_replies: bool
    voice_voice_name: str
    # API key presence (never expose actual keys)
    openai_key_set: bool
    anthropic_key_set: bool
    voyage_key_set: bool
    google_key_set: bool


class SettingsUpdate(BaseModel):
    llm_provider: str | None = Field(None, pattern="^(ollama|openai|anthropic)$")
    llm_model: str | None = Field(None, min_length=1, max_length=100)
    ollama_url: str | None = Field(None, min_length=1, max_length=255)
    embedding_model: str | None = Field(None, min_length=1, max_length=100)
    embedding_provider: str | None = Field(None, pattern="^(ollama|openai|voyage)$")
    theme: str | None = Field(None, pattern="^(light|dark|system)$")
    timezone: str | None = Field(None, max_length=64)
    notifications_email_enabled: bool | None = None
    voice_speak_replies: bool | None = None
    voice_voice_name: str | None = Field(None, min_length=1, max_length=64)
    # API keys — stored in OS keyring, never in DB
    openai_api_key: str | None = Field(None, min_length=1, max_length=500)
    anthropic_api_key: str | None = Field(None, min_length=1, max_length=500)
    voyage_api_key: str | None = Field(None, min_length=1, max_length=500)
    google_api_key: str | None = Field(None, min_length=1, max_length=500)


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=255)
    current_password: str | None = None
    new_password: str | None = Field(None, min_length=8)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=SettingsOut)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> SettingsOut:
    embedding_dim_raw = await _get_setting(db, "llm.embedding_dimension")
    try:
        embedding_dim = int(embedding_dim_raw) if embedding_dim_raw else 768
    except (TypeError, ValueError):
        embedding_dim = 768
    reindex_raw = await _get_setting(db, "llm.kb_needs_reindex")
    reindex_required = str(reindex_raw).lower() == "true" if reindex_raw else False

    return SettingsOut(
        llm_provider=str(await _get_setting(db, "llm.provider")),
        llm_model=str(await _get_setting(db, "llm.model")),
        ollama_url=str(await _get_setting(db, "llm.ollama_url")),
        embedding_model=str(await _get_setting(db, "llm.embedding_model")),
        embedding_provider=str(await _get_setting(db, "llm.embedding_provider")),
        embedding_dimension=embedding_dim,
        reindex_required=reindex_required,
        theme=str(await _get_setting(db, "app.theme")),
        timezone=str(await _get_setting(db, "app.timezone")),
        notifications_email_enabled=bool(await _get_setting(db, "notifications.email_enabled")),
        voice_speak_replies=bool(await _get_setting(db, "voice.speak_replies")),
        voice_voice_name=str(await _get_setting(db, "voice.voice_name")),
        openai_key_set=app_settings.get_api_key("openai") is not None,
        anthropic_key_set=app_settings.get_api_key("anthropic") is not None,
        voyage_key_set=app_settings.get_api_key("voyage") is not None,
        google_key_set=app_settings.get_api_key("google") is not None,
    )


@router.put("", response_model=SettingsOut)
async def update_settings(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SettingsOut:
    from services.embeddings.service import get_provider_dimension

    db_updates = {
        "llm.provider": body.llm_provider,
        "llm.model": body.llm_model,
        "llm.ollama_url": body.ollama_url,
        "llm.embedding_model": body.embedding_model,
        "llm.embedding_provider": body.embedding_provider,
        "app.theme": body.theme,
        "app.timezone": body.timezone,
        "notifications.email_enabled": body.notifications_email_enabled,
        "voice.speak_replies": body.voice_speak_replies,
        "voice.voice_name": body.voice_voice_name,
    }
    for key, val in db_updates.items():
        if val is not None:
            await _set_setting(db, key, val, current_user.id)

    # ── Detect embedding dimension mismatch ──────────────────────────────────
    if body.embedding_provider is not None or body.embedding_model is not None:
        new_provider = body.embedding_provider or str(await _get_setting(db, "llm.embedding_provider"))
        new_model = body.embedding_model or str(await _get_setting(db, "llm.embedding_model"))
        new_dim = get_provider_dimension(new_provider, new_model)

        current_dim_raw = await _get_setting(db, "llm.embedding_dimension")
        try:
            current_dim = int(current_dim_raw) if current_dim_raw else 768
        except (TypeError, ValueError):
            current_dim = 768

        if new_dim != current_dim:
            await _set_setting(db, "llm.kb_needs_reindex", "true", current_user.id)

    # Store API keys in OS keyring (never persisted to DB)
    if body.openai_api_key:
        app_settings.set_api_key("openai", body.openai_api_key)
    if body.anthropic_api_key:
        app_settings.set_api_key("anthropic", body.anthropic_api_key)
    if body.voyage_api_key:
        app_settings.set_api_key("voyage", body.voyage_api_key)
    if body.google_api_key:
        app_settings.set_api_key("google", body.google_api_key)

    await db.commit()

    # A newly added key unlocks that provider's models — rescan the catalog now
    # instead of waiting for the weekly refresh.
    if body.openai_api_key or body.anthropic_api_key or body.voyage_api_key:
        try:
            from services.llm.catalog import refresh_model_catalog
            await refresh_model_catalog(db)
        except Exception:
            pass  # discovery failure must never block saving settings

    return await get_settings(db, current_user)


class ApiKeyRequest(BaseModel):
    provider: str = Field(..., pattern="^(openai|anthropic)$")
    api_key: str = Field(..., min_length=1, max_length=500)


class TestConnectionRequest(BaseModel):
    provider: str = Field(..., pattern="^(ollama|openai|anthropic)$")


class TestConnectionResponse(BaseModel):
    ok: bool
    message: str


@router.put("/api-key", status_code=status.HTTP_204_NO_CONTENT)
async def set_api_key(
    body: ApiKeyRequest,
    _user: User = Depends(get_current_user),
) -> None:
    """Store a cloud LLM API key in the OS keyring."""
    app_settings.set_api_key(body.provider, body.api_key)


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(
    body: TestConnectionRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> TestConnectionResponse:
    """Test connectivity to the configured LLM provider."""
    provider = body.provider
    try:
        if provider == "ollama":
            from services.llm.ollama import OllamaClient
            ollama_url = str(await _get_setting(db, "llm.ollama_url"))
            client = OllamaClient(base_url=ollama_url)
            available = await client.is_available()
            return TestConnectionResponse(
                ok=available,
                message="Ollama is reachable." if available else "Ollama is not reachable — check the URL and that Ollama is running.",
            )

        if provider == "openai":
            api_key = app_settings.get_api_key("openai")
            if not api_key:
                return TestConnectionResponse(ok=False, message="No OpenAI API key configured.")
            from services.llm.openai_client import OpenAIClient
            client = OpenAIClient(api_key=api_key)
            available = await client.is_available()
            return TestConnectionResponse(
                ok=available,
                message="OpenAI API key is valid." if available else "OpenAI API key is invalid or the API is unreachable.",
            )

        if provider == "anthropic":
            api_key = app_settings.get_api_key("anthropic")
            if not api_key:
                return TestConnectionResponse(ok=False, message="No Anthropic API key configured.")
            from services.llm.anthropic_client import AnthropicClient
            client = AnthropicClient(api_key=api_key)
            available = await client.is_available()
            return TestConnectionResponse(
                ok=available,
                message="Anthropic API key is valid." if available else "Anthropic API key is invalid or the API is unreachable.",
            )

    except Exception as exc:
        return TestConnectionResponse(ok=False, message=f"Connection error: {exc}")

    return TestConnectionResponse(ok=False, message="Unknown provider.")


@router.get("/ollama-models")
async def list_ollama_models(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    """Return the list of models installed on the configured Ollama server."""
    import httpx
    ollama_url = str(await _get_setting(db, "llm.ollama_url"))
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{ollama_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            names = [m["name"] for m in data.get("models", [])]
            chat_models = [n for n in names if "embed" not in n.lower()]
            return {"models": chat_models}
    except Exception:
        return {"models": []}


_ANTHROPIC_FALLBACK = [
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
]


@router.get("/anthropic-models")
async def list_anthropic_models(
    _user: User = Depends(get_current_user),
) -> dict:
    """Return available Anthropic models, fetched live if an API key is set."""
    import httpx
    api_key = app_settings.get_api_key("anthropic")
    if not api_key:
        return {"models": _ANTHROPIC_FALLBACK}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )
            resp.raise_for_status()
            data = resp.json()
            names = [m["id"] for m in data.get("data", [])]
            # Only return Claude chat models (exclude legacy / fine-tuned)
            chat = [n for n in names if n.startswith("claude-")]
            return {"models": chat if chat else _ANTHROPIC_FALLBACK}
    except Exception:
        return {"models": _ANTHROPIC_FALLBACK}


# ── Per-task model overrides ─────────────────────────────────────────────────

class TaskModelOut(BaseModel):
    task: str
    label: str
    description: str
    recommended_provider: str
    recommended_model: str
    recommended_reason: str
    override_provider: str | None
    override_model: str | None
    effective_provider: str
    effective_model: str


class TaskModelUpdate(BaseModel):
    task: str = Field(..., min_length=1, max_length=50)
    # Both null/omitted = clear the override (revert to global pick)
    provider: str | None = Field(None, pattern="^(ollama|openai|anthropic)$")
    model: str | None = Field(None, min_length=1, max_length=100)


@router.get("/task-models", response_model=list[TaskModelOut])
async def get_task_models(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[TaskModelOut]:
    """Return all task categories with their recommended, override, and effective models."""
    from services.llm.router import resolve_task_llm
    from services.llm.tasks import LLM_TASKS

    out: list[TaskModelOut] = []
    for t in LLM_TASKS:
        ov_provider = await _get_setting(db, f"llm.task.{t.key}.provider")
        ov_model = await _get_setting(db, f"llm.task.{t.key}.model")
        eff_provider, eff_model = await resolve_task_llm(db, t.key)
        out.append(TaskModelOut(
            task=t.key,
            label=t.label,
            description=t.description,
            recommended_provider=t.recommended_provider,
            recommended_model=t.recommended_model,
            recommended_reason=t.recommended_reason,
            override_provider=str(ov_provider) if ov_provider else None,
            override_model=str(ov_model) if ov_model else None,
            effective_provider=eff_provider,
            effective_model=eff_model,
        ))
    return out


@router.put("/task-models", response_model=list[TaskModelOut])
async def update_task_model(
    body: TaskModelUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TaskModelOut]:
    """
    Set or clear the model override for one task category.
    Pass provider+model to set; omit both to clear (revert to global pick).
    """
    from sqlalchemy import delete as sa_delete

    from services.llm.tasks import TASK_KEYS

    if body.task not in TASK_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown task category: {body.task}")

    if (body.provider is None) != (body.model is None):
        raise HTTPException(status_code=400, detail="Provide both provider and model, or neither to clear.")

    if body.provider is None:
        # Clear override
        await db.execute(sa_delete(SystemSetting).where(SystemSetting.key.in_([
            f"llm.task.{body.task}.provider",
            f"llm.task.{body.task}.model",
        ])))
    else:
        if body.provider in ("openai", "anthropic") and not app_settings.get_api_key(body.provider):
            raise HTTPException(
                status_code=400,
                detail=f"No API key configured for {body.provider}. Add the key first in Settings → AI Engine.",
            )
        await _set_setting(db, f"llm.task.{body.task}.provider", body.provider, current_user.id)
        await _set_setting(db, f"llm.task.{body.task}.model", body.model, current_user.id)

    await db.commit()
    return await get_task_models(db, current_user)


@router.get("/ai-options")
async def get_ai_options(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    """
    Return the available model lists per provider, driven by the model catalog.

    Only providers with an active API key are included (Ollama: only when the
    local server is reachable). The catalog refreshes automatically when older
    than a week; POST /settings/refresh-models forces a rescan.
    """
    from services.llm.catalog import get_model_catalog, is_new_model

    catalog = await get_model_catalog(db)

    llm_models = {p: [m["id"] for m in entries] for p, entries in catalog.get("llm", {}).items()}
    embedding_models = {p: [m["id"] for m in entries] for p, entries in catalog.get("embedding", {}).items()}
    new_models = sorted(
        {m["id"] for entries in catalog.get("llm", {}).values() for m in entries if is_new_model(m)}
        | {m["id"] for entries in catalog.get("embedding", {}).values() for m in entries if is_new_model(m)}
    )

    return {
        "llm": llm_models,
        "embedding": embedding_models,
        "new_models": new_models,
        "updated_at": catalog.get("updated_at"),
    }


@router.post("/refresh-models")
async def refresh_models(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    """Force a model catalog rescan across all keyed providers."""
    from services.llm.catalog import refresh_model_catalog

    catalog = await refresh_model_catalog(db)
    return {
        "updated_at": catalog.get("updated_at"),
        "llm_providers": sorted(catalog.get("llm", {}).keys()),
        "embedding_providers": sorted(catalog.get("embedding", {}).keys()),
    }


@router.get("/me", response_model=UserOut)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
) -> UserOut:
    return UserOut.model_validate(current_user)


@router.get("/health")
async def settings_health(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    """
    Lightweight AI-provider-only health check for the Settings page.
    Performs live pings against the active LLM and embedding providers.
    Does NOT check disk space or database (those are in GET /health).

    Response shape:
      {
        "llm":       {"status": "ok"|"error", "provider": ..., "model": ..., "detail"?: ...},
        "embedding": {"status": "ok"|"error", "provider": ..., "model": ..., "dimension"?: ..., "detail"?: ...},
        "kb_needs_reindex": bool
      }
    """
    from routers.health import _ping_llm, _ping_embedding

    llm_provider = str(await _get_setting(db, "llm.provider"))
    llm_model = str(await _get_setting(db, "llm.model"))
    emb_provider = str(await _get_setting(db, "llm.embedding_provider"))
    emb_model = str(await _get_setting(db, "llm.embedding_model"))
    reindex_raw = str(await _get_setting(db, "llm.kb_needs_reindex") or "false")

    llm_result, emb_result = await asyncio.gather(
        _ping_llm(llm_provider, llm_model, db),
        _ping_embedding(emb_provider, emb_model, db),
    )

    return {
        "llm": llm_result,
        "embedding": emb_result,
        "kb_needs_reindex": reindex_raw.lower() == "true",
    }


# ── System notices — launch pop-down (offline systems, model updates, tips) ──

_MODEL_VERSION_RE = r"^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?"


def _parse_claude_version(model_id: str) -> tuple[str, int, int] | None:
    """('sonnet', 4, 6) from 'claude-sonnet-4-6'; None for unparseable ids."""
    import re as _re

    m = _re.match(_MODEL_VERSION_RE, model_id.strip().lower())
    if not m:
        return None
    return m.group(1), int(m.group(2)), int(m.group(3) or 0)


async def _fetch_anthropic_model_ids() -> list[str]:
    """Live Anthropic model list (empty on any failure — notices are best-effort)."""
    import httpx

    api_key = app_settings.get_api_key("anthropic")
    if not api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )
            resp.raise_for_status()
            return [m["id"] for m in resp.json().get("data", []) if str(m.get("id", "")).startswith("claude-")]
    except Exception:
        return []


@router.get("/notices")
async def system_notices(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    """
    Launch-time system notices for the pop-down banner:
      - offline systems (Google Workspace, AI engine unreachable / key missing)
      - newer Claude models available for models currently in use
      - one-time tip that models are configurable per task
    Each notice: {id, severity: error|warning|info, title, message, route}.
    """
    from services.llm.tasks import LLM_TASKS

    notices: list[dict] = []

    # 1. Google Workspace connectivity
    try:
        from services.google_service import get_credentials

        if not get_credentials():
            notices.append({
                "id": "google_disconnected",
                "severity": "warning",
                "title": "Google Workspace is not connected",
                "message": (
                    "Email, calendar, Drive, budgets and document sync are offline "
                    "until Google is reconnected."
                ),
                "route": "/settings",
            })
    except Exception:
        pass

    # 2. AI engine: key missing, or live ping failing
    provider = str(await _get_setting(db, "llm.provider") or app_settings.default_llm_provider)
    model = str(await _get_setting(db, "llm.model") or app_settings.default_llm_model)
    if provider in ("openai", "anthropic") and not app_settings.get_api_key(provider):
        notices.append({
            "id": "llm_key_missing",
            "severity": "error",
            "title": "AI engine has no API key",
            "message": f"{provider.capitalize()} is selected but no API key is configured — Gerry can't answer.",
            "route": "/settings",
        })
    else:
        try:
            from routers.health import _ping_llm

            res = await _ping_llm(provider, model, db)
            if res.get("status") != "ok":
                notices.append({
                    "id": "llm_offline",
                    "severity": "error",
                    "title": "AI engine is unreachable",
                    "message": str(res.get("detail") or f"{provider}/{model} did not respond."),
                    "route": "/settings",
                })
        except Exception:
            pass

    # 3. Newer Claude models available for anything currently in use
    available = await _fetch_anthropic_model_ids()
    if available:
        # Keep the dropdown catalog in step with reality: if the live list has
        # models the cached catalog lacks, refresh it now (weekly cadence
        # otherwise — this is what put opus-5 in the notice but not the menus).
        try:
            from services.llm.catalog import get_model_catalog, refresh_model_catalog

            catalog = await get_model_catalog(db)
            known = {m["id"] for m in catalog.get("llm", {}).get("anthropic", [])}
            if any(a not in known for a in available):
                await refresh_model_catalog(db)
        except Exception:
            pass

        from services.llm.router import resolve_task_llm

        in_use: dict[str, set[str]] = {}
        if provider == "anthropic":
            in_use.setdefault(model, set()).add("global default")
        for t in LLM_TASKS:
            p, m = await resolve_task_llm(db, t.key)
            if p == "anthropic":
                in_use.setdefault(m, set()).add(t.label)
        upgrades: list[str] = []
        seen_pairs: set[tuple[str, str]] = set()
        for used_model, used_by in in_use.items():
            used_v = _parse_claude_version(used_model)
            if not used_v:
                continue
            best = None
            for cand in available:
                cand_v = _parse_claude_version(cand)
                if cand_v and cand_v[0] == used_v[0] and (cand_v[1], cand_v[2]) > (used_v[1], used_v[2]):
                    if best is None or (cand_v[1], cand_v[2]) > (best[1][1], best[1][2]):
                        best = (cand, cand_v)
            if best and (used_model, best[0]) not in seen_pairs:
                seen_pairs.add((used_model, best[0]))
                upgrades.append(f"{best[0]} (you use {used_model} for {', '.join(sorted(used_by))})")
        if upgrades:
            notices.append({
                "id": "model_updates:" + ";".join(sorted(u.split(" ")[0] for u in upgrades)),
                "severity": "info",
                "title": "Newer Claude model(s) available",
                "message": "Available now: " + " · ".join(upgrades) + ". Update in Settings → Models per Task.",
                "route": "/settings",
            })

    # 4. One-time tip: per-task models never customized
    any_override = False
    for t in LLM_TASKS:
        if await _get_setting(db, f"llm.task.{t.key}.provider"):
            any_override = True
            break
    if not any_override:
        notices.append({
            "id": "task_models_tip",
            "severity": "info",
            "title": "Tip: pick a model per task",
            "message": (
                "Every task type (chat, email drafting, regulatory, research…) can use "
                "its own model — e.g. a fast model for research, the most capable for "
                "regulatory work. Settings → Models per Task."
            ),
            "route": "/settings",
        })

    return {"notices": notices}


@router.put("/me", response_model=UserOut)
async def update_my_profile(
    body: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    if body.new_password:
        if not body.current_password:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="current_password is required to set a new password.",
            )
        if not verify_password(body.current_password, current_user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Current password is incorrect.",
            )
        current_user.hashed_password = hash_password(body.new_password)

    if body.display_name is not None:
        current_user.display_name = body.display_name

    await db.commit()
    await db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.post("/onboarding/complete", response_model=UserOut)
async def complete_onboarding(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    """Mark the current user's first-use setup wizard as completed (one-time)."""
    if not current_user.onboarding_complete:
        current_user.onboarding_complete = True
        await db.commit()
        await db.refresh(current_user)
    return UserOut.model_validate(current_user)


# ── Client UI state (persists across app updates, unlike webview localStorage) ─

# Small, allow-listed keys the frontend persists server-side so one-time popups
# (What's New, the feature guide) survive installer updates that reset the
# embedded webview's localStorage.
_CLIENT_STATE_KEYS = {
    "whatsNew.lastSeenBuild",
    "featureGuide.seenBuilds",
}
_CLIENT_STATE_PREFIX = "client."


class ClientStateOut(BaseModel):
    value: object | None = None


class ClientStateIn(BaseModel):
    value: object | None = None


@router.get("/client-state/{key}", response_model=ClientStateOut)
async def get_client_state(
    key: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ClientStateOut:
    """Read a persisted client UI-state value (allow-listed keys only)."""
    if key not in _CLIENT_STATE_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown key.")
    value = await _get_setting(db, _CLIENT_STATE_PREFIX + key)
    return ClientStateOut(value=value)


@router.put("/client-state/{key}", response_model=ClientStateOut)
async def set_client_state(
    key: str,
    body: ClientStateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ClientStateOut:
    """Persist a client UI-state value server-side (allow-listed keys only)."""
    if key not in _CLIENT_STATE_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown key.")
    await _set_setting(db, _CLIENT_STATE_PREFIX + key, body.value, current_user.id)
    await db.commit()
    return ClientStateOut(value=body.value)


# ── Company context (Drive-backed, read-only cache) ─────────────────────────

class CompanyContextOut(BaseModel):
    content: str
    synced_at: str | None
    drive_file_id: str | None
    # "folder" when the configured Drive ID is a company-truth folder (one
    # markdown per section); "file" for the original single-file mode.
    source_kind: str = "file"
    sections: list[dict] = []


class CompanyContextRefreshOut(CompanyContextOut):
    ok: bool
    error: str | None = None


class CompanyContextFileIdIn(BaseModel):
    file_id: str = Field(..., min_length=1, max_length=200)


async def _company_context_out(db: AsyncSession) -> CompanyContextOut:
    from services.company_context import (
        KEY_MD,
        KEY_SYNCED_AT,
        MAX_COMPANY_CONTEXT_CHARS,
        _read_setting,
        get_drive_file_id,
        get_sections_manifest,
    )

    content = (await _read_setting(db, KEY_MD, ""))[:MAX_COMPANY_CONTEXT_CHARS]
    synced_at = await _read_setting(db, KEY_SYNCED_AT, "") or None
    file_id = await get_drive_file_id(db) or None
    sections = await get_sections_manifest(db)
    return CompanyContextOut(
        content=content,
        synced_at=synced_at,
        drive_file_id=file_id,
        source_kind="folder" if sections else "file",
        sections=sections,
    )


async def _refresh_company_context(db: AsyncSession) -> CompanyContextRefreshOut:
    """Run a sync and translate the outcome into a clear, user-facing reason."""
    from services.company_context import (
        get_drive_file_id,
        sync_company_context_from_drive,
    )
    from services.google_service import get_credentials

    error: str | None = None
    if not get_credentials():
        error = "Google is not connected — connect it in Settings → Google Integration."
    elif not await get_drive_file_id(db):
        error = "No Drive file is configured yet — set the Company Profile Drive file ID below."

    ok = False
    if error is None:
        ok = await sync_company_context_from_drive(db)
        if not ok:
            error = (
                "Couldn't read the Drive file or folder — check the ID, that your Google "
                "account has access to it, that it (or its section files) has readable "
                "text, and that the total is under 12,000 characters."
            )
    base = await _company_context_out(db)
    return CompanyContextRefreshOut(**base.model_dump(), ok=ok, error=error)


@router.get("/company-context", response_model=CompanyContextOut)
async def get_company_context_setting(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> CompanyContextOut:
    """Cached company-context content + last-synced timestamp (read-only —
    the shared Google Drive file is the single source of truth; there is
    deliberately no edit endpoint)."""
    return await _company_context_out(db)


@router.post("/company-context/refresh", response_model=CompanyContextRefreshOut)
async def refresh_company_context(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
) -> CompanyContextRefreshOut:
    """Manually re-pull the company context from the shared Drive file."""
    return await _refresh_company_context(db)


@router.put("/company-context/file-id", response_model=CompanyContextRefreshOut)
async def set_company_context_file_id(
    body: CompanyContextFileIdIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> CompanyContextRefreshOut:
    """One-time setup: store the Drive file ID, then immediately try a sync."""
    from services.company_context import KEY_DRIVE_FILE_ID

    await _set_setting(db, KEY_DRIVE_FILE_ID, body.file_id.strip(), current_user.id)
    await db.commit()
    return await _refresh_company_context(db)
