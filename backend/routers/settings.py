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
from services.llm import providers as llm_providers

router = APIRouter(prefix="/settings", tags=["settings"])

# Which providers may be named, from the one registry (services/llm/providers.py).
_CHAT_PATTERN = "^(" + "|".join(llm_providers.CHAT_PROVIDERS) + ")$"
_EMBEDDING_PATTERN = "^(" + "|".join(llm_providers.EMBEDDING_PROVIDERS) + ")$"
# "google" is the Google Cloud speech key, which is not an AI provider's.
_KEY_NAMES = (*llm_providers.KEYED, "google")
_KEY_PATTERN = "^(" + "|".join(_KEY_NAMES) + ")$"

# Current revision of the first-use wizard. Raise this whenever steps are added
# so existing users are offered the new ones; the frontend keeps a matching
# constant that decides which steps to show.
ONBOARDING_VERSION = 2

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
    # The same, for every provider that takes a key.
    keys_set: dict[str, bool] = {}
    # Set when choosing a provider moved the embeddings with it.
    embeddings_followed: bool = False


class SettingsUpdate(BaseModel):
    llm_provider: str | None = Field(None, pattern=_CHAT_PATTERN)
    llm_model: str | None = Field(None, min_length=1, max_length=100)
    ollama_url: str | None = Field(None, min_length=1, max_length=255)
    embedding_model: str | None = Field(None, min_length=1, max_length=100)
    embedding_provider: str | None = Field(None, pattern=_EMBEDDING_PATTERN)
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
    # Any provider's key, by provider: {"gemini": "AIza..."}.
    api_keys: dict[str, str] | None = None


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
        keys_set={name: app_settings.get_api_key(name) is not None for name in _KEY_NAMES},
    )


async def _embedded_documents(db: AsyncSession, other_than_model: str | None = None) -> int:
    """How many documents hold stored vectors: all of them, or only those made
    with a model other than the one named. Every chunk records the model that
    embedded it, so this is read from the knowledge base and not remembered."""
    from sqlalchemy import text

    sql = "SELECT count(DISTINCT document_id) FROM document_chunks WHERE embedding IS NOT NULL"
    params: dict[str, str] = {}
    if other_than_model is not None:
        sql += " AND embedding_model <> :model"
        params["model"] = other_than_model
    return int((await db.execute(text(sql), params)).scalar() or 0)


def _stored_embedding_model(provider: str, model: str) -> str:
    """The model name written on a chunk when this provider embeds it."""
    from services.embeddings.service import EMBEDDING_MODEL, _resolve_model

    # The Ollama service embeds with one model whatever the setting says.
    return EMBEDDING_MODEL if provider == "ollama" else _resolve_model(provider, model)


