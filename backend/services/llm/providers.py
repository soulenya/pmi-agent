"""The AI services this app can use, in one place.

Everything that needs to know "which providers are there, how are they
reached, and do they do embeddings" reads this: the client router, the agent,
the model catalog, the health checks and the Settings page.

Four kinds:

- ``anthropic`` and ``ollama`` have their own clients.
- ``openai`` is OpenAI itself.
- ``compatible`` is any service that speaks OpenAI's chat-completions API at
  its own address (Gemini, Grok, Mistral, DeepSeek, Groq, OpenRouter). They
  share OpenAI's client with a different ``base_url``, so adding one is an
  entry here and nothing else.
- ``voyage`` does embeddings only.

A provider's API key is found the way every key is
(``config.Settings.get_api_key``): ``<KEY>_API_KEY`` in the environment, then
``<key>_api_key`` in the OS keyring, then one saved in the app on a hub.

Model names are never listed here: they change monthly, so the catalog asks
each service for its own list. Embedding models are the exception, because
the vector size has to be known before anything is embedded.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# pgvector cannot index a vector longer than this, so a longer one is cut down.
MAX_INDEXED_DIMENSION = 2000


@dataclass(frozen=True)
class EmbeddingModel:
    # The size stored. For a model that returns more, the vector is cut to this
    # and re-normalised, which its maker documents as supported.
    dimension: int
    truncate: bool = False
    note: str = ""


@dataclass(frozen=True)
class Provider:
    key: str
    label: str
    kind: str  # anthropic | openai | ollama | compatible | voyage
    needs_key: bool = True
    # OpenAI-compatible address, without a trailing slash. Empty for the others.
    base_url: str = ""
    # Where a person gets a key, and what one looks like.
    key_url: str = ""
    key_hint: str = ""
    about: str = ""
    # Model ids the service lists that are not for chat (images, speech, embeddings...).
    not_chat: tuple[str, ...] = ()
    # Only ids starting with one of these are chat models, when the service lists other things too.
    chat_prefixes: tuple[str, ...] = ()
    # Some services list ids as "models/<id>".
    id_prefix: str = ""
    # A path that answers 401 for a bad key, where listing models is open to anyone.
    key_check: str = ""
    embeddings: dict[str, EmbeddingModel] = field(default_factory=dict)
    default_embedding: str = ""
    # Provides embeddings but no chat models (Voyage).
    embeddings_only: bool = False

    @property
    def has_chat(self) -> bool:
        return not self.embeddings_only

    @property
    def has_embeddings(self) -> bool:
        return bool(self.embeddings) or self.kind == "ollama"

    def is_chat_model(self, model_id: str) -> bool:
        low = model_id.lower()
        if self.chat_prefixes and not low.startswith(self.chat_prefixes):
            return False
        return not any(word in low for word in self.not_chat)


_SPEECH_AND_IMAGES = ("embed", "image", "tts", "audio", "speech", "whisper", "transcribe", "moderation", "video")

_ALL: tuple[Provider, ...] = (
    Provider(
        key="anthropic", label="Anthropic (Claude)", kind="anthropic",
        key_url="https://console.anthropic.com/", key_hint="sk-ant-...",
        about="Recommended. The only provider here that can read scanned documents and images.",
    ),
    Provider(
        key="openai", label="OpenAI", kind="openai",
        key_url="https://platform.openai.com/api-keys", key_hint="sk-...",
        about="Chat and embeddings on one key.",
        embeddings={
            "text-embedding-3-small": EmbeddingModel(1536),
            "text-embedding-3-large": EmbeddingModel(3072),
        },
        default_embedding="text-embedding-3-small",
    ),
    Provider(
        key="gemini", label="Google Gemini", kind="compatible",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        key_url="https://aistudio.google.com/apikey", key_hint="AIza...",
        about="Chat and embeddings on one key from Google AI Studio.",
        chat_prefixes=("gemini-",), id_prefix="models/",
        not_chat=(*_SPEECH_AND_IMAGES, "live", "robotics", "computer-use"),
        embeddings={
            "gemini-embedding-001": EmbeddingModel(1536, truncate=True, note="text"),
            "gemini-embedding-2": EmbeddingModel(1536, truncate=True, note="text, images and more"),
        },
        default_embedding="gemini-embedding-001",
    ),
    Provider(
        key="xai", label="xAI (Grok)", kind="compatible",
        base_url="https://api.x.ai/v1",
        key_url="https://console.x.ai/", key_hint="xai-...",
        about="Chat only: xAI has no embedding model, so embeddings stay with another provider.",
        chat_prefixes=("grok-",), not_chat=(*_SPEECH_AND_IMAGES, "imagine", "voice"),
    ),
    Provider(
        key="mistral", label="Mistral", kind="compatible",
        base_url="https://api.mistral.ai/v1",
        key_url="https://console.mistral.ai/api-keys", key_hint="",
        about="Chat and embeddings on one key.",
        not_chat=(*_SPEECH_AND_IMAGES, "ocr", "voxtral"),
        embeddings={"mistral-embed": EmbeddingModel(1024)},
        default_embedding="mistral-embed",
    ),
    Provider(
        key="deepseek", label="DeepSeek", kind="compatible",
        base_url="https://api.deepseek.com/v1",
        key_url="https://platform.deepseek.com/api_keys", key_hint="sk-...",
        about="Chat only.",
    ),
    Provider(
        key="groq", label="Groq", kind="compatible",
        base_url="https://api.groq.com/openai/v1",
        key_url="https://console.groq.com/keys", key_hint="gsk_...",
        about="Chat only: open models served fast.",
        not_chat=(*_SPEECH_AND_IMAGES, "guard", "playai", "orpheus"),
    ),
    Provider(
        key="openrouter", label="OpenRouter", kind="compatible",
        base_url="https://openrouter.ai/api/v1",
        key_url="https://openrouter.ai/keys", key_hint="sk-or-...",
        about="Chat only: one key for models from many companies (Meta, Cohere, Qwen and others).",
        key_check="/key",
    ),
    Provider(
        key="ollama", label="Ollama (on this computer)", kind="ollama", needs_key=False,
        about="Models running locally. Nothing leaves the computer.",
        embeddings={"nomic-embed-text": EmbeddingModel(768)},
        default_embedding="nomic-embed-text",
    ),
    Provider(
        key="voyage", label="Voyage AI", kind="voyage", embeddings_only=True,
        key_url="https://dash.voyageai.com/", key_hint="pa-...",
        about="Embeddings only. Anthropic's recommended partner, for use beside Claude.",
        embeddings={
            "voyage-3": EmbeddingModel(1024),
            "voyage-3-lite": EmbeddingModel(512),
            "voyage-3-large": EmbeddingModel(1024),
        },
        default_embedding="voyage-3",
    ),
)

PROVIDERS: dict[str, Provider] = {p.key: p for p in _ALL}
CHAT_PROVIDERS: tuple[str, ...] = tuple(p.key for p in _ALL if p.has_chat)
EMBEDDING_PROVIDERS: tuple[str, ...] = tuple(p.key for p in _ALL if p.has_embeddings)
# Everything a key can be saved for.
KEYED: tuple[str, ...] = tuple(p.key for p in _ALL if p.needs_key)


def get(key: str) -> Provider | None:
    return PROVIDERS.get(key)


def label(key: str) -> str:
    found = PROVIDERS.get(key)
    return found.label if found else key


def embedding_spec(provider: str, model: str) -> EmbeddingModel | None:
    found = PROVIDERS.get(provider)
    return found.embeddings.get(model) if found else None


def key_missing(provider: str) -> bool:
    """True when this provider needs an API key and none is configured."""
    from config import settings

    found = PROVIDERS.get(provider)
    return bool(found and found.needs_key and not settings.get_api_key(provider))


async def list_models(provider: str, api_key: str, timeout: float = 10.0) -> list[str]:
    """Ask an OpenAI-compatible service which chat models this key can use.

    Raises on a rejected key or an unreachable service, so it doubles as the
    connection test.
    """
    import httpx

    spec = PROVIDERS[provider]
    base = spec.base_url or "https://api.openai.com/v1"
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        if spec.key_check:
            (await client.get(base + spec.key_check, headers=headers)).raise_for_status()
        resp = await client.get(f"{base}/models", headers=headers)
        resp.raise_for_status()
        data = resp.json()
    rows = data.get("data", data) if isinstance(data, dict) else data
    ids: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        model_id = str(row.get("id", "") if isinstance(row, dict) else row)
        if spec.id_prefix and model_id.startswith(spec.id_prefix):
            model_id = model_id[len(spec.id_prefix):]
        if model_id and spec.is_chat_model(model_id):
            ids.append(model_id)
    return sorted(set(ids))
