"""
Application settings — reads from environment variables / .env file.

Secrets (JWT, Fernet, provider API keys) come from the OS keyring on desktop
installs. The hub has no keyring, so each one falls back to an environment
variable populated from Secret Manager.
"""

from __future__ import annotations

import os
import secrets
from functools import lru_cache

import keyring
from cryptography.fernet import Fernet
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_KEYRING_SERVICE = "pmi-agent"


def _keyring_get(key: str) -> str | None:
    """Read from the OS keyring, tolerating hosts that have none."""
    try:
        return keyring.get_password(_KEYRING_SERVICE, key)
    except Exception:
        return None


def _keyring_set(key: str, value: str) -> bool:
    """Write to the OS keyring; False when the host has none."""
    try:
        keyring.set_password(_KEYRING_SERVICE, key, value)
        return True
    except Exception:
        return False


class Settings(BaseSettings):
    # ── Application ──────────────────────────────────────────────────────────
    app_name: str = "PMI AI Assistant"
    app_version: str = "0.1.0"
    debug: bool = False

    # ── Server ───────────────────────────────────────────────────────────────
    host: str = "127.0.0.1"
    port: int = 8000
    # Origins allowed to call the API. Desktop shell + local dev by default;
    # the hub replaces this with its own origin via CORS_ORIGINS.
    # pywebview opens the frontend on 127.0.0.1:5173, not localhost:5173, so
    # both spellings are required.
    cors_origins: list[str] = [
        "tauri://localhost",
        "https://tauri.localhost",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    ]

    # ── Hub deployment ───────────────────────────────────────────────────────
    # True only on the shared server. Disables desktop-only machinery (meeting
    # capture, self-update) and switches sign-in over to IAP.
    hub_mode: bool = False
    # Full IAP audience: /projects/<project-number>/global/backendServices/<id>
    iap_audience: str = ""
    # The downloaded "web" OAuth client, for per-user Google sign-in on the
    # hub. Supply the JSON directly, or point at the downloaded file. The
    # desktop keeps using its own installed-app client.
    google_web_client_json: str = ""
    google_web_client_file: str = ""

    # ── Reaching the hub from a desktop install ──────────────────────────────
    # Where the shared project spaces live. Blank turns the feature off.
    hub_url: str = "https://hub.precisianmedical.com"
    # A desktop-type OAuth client that the hub's IAP allows through for
    # programmatic access. Not the same client as Google sign-in: IAP only
    # accepts tokens from clients on its allowlist. Normally left blank: the
    # app collects the client from the firm's Drive on first run.
    hub_desktop_client_id: str = ""
    # The Drive file holding that client. Blank means look it up by name.
    hub_client_drive_file_id: str = ""

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
    default_llm_model: str = "claude-sonnet-5"
    default_embedding_provider: str = "voyage"
    default_embedding_model: str = "voyage-3"
    default_embedding_dimension: int = 1024

    # ── Company context ───────────────────────────────────────────────────────
    # Default shared Google Drive file ID for the company-context profile.
    # Baked into the build so every install syncs the same file with zero
    # per-user setup; a SystemSetting ("company.profile_drive_file_id") set
    # via Settings → Company Profile overrides it on that machine.
    company_context_drive_file_id: str = "1aqx08UZ6J1qWAK4o9RMQMeonGvV1yI1C"
    # Shared Drive folder of document templates (see services/file_templates.py).
    # Every doc in it (and its subfolders) is a template.
    file_templates_drive_folder_id: str = "1EFoPDRfAA1RaxRtWEEVj32eGfpeekV0F"
    # Shared Drive folder where workroom manifests live (see
    # services/workroom_share.py); a SystemSetting
    # ("workrooms.share_folder_id_override") overrides it on that machine.
    workrooms_share_folder_id: str = "1rk-Pg-Ly9cIrHF87Cr7Gnu7-VRUjamT7"

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

    # ── Meeting auto-capture ─────────────────────────────────────────────────
    # When enabled, a background monitor watches for video-call apps (Zoom,
    # Teams, Google Meet, …) and records the machine's audio while a call is
    # active, then transcribes (Google STT v2) + summarizes into a meeting note.
    # Audio capture works on Windows (WASAPI loopback); other platforms detect
    # the meeting but can't capture system audio without a virtual device.
    #   The on/off toggle is a per-install runtime setting ("meetings.autorecord"
    #   in SystemSetting); this flag is only the factory default.
    meeting_autorecord_default: bool = False
    # Seconds between meeting-detection scans.
    meeting_detect_interval_seconds: int = 5
    # A detected call must persist this many seconds before recording starts
    # (debounce against transient windows / accidental matches).
    meeting_detect_debounce_seconds: int = 8
    # A call must be gone this many seconds before recording stops (avoids
    # cutting on a brief screen-share switch or focus change).
    meeting_end_grace_seconds: int = 20
    # Hard cap on a single recording (safety net so a stuck detector can't fill
    # the disk). 4 h of 16 kHz mono PCM ≈ 460 MB.
    meeting_max_record_seconds: int = 4 * 60 * 60

    # ── Access / onboarding ──────────────────────────────────────────────────
    # The single application owner. On first Google SSO sign-in this email is
    # provisioned as "admin"; every other allowed-domain account is provisioned
    # as a full-access "member". Each user runs their own local copy.
    admin_email: str = "morganjkeane@pmi-llc.com"
    # Every domain that counts as "our own company". Anyone at one of these is
    # a colleague (CC'd, never the target of an outbound thank-you); everyone
    # else in a meeting is the other party.
    company_domains: list[str] = ["pmi-llc.com", "precisianmedical.com"]
    # Link emailed to invitees so they can download and install Little Gerry.
    installer_download_url: str = "https://github.com/soulenya/pmi-agent/releases/latest"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Secret properties (env var on the hub, OS keyring on desktop) ────────

    @property
    def jwt_secret(self) -> str:
        """JWT signing secret. Shared across a hub, per-install on desktop."""
        env = os.environ.get("JWT_SECRET")
        if env:
            return env
        value = _keyring_get("jwt_secret")
        if value:
            return value
        value = secrets.token_urlsafe(64)
        if not _keyring_set("jwt_secret", value):
            # Returning a fresh secret per call would invalidate every token.
            raise RuntimeError(
                "No JWT secret available: set JWT_SECRET, or run on a host with "
                "an OS keyring."
            )
        return value

    @property
    def fernet_key(self) -> str:
        """Document encryption key. Losing it makes stored documents unreadable."""
        env = os.environ.get("FERNET_KEY")
        if env:
            return env
        value = _keyring_get("fernet_key")
        if value:
            return value
        value = Fernet.generate_key().decode()
        if not _keyring_set("fernet_key", value):
            raise RuntimeError(
                "No Fernet key available: set FERNET_KEY, or run on a host with "
                "an OS keyring. Generating a new one would orphan every "
                "existing document."
            )
        return value

    def get_api_key(self, provider: str) -> str | None:
        """Provider API key, e.g. ANTHROPIC_API_KEY then keyring."""
        env = os.environ.get(f"{provider.upper()}_API_KEY")
        if env:
            return env
        return _keyring_get(f"{provider}_api_key")

    def set_api_key(self, provider: str, key: str) -> None:
        """Store a cloud provider API key in the OS keyring."""
        keyring.set_password(_KEYRING_SERVICE, f"{provider}_api_key", key)

    @property
    def hub_desktop_client_secret(self) -> str:
        """Secret half of the hub sign-in client. Never leaves this machine."""
        return os.environ.get("HUB_DESKTOP_CLIENT_SECRET") or _keyring_get(
            "hub_desktop_client_secret"
        ) or ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
