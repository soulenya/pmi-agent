"""
Google Cloud Speech-to-Text v2 (batchRecognize) — long meeting audio.

Recordings longer than ~60 s can't use the synchronous recognize API. This
module:
  1. uploads the audio to a GCS bucket,
  2. runs a v2 batchRecognize long-running operation (long/Chirp model, with
     automatic punctuation and optional speaker diarization),
  3. polls the operation to completion,
  4. returns the joined transcript,
  5. deletes the uploaded object (best effort).

Auth: requires a Google Cloud **service account** (OAuth2 / cloud-platform
scope). The app's "google" API key authenticates the v1 sync API only and does
NOT work for v2 batchRecognize or GCS. Configure via environment / .env:
    GCP_STT_BUCKET, GCP_SERVICE_ACCOUNT_FILE, GCP_STT_LOCATION,
    GCP_STT_MODEL, GCP_STT_LANGUAGE, GCP_STT_DIARIZE
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import quote

import httpx

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
# Service-account key bundled with the app. The installer drops it next to the
# other backend credential files (backend/google_stt_sa.json); when present it
# is used automatically, so end users need no .env or gcloud setup.
_BUNDLED_KEY = Path(__file__).resolve().parent.parent.parent / "google_stt_sa.json"
# Company-hosted service-account key, mirroring the google_credentials.json
# "Download credentials" flow. Set this to a Google Drive "Anyone with the link"
# share URL (or a plain HTTPS URL) pointing at the SA key JSON, or override with
# the GOOGLE_STT_KEY_URL env var. When set, the key is fetched automatically on
# first use so teammates install nothing and touch no files.
GOOGLE_STT_KEY_DOWNLOAD_URL = "https://drive.google.com/file/d/1FyBDnxuf7dSS0pEE-j6Ho4w5BMeDPCmQ/view?usp=drive_link"
# Poll the long-running operation for up to ~15 min (audio is transcribed
# faster than real time, so this comfortably covers multi-hour recordings).
_POLL_INTERVAL_SECONDS = 5
_POLL_MAX_ATTEMPTS = 180


class SttNotConfiguredError(Exception):
    """Raised when the GCS bucket or service account isn't configured."""


class SttError(Exception):
    """Raised when upload, transcription, or polling fails."""


def _key_file() -> Path | None:
    """Return the service-account key path: explicit config, else bundled key."""
    configured = settings.gcp_service_account_file
    if configured:
        path = Path(configured).expanduser()
        return path if path.is_file() else None
    return _BUNDLED_KEY if _BUNDLED_KEY.is_file() else None


def _download_url() -> str:
    """Company SA-key URL (env var overrides the baked-in constant)."""
    return (os.environ.get("GOOGLE_STT_KEY_URL") or GOOGLE_STT_KEY_DOWNLOAD_URL).strip()


def _to_direct_download_url(url: str) -> str:
    """Turn a Google Drive share link into a direct-download URL (else unchanged)."""
    if "uc?export=download" in url or "drive.google.com/uc" in url:
        return url
    match = re.search(r"/file/d/([A-Za-z0-9_-]+)", url) or re.search(
        r"[?&]id=([A-Za-z0-9_-]+)", url
    )
    if match:
        return f"https://drive.google.com/uc?export=download&id={match.group(1)}"
    return url