@router.put("", response_model=SettingsOut)
async def update_settings(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SettingsOut:
    keys: dict[str, str] = {
        name: key
        for name, key in (
            ("openai", body.openai_api_key),
            ("anthropic", body.anthropic_api_key),
            ("voyage", body.voyage_api_key),
            ("google", body.google_api_key),
        )
        if key
    }
    for name, key in (body.api_keys or {}).items():
        if name not in _KEY_NAMES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown provider: {name}")
        if key and key.strip():
            keys[name] = key.strip()[:500]

    old_llm_provider = str(await _get_setting(db, "llm.provider"))
    old_emb_provider = str(await _get_setting(db, "llm.embedding_provider"))
    old_emb_model = str(await _get_setting(db, "llm.embedding_model"))

    emb_provider, emb_model = body.embedding_provider, body.embedding_model

    # A provider that does embeddings too takes them with it, so one key is
    # enough: but only when the request leaves embeddings alone and no document
    # has been embedded yet. With a knowledge base in place the switch would
    # mean re-embedding all of it, which is the person's call (the Settings
    # page offers it), never a side effect of picking a chat model.
    followed = False
    if (
        body.llm_provider
        and body.llm_provider != old_llm_provider
        and emb_provider is None
        and emb_model is None
    ):
        spec = llm_providers.get(body.llm_provider)
        if (
            spec is not None
            and spec.default_embedding
            and spec.key != old_emb_provider
            and await _embedded_documents(db) == 0
        ):
            emb_provider, emb_model = spec.key, spec.default_embedding
            followed = True

    if emb_provider is not None or emb_model is not None:
        from services.embeddings.service import _resolve_model

        emb_provider = emb_provider or old_emb_provider
        # A model from another provider's list becomes this provider's default.
        emb_model = _resolve_model(emb_provider, emb_model or old_emb_model)

    db_updates = {
        "llm.provider": body.llm_provider,
        "llm.model": body.llm_model,
        "llm.ollama_url": body.ollama_url,
        "llm.embedding_model": emb_model,
        "llm.embedding_provider": emb_provider,
        "app.theme": body.theme,
        "app.timezone": body.timezone,
        "notifications.email_enabled": body.notifications_email_enabled,
        "voice.speak_replies": body.voice_speak_replies,
        "voice.voice_name": body.voice_voice_name,
    }
    for key, val in db_updates.items():
        if val is not None:
            await _set_setting(db, key, val, current_user.id)

    # ── Does the knowledge base still match the embedding model? ─────────────
    # Vectors from two models cannot be compared, even at the same size, so a
    # re-index is due exactly when a stored vector came from another model.
    # Switching back before re-indexing therefore clears the flag again.
    if emb_provider is not None and emb_model is not None:
        stale = await _embedded_documents(db, _stored_embedding_model(emb_provider, emb_model))
        await _set_setting(db, "llm.kb_needs_reindex", "true" if stale else "false", current_user.id)

    # Keys go where this kind of install keeps them: the OS keyring on a
    # desktop, the encrypted store on a hub (administrators only). Never in
    # system_settings.
    from services.secret_store import save_api_key

    for name, key in keys.items():
        await save_api_key(db, current_user, name, key)

    await db.commit()

    # A newly added key unlocks that provider's models — rescan the catalog now
    # instead of waiting for the weekly refresh.
    if any(name != "google" for name in keys):
        try:
            from services.llm.catalog import refresh_model_catalog
            await refresh_model_catalog(db)
        except Exception:
            pass  # discovery failure must never block saving settings

    out = await get_settings(db, current_user)
    out.embeddings_followed = followed
    return out


class ApiKeyRequest(BaseModel):
    provider: str = Field(..., pattern=_KEY_PATTERN)
    api_key: str = Field(..., min_length=1, max_length=500)


class TestConnectionRequest(BaseModel):
    provider: str = Field(..., pattern=_CHAT_PATTERN)


class TestConnectionResponse(BaseModel):
    ok: bool
    message: str


@router.put("/api-key", status_code=status.HTTP_204_NO_CONTENT)
async def set_api_key(
    body: ApiKeyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Store a provider's API key (keyring on a desktop; administrators only on a hub)."""
    from services.secret_store import save_api_key

    await save_api_key(db, current_user, body.provider, body.api_key)
    await db.commit()
    if body.provider != "google":
        try:
            from services.llm.catalog import refresh_model_catalog
            await refresh_model_catalog(db)
        except Exception:
            pass  # discovery failure must never block saving a key


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

        spec = llm_providers.get(provider)
        if spec is not None and spec.kind == "compatible":
            api_key = app_settings.get_api_key(provider)
            if not api_key:
                return TestConnectionResponse(ok=False, message=f"No {spec.label} API key configured.")
            import httpx

            try:
                models = await llm_providers.list_models(provider, api_key)
            except httpx.HTTPStatusError as exc:
                code = exc.response.status_code
                return TestConnectionResponse(
                    ok=False,
                    message=(
                        f"{spec.label} refused this API key."
                        if code in (400, 401, 403)
                        else f"{spec.label} answered with an error ({code})."
                    ),
                )
            return TestConnectionResponse(
                ok=True,
                message=f"{spec.label} API key is valid: {len(models)} chat model(s) available.",
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
    provider: str | None = Field(None, pattern=_CHAT_PATTERN)
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
        if llm_providers.key_missing(body.provider):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No API key configured for {llm_providers.label(body.provider)}. "
                    "Add the key first in Settings → AI Engine."
                ),
            )
        await _set_setting(db, f"llm.task.{body.task}.provider", body.provider, current_user.id)
        await _set_setting(db, f"llm.task.{body.task}.model", body.model, current_user.id)

    await db.commit()
    return await get_task_models(db, current_user)


@router.get("/ai-providers")
async def get_ai_providers(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    """
    Every AI service this app can use, for the Settings page: what it is
    called, whether it takes a key and has one, where to get one, and which
    embedding models it has (none for a chat-only service).

    ``embedded_documents`` is how many documents a change of embedding model
    would have to re-index.
    """
    from services.llm.router import VISION_PROVIDERS

    return {
        "providers": [
            {
                "key": p.key,
                "label": p.label,
                "about": p.about,
                "chat": p.has_chat,
                "needs_key": p.needs_key,
                "key_set": (not p.needs_key) or app_settings.get_api_key(p.key) is not None,
                "key_url": p.key_url,
                "key_hint": p.key_hint,
                "reads_documents": p.key in VISION_PROVIDERS,
                "embedding_models": [
                    {"id": name, "dimension": m.dimension, "note": m.note}
                    for name, m in p.embeddings.items()
                ],
                "default_embedding": p.default_embedding,
            }
            for p in llm_providers.PROVIDERS.values()
        ],
        "embedded_documents": await _embedded_documents(db),
    }


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

    # 0. Where you are. On the hub the shared work is all here, and the personal
    #    half of the app is on the person's own computer - say so once, or the
    #    missing budgets and knowledge base read as breakage.
    if app_settings.hub_mode:
        from brand import get_brand

        # Only a brand whose ERP is Odoo has an Odoo page to send people to.
        uses_odoo = (get_brand().raw.get("erp") or {}).get("default", "odoo") == "odoo"
        notices.append({
            "id": "on_hub",
            "severity": "info",
            "title": "You're on the hub",
            "message": (
                "Your projects, tasks, budgets and chats, Team, and Gerry are all here. "
                "Conversations from your own computer arrive as it carries them up; "
                "its knowledge base does not. "
                "Connect your Google account under Settings to use Drive, Gmail and Calendar "
                + (
                    "from here, and paste your Odoo API key on the Odoo page to see the bank balance."
                    if uses_odoo
                    else "from here."
                )
            ),
            "route": "/settings?tab=connections",
        })

    # 1. Google Workspace connectivity
    try:
        from services.google_service import get_credentials

        if not get_credentials():
            notices.append({
                "id": "google_disconnected",
                "severity": "warning",
                "title": (
                    "Your Google account is not connected on the hub"
                    if app_settings.hub_mode
                    else "Google Workspace is not connected"
                ),
                "message": (
                    "Gmail, Calendar, Drive and budgets on the hub use a grant of your own; "
                    "the one on your computer does not carry over. Connect it here once."
                    if app_settings.hub_mode
                    else "Email, calendar, Drive, budgets and document sync are offline "
                    "until Google is reconnected."
                ),
                "route": "/settings?tab=connections" if app_settings.hub_mode else "/settings",
            })
    except Exception:
        pass

    # 2. AI engine: key missing, or live ping failing
    provider = str(await _get_setting(db, "llm.provider") or app_settings.default_llm_provider)
    model = str(await _get_setting(db, "llm.model") or app_settings.default_llm_model)
    if llm_providers.key_missing(provider):
        notices.append({
            "id": "llm_key_missing",
            "severity": "error",
            "title": "AI engine has no API key",
            "message": f"{llm_providers.label(provider)} is selected but no API key is configured — Gerry can't answer.",
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
    """Mark the setup wizard finished at the current wizard revision."""
    changed = False
    if not current_user.onboarding_complete:
        current_user.onboarding_complete = True
        changed = True
    if current_user.onboarding_version < ONBOARDING_VERSION:
        current_user.onboarding_version = ONBOARDING_VERSION
        changed = True
    if changed:
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
    "hub.movePrompt",
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
