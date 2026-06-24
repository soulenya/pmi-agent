"""
Application settings — reads from environment variables / .env file.
Secrets (JWT, Fernet) are stored in the OS keyring, never in files or env vars.
"""

from __future__ import annotations

import secrets
from functools import lru_cache

import keyring
from cryptography.fernet import Fernet
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_KEYRING_SERVICE = "pmi-agent"


class Settings(BaseSettings):
    # ── Application ──────────────────────────────────────────────────────────
    app_name: str = "PMI AI Assistant"
    app_version: str = "0.1.0"
    debug: bool = False

    # ── Server ───────────────────────────────────────────────────────────────
    host: str = "127.0.0.1"
    port: int = 8000

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str = Field(
        default="postgresql+asyncpg://pmi_app:pmi_dev_password@localhost:5432/pmi_dev"
    )
    # Sync URL is used by Alembic migrations only
    database_url_sync: str = Field(
        default="postgresql://pmi_app:pmi_dev_password@localhost:5432/pmi_dev"
    )

    # ── JWT ───────────────────────────────────────────────────────────────────
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    # ── AI Providers ──────────────────────────────────────────────────────────
    # Ollama is optional (third-tier local/LAN). Default provider is Anthropic.
    ollama_base_url: str = "http://localhost:11434"
    default_llm_provider: str = "anthropic"
    default_llm_model: str = "claude-sonnet-4-6"
    default_embedding_provider: str = "voyage"
    default_embedding_model: str = "voyage-3"
    default_embedding_dimension: int = 1024

    # ── RAG ──────────────────────────────────────────────────────────────────
    chunk_size_tokens: int = 512
    chunk_overlap_tokens: int = 64
    rag_top_k: int = 5

    # ── Agent ────────────────────────────────────────────────────────────────
    # Max recursive tool-call rounds for a single chat turn. Complex multi-step
    # tasks (e.g. search → fetch many threads → build a doc → upload) need many
    # rounds; this caps runaway loops while leaving generous headroom.
    agent_max_tool_rounds: int = 30

    # ── Storage ──────────────────────────────────────────────────────────────
    # Root directory where encrypted document files are stored
    storage_root: str = "~/.pmi-agent/documents"

    # ── Approval ─────────────────────────────────────────────────────────────
    approval_expiry_hours: int = 48

    # ── Feedback ─────────────────────────────────────────────────────────────
    # User-submitted bug reports / feature requests are routed to this account's
    # notifications. Falls back to all admin users if the email isn't found.
    feedback_recipient_email: str = "morganjkeane@pmi-llc.com"

    # ── Push notifications (APNs) ────────────────────────────────────────────
    # Token-based (.p8) auth for the iOS app. Leave blank to disable push — the
    # backend then runs unchanged (the sender becomes a no-op). TestFlight builds
    # use the PRODUCTION host, so keep apns_use_sandbox False except for local
    # Xcode debug builds.
    apns_key_id: str = ""        # 10-char Key ID of the AuthKey .p8
    apns_team_id: str = ""       # 10-char Apple Developer Team ID
    apns_bundle_id: str = ""     # app bundle id, used as the APNs topic
    apns_key_path: str = ""      # path to AuthKey_XXXXXXXXXX.p8
    apns_use_sandbox: bool = False

    # ── Speech-to-Text (Google Cloud STT v2, long meeting audio) ─────────────
    # Long recordings (>60 s) use the v2 batchRecognize API, which needs a GCS
    # bucket plus a service account (the app's "google" API key does NOT work
    # for v2 or GCS). Leave the bucket/credentials blank to disable — the
    # backend then falls back to the synchronous ≤60 s Google STT path.
    #   GCP_STT_BUCKET            — GCS bucket for temporary audio uploads
    #   GCP_SERVICE_ACCOUNT_FILE  — path to the service-account JSON key
    #                               (optional; ADC is used when blank)
    #   GCP_PROJECT_ID            — project id (only needed if ADC can't infer it)
    #   GCP_STT_LOCATION          — STT region (must support the chosen model)
    #   GCP_STT_MODEL             — recognition model (long, chirp_2, …)
    #   GCP_STT_LANGUAGE          — BCP-47 language code
    #   GCP_STT_DIARIZE           — tag speakers (model/region must support it)
    gcp_stt_bucket: str = "little_gerry_stt"
    gcp_service_account_file: str = ""
    gcp_project_id: str = ""
    # Multi-region (us/eu) is required for speaker diarization in batchRecognize;
    # single-region locations (e.g. us-central1) reject it.
    gcp_stt_location: str = "us"
    gcp_stt_model: str = "long"
    gcp_stt_language: str = "en-US"
    # Speaker diarization is off by default: batchRecognize support varies by
    # model/region and rejects the request where unsupported. Enable only with a
    # compatible model + location.
    gcp_stt_diarize: bool = False

    # ── Access / onboarding ──────────────────────────────────────────────────
    # The single application owner. On first Google SSO sign-in this email is
    # provisioned as "admin"; every other allowed-domain account is provisioned
    # as a full-access "member". Each user runs their own local copy.
    admin_email: str = "morganjkeane@pmi-llc.com"
    # Link emailed to invitees so they can download and install Little Gerry.
    installer_download_url: str = "https://github.com/soulenya/pmi-agent/releases/latest"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Secret properties (OS keyring) ───────────────────────────────────────

    @property
    def jwt_secret(self) -> str:
        """Return JWT signing secret from OS keyring; generate on first call."""
        value = keyring.get_password(_KEYRING_SERVICE, "jwt_secret")
        if not value:
            value = secrets.token_urlsafe(64)
            keyring.set_password(_KEYRING_SERVICE, "jwt_secret", value)
        return value

    @property
    def fernet_key(self) -> str:
        """Return Fernet encryption key from OS keyring; generate on first call."""
        value = keyring.get_password(_KEYRING_SERVICE, "fernet_key")
        if not value:
            value = Fernet.generate_key().decode()
            keyring.set_password(_KEYRING_SERVICE, "fernet_key", value)
        return value

    def get_api_key(self, provider: str) -> str | None:
        """Retrieve a cloud provider API key from the OS keyring."""
        return keyring.get_password(_KEYRING_SERVICE, f"{provider}_api_key")

    def set_api_key(self, provider: str, key: str) -> None:
        """Store a cloud provider API key in the OS keyring."""
        keyring.set_password(_KEYRING_SERVICE, f"{provider}_api_key", key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