def _validate_sa_key(raw: bytes) -> dict:
    """Parse + validate that *raw* is a Google service-account key JSON."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise SttError("The downloaded key file is not valid JSON.") from exc
    if (
        not isinstance(data, dict)
        or data.get("type") != "service_account"
        or not data.get("private_key")
        or not data.get("client_email")
    ):
        raise SttError("The downloaded file isn't a Google service-account key.")
    return data


def _ensure_key_downloaded() -> None:
    """Fetch the company SA key to disk when missing and a URL is configured."""
    if _key_file() is not None:
        return
    url = _download_url()
    if not url:
        return
    download_url = _to_direct_download_url(url)
    try:
        req = urllib.request.Request(
            download_url, headers={"User-Agent": "LittleGerry"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (trusted company URL)
            raw = resp.read(64 * 1024)  # an SA key is < 4 KB
    except Exception as exc:  # noqa: BLE001
        raise SttError(f"Couldn't download the transcription key: {exc}") from exc
    _validate_sa_key(raw)
    try:
        _BUNDLED_KEY.write_bytes(raw)
    except OSError as exc:
        raise SttError(f"Couldn't save the transcription key: {exc}") from exc


def _adc_available() -> bool:
    """True when Application Default Credentials are present (keyless auth)."""
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        return True
    if os.name == "nt":
        adc_path = (
            Path(os.environ.get("APPDATA", ""))
            / "gcloud"
            / "application_default_credentials.json"
        )
    else:
        adc_path = (
            Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
        )
    return adc_path.is_file()


def is_configured() -> bool:
    """True when a bucket plus usable credentials (key, download URL, or ADC)."""
    if not settings.gcp_stt_bucket:
        return False
    if _key_file() is not None:
        return True
    if _download_url():
        return True
    return _adc_available()


def key_present() -> bool:
    """True when a service-account key file is already on disk."""
    return _key_file() is not None


def download_available() -> bool:
    """True when a company SA-key download URL is configured for this build."""
    return bool(_download_url())


def download_key() -> Path:
    """Fetch the company SA key to disk on demand and return its path.

    Used by the "Download credentials" popup. Raises ``SttNotConfiguredError``
    when no download URL is configured, or ``SttError`` when the download or
    validation fails.
    """
    existing = _key_file()
    if existing is not None:
        return existing
    if not _download_url():
        raise SttNotConfiguredError(
            "No transcription-key download source is configured for this build."
        )
    _ensure_key_downloaded()
    key = _key_file()
    if key is None:
        raise SttError("The transcription key could not be downloaded.")
    return key


def _load_credentials() -> tuple[object, str, str | None]:
    """Return (credentials, project_id, quota_project) — blocking.

    Prefers a service-account key file (explicit config or the bundled key);
    otherwise falls back to Application Default Credentials (e.g. `gcloud auth
    application-default login`), which is keyless and complies with the
    iam.disableServiceAccountKeyCreation org policy. User credentials need a
    quota project; service-account credentials do not.
    """
    key_file = _key_file()
    if key_file is not None:
        from google.oauth2 import service_account

        creds = service_account.Credentials.from_service_account_file(
            str(key_file), scopes=[_SCOPE]
        )
        with open(key_file, "r", encoding="utf-8") as fh:
            project_id = json.load(fh).get("project_id", "")
        return creds, project_id or settings.gcp_project_id, None

    import google.auth

    creds, project_id = google.auth.default(scopes=[_SCOPE])
    project = project_id or settings.gcp_project_id
    quota_project = getattr(creds, "quota_project_id", None) or project or None
    return creds, project, quota_project


def _refresh_token(creds: object) -> str:
    """Mint / refresh an OAuth2 access token (blocking)."""
    from google.auth.transport.requests import Request

    creds.refresh(Request())  # type: ignore[attr-defined]
    return creds.token  # type: ignore[attr-defined]


def _speech_endpoint(location: str) -> str:
    if location == "global":
        return "https://speech.googleapis.com"
    return f"https://{location}-speech.googleapis.com"


def _parse_transcript(response: dict, gcs_uri: str) -> str:
    """Extract and join the transcript from an inline batchRecognize response."""
    results = response.get("results", {})
    file_result = results.get(gcs_uri) or next(iter(results.values()), {})
    # Surface a per-file error (e.g. the Speech service agent can't read the
    # object) rather than silently reporting "no speech".
    if file_result.get("error"):
        raise SttError(file_result["error"].get("message", "transcription error"))
    # Inline output nests the transcript under "inlineResult"; fall back to the
    # top-level "transcript" for forward-compatibility.
    transcript_obj = (
        file_result.get("inlineResult", {}).get("transcript")
        or file_result.get("transcript", {})
    )
    pieces: list[str] = []
    for result in transcript_obj.get("results", []):
        alternatives = result.get("alternatives") or []
        if alternatives:
            text = alternatives[0].get("transcript", "").strip()
            if text:
                pieces.append(text)
    return " ".join(pieces).strip()


async def transcribe_long(
    audio: bytes,
    filename: str,
    mime_type: str | None = None,
) -> str:
    """Upload audio to GCS, run v2 batchRecognize, and return the transcript."""
    if not is_configured():
        raise SttNotConfiguredError(
            "Google STT v2 isn't configured. Set GCP_STT_BUCKET and provide "
            "credentials (a key file via GCP_SERVICE_ACCOUNT_FILE, or run "
            "`gcloud auth application-default login`)."
        )

    location = settings.gcp_stt_location or "us"
    model = settings.gcp_stt_model or "long"
    language = settings.gcp_stt_language or "en-US"
    bucket = settings.gcp_stt_bucket

    # Fetch the company key on first use if it isn't on disk yet.
    await asyncio.to_thread(_ensure_key_downloaded)
    creds, project_id, quota_project = await asyncio.to_thread(_load_credentials)
    if not project_id:
        raise SttError(
            "Couldn't determine the GCP project. Set GCP_PROJECT_ID or run "
            "`gcloud auth application-default set-quota-project <project>`."
        )
    token = await asyncio.to_thread(_refresh_token, creds)
    headers = {"Authorization": f"Bearer {token}"}
    if quota_project:
        headers["x-goog-user-project"] = quota_project

    safe_name = Path(filename or "recording").name
    object_name = f"stt-uploads/{uuid.uuid4().hex}-{safe_name}"
    encoded_object = quote(object_name, safe="")
    gcs_uri = f"gs://{bucket}/{object_name}"

    features: dict = {"enableAutomaticPunctuation": True}
    if settings.gcp_stt_diarize:
        features["diarizationConfig"] = {
            "minSpeakerCount": 1,
            "maxSpeakerCount": 6,
        }

    async with httpx.AsyncClient(timeout=120) as client:
        # 1. Upload the audio to GCS.
        upload = await client.post(
            f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o",
            params={"uploadType": "media", "name": object_name},
            headers={
                **headers,
                "Content-Type": mime_type or "application/octet-stream",
            },
            content=audio,
        )
        if upload.status_code not in (200, 201):
            raise SttError(
                f"GCS upload failed — HTTP {upload.status_code}: "
                f"{upload.text[:300]}"
            )

        try:
            # 2. Start the batchRecognize long-running operation. The implicit
            #    recognizer "_" applies the inline config below, so no recognizer
            #    needs to be pre-created.
            recognizer = (
                f"projects/{project_id}/locations/{location}/recognizers/_"
            )
            batch_url = (
                f"{_speech_endpoint(location)}/v2/{recognizer}:batchRecognize"
            )
            body = {
                "config": {
                    "autoDecodingConfig": {},
                    "model": model,
                    "languageCodes": [language],
                    "features": features,
                },
                "files": [{"uri": gcs_uri}],
                "recognitionOutputConfig": {"inlineResponseConfig": {}},
            }
            start = await client.post(batch_url, headers=headers, json=body)
            if start.status_code != 200:
                raise SttError(
                    f"batchRecognize failed to start — HTTP {start.status_code}: "
                    f"{start.text[:300]}"
                )
            operation_name = start.json().get("name")
            if not operation_name:
                raise SttError("batchRecognize returned no operation name.")

            # 3. Poll the operation until done.
            poll_url = f"{_speech_endpoint(location)}/v2/{operation_name}"
            for _ in range(_POLL_MAX_ATTEMPTS):
                await asyncio.sleep(_POLL_INTERVAL_SECONDS)
                poll = await client.get(poll_url, headers=headers)
                if poll.status_code != 200:
                    raise SttError(
                        f"Operation poll failed — HTTP {poll.status_code}: "
                        f"{poll.text[:300]}"
                    )
                data = poll.json()
                if not data.get("done"):
                    continue
                if "error" in data:
                    message = data["error"].get("message", "unknown error")
                    raise SttError(f"Transcription failed — {message}")
                transcript = _parse_transcript(data.get("response", {}), gcs_uri)
                if not transcript:
                    raise SttError("Transcription returned no speech.")
                return transcript

            raise SttError("Transcription timed out.")
        finally:
            # 4. Best-effort cleanup of the uploaded object.
            try:
                await client.delete(
                    f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/"
                    f"{encoded_object}",
                    headers=headers,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to delete temp STT object %s: %s", gcs_uri, exc)
