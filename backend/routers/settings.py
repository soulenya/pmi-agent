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

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings as app_settings
from database import get_db
from dependencies import get_current_user
from models.db.settings import SystemSetting
from models.db.user import User
from models.schemas.auth import UserOut
from services.auth.service import hash_password, verify_password

router = APIRouter(prefix="/settings", tags=["settings"])

# ── Setting keys that are safe to expose ────────────────────────────────────

EXPOSED_KEYS = {
    "llm.model",
    "llm.ollama_url",
    "llm.embedding_model",
    "app.theme",
    "app.timezone",
    "notifications.email_enabled",
}

DEFAULTS: dict[str, object] = {
    "llm.provider": "ollama",
    "llm.model": "llama3.2",
    "llm.ollama_url": "http://localhost:11434",
    "llm.embedding_model": "nomic-embed-text",
    "app.theme": "system",
    "app.timezone": "UTC",
    "notifications.email_enabled": False,
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
    theme: str
    timezone: str
    notifications_email_enabled: bool
    # API key presence (never expose actual keys)
    openai_key_set: bool
    anthropic_key_set: bool


class SettingsUpdate(BaseModel):
    llm_provider: str | None = Field(None, pattern="^(ollama|openai|anthropic)$")
    llm_model: str | None = Field(None, min_length=1, max_length=100)
    ollama_url: str | None = Field(None, min_length=1, max_length=255)
    embedding_model: str | None = Field(None, min_length=1, max_length=100)
    theme: str | None = Field(None, pattern="^(light|dark|system)$")
    timezone: str | None = Field(None, max_length=64)
    notifications_email_enabled: bool | None = None
    # API keys — stored in OS keyring, never in DB
    openai_api_key: str | None = Field(None, min_length=1, max_length=500)
    anthropic_api_key: str | None = Field(None, min_length=1, max_length=500)


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
    return SettingsOut(
        llm_provider=str(await _get_setting(db, "llm.provider")),
        llm_model=str(await _get_setting(db, "llm.model")),
        ollama_url=str(await _get_setting(db, "llm.ollama_url")),
        embedding_model=str(await _get_setting(db, "llm.embedding_model")),
        theme=str(await _get_setting(db, "app.theme")),
        timezone=str(await _get_setting(db, "app.timezone")),
        notifications_email_enabled=bool(await _get_setting(db, "notifications.email_enabled")),
        openai_key_set=app_settings.get_api_key("openai") is not None,
        anthropic_key_set=app_settings.get_api_key("anthropic") is not None,
    )


@router.put("", response_model=SettingsOut)
async def update_settings(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SettingsOut:
    db_updates = {
        "llm.provider": body.llm_provider,
        "llm.model": body.llm_model,
        "llm.ollama_url": body.ollama_url,
        "llm.embedding_model": body.embedding_model,
        "app.theme": body.theme,
        "app.timezone": body.timezone,
        "notifications.email_enabled": body.notifications_email_enabled,
    }
    for key, val in db_updates.items():
        if val is not None:
            await _set_setting(db, key, val, current_user.id)

    # Store API keys in OS keyring (never persisted to DB)
    if body.openai_api_key:
        app_settings.set_api_key("openai", body.openai_api_key)
    if body.anthropic_api_key:
        app_settings.set_api_key("anthropic", body.anthropic_api_key)

    await db.commit()
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


@router.get("/me", response_model=UserOut)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
) -> UserOut:
    return UserOut.model_validate(current_user)


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
