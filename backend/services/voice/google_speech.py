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

# Chirp 3: HD — Google's newest low-latency conversational voices. Neural2 is
# kept as an automatic fallback in case a project doesn't have Chirp access.
DEFAULT_VOICE = "en-US-Chirp3-HD-Kore"
FALLBACK_VOICE = "en-US-Neural2-C"
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
    out = _EMOJI_RE.sub("", out)                                # emojis & pictographs
    return re.sub(r"\n{3,}", "\n\n", out).strip()


# Emoji / pictograph / symbol ranges the TTS engine would otherwise read aloud
# ("warning sign", "rocket", …). Includes variation selectors, ZWJ, and skin tones.
_EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"  # emoji & pictographs (incl. extended-A)
    "\U00002600-\U000027BF"  # misc symbols + dingbats (⚠ ✅ ✨ …)
    "\U00002B00-\U00002BFF"  # arrows & symbols (⬆ ⭐ …)
    "\U0001F1E6-\U0001F1FF"  # regional indicators (flags)
    "\U0000FE00-\U0000FE0F"  # variation selectors
    "\U0000200D"             # zero-width joiner
    "\U000020E3"             # combining keycap
    "\U00002190-\U000021FF"  # arrows (→ ⇒ …)
    "\U00002700-\U000027FF"  # more dingbats
    "]+",
)


async def transcribe(
    audio: bytes,
    mime_type: str,
    language_code: str = DEFAULT_LANGUAGE,
    phrases: list[str] | None = None,
) -> str:
    """Transcribe a short (≤60 s) audio clip to text.

    ``phrases`` are speech-adaptation hints (names, companies, jargon from
    the calendar/meeting prep) so entities like "In-Q-Tel" aren't mangled
    into phonetic lookalikes at the source.
    """
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
    if phrases:
        config["speechContexts"] = [{"phrases": phrases[:500], "boost": 15.0}]

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
    """Synthesize speech (MP3 bytes) from plain text.

    If the requested voice is unavailable (e.g. Chirp not enabled for the
    project), retries once with the reliable Neural2 fallback voice.
    """

    async def _request(voice: str) -> httpx.Response:
        language_code = "-".join(voice.split("-")[:2]) or DEFAULT_LANGUAGE
        async with httpx.AsyncClient(timeout=60) as client:
            return await client.post(
                TTS_URL,
                params={"key": _api_key()},
                json={
                    "input": {"text": text},
                    "voice": {"languageCode": language_code, "name": voice},
                    "audioConfig": {"audioEncoding": "MP3", "speakingRate": speaking_rate},
                },
            )

    resp = await _request(voice_name)
    if resp.status_code != 200 and voice_name != FALLBACK_VOICE:
        resp = await _request(FALLBACK_VOICE)
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
        for rank, marker in enumerate(
            ("Chirp3-HD", "Chirp-HD", "Studio", "Neural2", "Wavenet", "News", "Standard")
        ):
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
