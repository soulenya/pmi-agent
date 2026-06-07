"""
LLM Router — resolves the active provider from system_settings and returns
the correct client (Anthropic / OpenAI / Ollama).

Usage (in any async FastAPI context):
    from services.llm.router import get_llm_client
    client = await get_llm_client(db)
    chunk = await client.chat(messages)

If the configured cloud provider has no API key set, a RuntimeError is raised
rather than silently falling back to Ollama. The caller is responsible for
handling this and surfacing an appropriate error to the user.
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

    Provider resolution order:
      1. Read 'llm.provider' from system_settings (default: 'anthropic')
      2. For cloud providers (Anthropic / OpenAI): read API key from OS keyring
         If the key is missing, raise RuntimeError — never fall back silently to Ollama.
      3. For Ollama: read base URL from settings.

    Raises RuntimeError if a cloud provider is selected but has no API key.
    """
    provider = await _read_setting(db, "llm.provider", app_settings.default_llm_provider)
    model = await _read_setting(db, "llm.model", app_settings.default_llm_model)

    if provider == "openai":
        api_key = app_settings.get_api_key("openai")
        if not api_key:
            raise RuntimeError(
                "OpenAI is selected as the LLM provider but no API key is configured. "
                "Go to Settings → AI Engine and enter your OpenAI API key."
            )
        from services.llm.openai_client import OpenAIClient
        return OpenAIClient(api_key=api_key, model=model)

    if provider == "anthropic":
        api_key = app_settings.get_api_key("anthropic")
        if not api_key:
            raise RuntimeError(
                "Anthropic is selected as the LLM provider but no API key is configured. "
                "Go to Settings → AI Engine and enter your Anthropic API key."
            )
        from services.llm.anthropic_client import AnthropicClient
        return AnthropicClient(api_key=api_key, model=model)

    # Ollama (explicit or unknown provider value)
    if provider not in PROVIDERS:
        logger.warning("Unknown LLM provider '%s' — falling back to Ollama", provider)
    ollama_url = await _read_setting(db, "llm.ollama_url", app_settings.ollama_base_url)
    from services.llm.ollama import OllamaClient
    return OllamaClient(base_url=ollama_url, model=model)
