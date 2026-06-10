"""Thin async wrappers around the Google Cloud Speech REST APIs.

Endpoints used (v1, API-key auth):
  POST https://speech.googleapis.com/v1/speech:recognize        — STT (≤60 s audio)
  POST https://texttospeech.googleapis.com/v1/text:synthesize   — TTS
  GET  https://texttospeech.googleapis.com/v1/voices            — voice catalog
"""

from __future__ import annotations

import base64
import re

import httpx

from config import settings as app_settings

STT_URL = "https://speech.googleapis.com/v1/speech:recognize"
TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"
VOICES_URL = "https://texttospeech.googleapis.com/v1/voices"

DEFAULT_VOICE = "en-US-Neural2-C"
DEFAULT_LANGUAGE = "en-US"

# MediaRecorder in Chromium produces audio/webm (opus); map browser MIME types
# to the encodings Google STT expects. Opus-in-WebM is always 48 kHz.
_ENCODINGS: dict[str, tuple[str, int | None]] = {
    "audio/webm": ("WEBM_OPUS", 48000),
    "audio/ogg": ("OGG_OPUS", 48000),
    "audio/wav": ("LINEAR16", None),
    "audio/x-wav": ("LINEAR16", None),
    "audio/flac": ("FLAC", None),
}


class VoiceNotConfiguredError(Exception):
    """Raised when no Google Cloud API key is stored in the keyring."""


class VoiceApiError(Exception):
    """Raised when the Google Speech API returns an error response."""


def is_configured() -> bool:
    return app_settings.get_api_key("google") is not None


def _api_key() -> str:
    key = app_settings.get_api_key("google")
    if not key:
        raise VoiceNotConfiguredError(
            "No Google Cloud API key configured. Add one in Settings → Voice."
        )
    return key


def _raise_for_error(resp: httpx.Response) -> None:
    if resp.status_code == 200:
        return
    try:
        err = resp.json().get("error", {})
        detail = f"{err.get('status', resp.status_code)}: {err.get('message', 'unknown error')}"
    except Exception:
        detail = f"HTTP {resp.status_code}"
    raise VoiceApiError(f"Google Speech API error — {detail}")


def strip_markdown(text: str) -> str:
    """Remove markdown syntax so TTS doesn't read symbols aloud."""
    out = re.sub(r"```[\s\S]*?```", " (code omitted) ", text)  # fenced code
    out = re.sub(r"`([^`]*)`", r"\1", out)                      # inline code
    out = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", out)              # images
    out = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", out)          # links → label
    out = re.sub(r"^#{1,6}\s+", "", out, flags=re.MULTILINE)    # headings
    out = re.sub(r"(\*\*|__|\*|_|~~)", "", out)                 # emphasis
    out = re.sub(r"^\s*[-*+]\s+", "", out, flags=re.MULTILINE)  # bullets
    out = re.sub(r"^\s*\|.*\|\s*$", "", out, flags=re.MULTILINE)  # table rows
    return re.sub(r"\n{3,}", "\n\n", out).strip()


async def transcribe(
    audio: bytes,
    mime_type: str,
    language_code: str = DEFAULT_LANGUAGE,
) -> str:
    """Transcribe a short (≤60 s) audio clip to text."""
    base_mime = mime_type.split(";")[0].strip().lower()
    encoding, sample_rate = _ENCODINGS.get(base_mime, ("WEBM_OPUS", 48000))

    config: dict[str, object] = {
        "encoding": encoding,
        "languageCode": language_code,
        "enableAutomaticPunctuation": True,
        "model": "latest_short",
    }
    if sample_rate:
        config["sampleRateHertz"] = sample_rate

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            STT_URL,
            params={"key": _api_key()},
            json={"config": config, "audio": {"content": base64.b64encode(audio).decode()}},
        )
    _raise_for_error(resp)

    results = resp.json().get("results", [])
    parts = [
        r["alternatives"][0]["transcript"]
        for r in results
        if r.get("alternatives")
    ]
    return " ".join(p.strip() for p in parts).strip()


async def synthesize(
    text: str,
    voice_name: str = DEFAULT_VOICE,
    speaking_rate: float = 1.0,
) -> bytes:
    """Synthesize speech (MP3 bytes) from plain text."""
    language_code = "-".join(voice_name.split("-")[:2]) or DEFAULT_LANGUAGE
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            TTS_URL,
            params={"key": _api_key()},
            json={
                "input": {"text": text},
                "voice": {"languageCode": language_code, "name": voice_name},
                "audioConfig": {"audioEncoding": "MP3", "speakingRate": speaking_rate},
            },
        )
    _raise_for_error(resp)
    return base64.b64decode(resp.json()["audioContent"])


async def list_voices(language_code: str = DEFAULT_LANGUAGE) -> list[dict]:
    """Return available TTS voices for a language, premium tiers first."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            VOICES_URL,
            params={"key": _api_key(), "languageCode": language_code},
        )
    _raise_for_error(resp)

    def tier(name: str) -> int:
        for rank, marker in enumerate(("Studio", "Neural2", "Wavenet", "News", "Standard")):
            if marker in name:
                return rank
        return 9

    voices = [
        {
            "name": v["name"],
            "gender": v.get("ssmlGender", "NEUTRAL").lower(),
            "language_codes": v.get("languageCodes", []),
        }
        for v in resp.json().get("voices", [])
    ]
    voices.sort(key=lambda v: (tier(v["name"]), v["name"]))
    return voices
