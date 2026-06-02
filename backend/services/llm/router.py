"""
LLM Router — resolves the active provider from system_settings and returns
the correct client (Ollama / OpenAI / Anthropic).

Usage (in any async FastAPI context):
    from services.llm.router import get_llm_client
    client = await get_llm_client(db)
    chunk = await client.chat(messages)
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings as app_settings
from models.db.settings import SystemSetting

logger = logging.getLogger(__name__)

PROVIDERS = ("ollama", "openai", "anthropic")


async def _read_setting(db: AsyncSession, key: str, default: str) -> str:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return str(row.value) if row and row.value else default


async def get_llm_client(db: AsyncSession):
    """
    Return the configured LLM client instance.

    Provider priority:
      1. Read 'llm.provider' from system_settings
      2. Fall back to 'ollama' if key missing or invalid
      3. For cloud providers, read API key from OS keyring via config.get_api_key()
      4. If API key is absent for cloud provider, fall back to Ollama with a warning.
    """
    provider = await _read_setting(db, "llm.provider", "ollama")
    model = await _read_setting(db, "llm.model", app_settings.default_llm_model)

    if provider == "openai":
        api_key = app_settings.get_api_key("openai")
        if not api_key:
            logger.warning("OpenAI provider selected but no API key set — falling back to Ollama")
            provider = "ollama"
        else:
            from services.llm.openai_client import OpenAIClient
            return OpenAIClient(api_key=api_key, model=model)

    if provider == "anthropic":
        api_key = app_settings.get_api_key("anthropic")
        if not api_key:
            logger.warning("Anthropic provider selected but no API key set — falling back to Ollama")
            provider = "ollama"
        else:
            from services.llm.anthropic_client import AnthropicClient
            return AnthropicClient(api_key=api_key, model=model)

    # Default: Ollama
    ollama_url = await _read_setting(db, "llm.ollama_url", app_settings.ollama_base_url)
    from services.llm.ollama import OllamaClient
    return OllamaClient(base_url=ollama_url, model=model)


async def get_llm_client_no_db() -> object:
    """
    Synchronous-context fallback: builds client from config defaults only,
    without a DB session. Used by agent WebSocket handler where DB is injected
    separately. Always returns OllamaClient with env defaults.
    """
    from services.llm.ollama import OllamaClient
    return OllamaClient()
