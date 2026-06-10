"""
Voice API — speech-to-text and text-to-speech via Google Cloud.

Exposes:
  GET  /voice/status      — whether voice is configured (Google key present)
  GET  /voice/voices      — available TTS voices (premium tiers first)
  POST /voice/transcribe  — audio clip → text (transcript is editable client-side)
  POST /voice/speak       — text → MP3 audio

Audio is proxied straight through to Google — never stored on disk or in the DB.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from routers.settings import _get_setting
from services.voice import google_speech

router = APIRouter(prefix="/voice", tags=["voice"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024  # ~60 s of opus is well under this
MAX_SPEAK_CHARS = 4500  # TTS v1 limit is 5000 bytes per request


def _voice_error(exc: Exception) -> HTTPException:
    if isinstance(exc, google_speech.VoiceNotConfiguredError):
        return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))


class VoiceStatusOut(BaseModel):
    enabled: bool


class VoiceOut(BaseModel):
    name: str
    gender: str
    language_codes: list[str]


class TranscriptOut(BaseModel):
    text: str


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)
    voice: str | None = Field(None, max_length=64)


@router.get("/status", response_model=VoiceStatusOut)
async def voice_status(_user: User = Depends(get_current_user)) -> VoiceStatusOut:
    return VoiceStatusOut(enabled=google_speech.is_configured())


@router.get("/voices", response_model=list[VoiceOut])
async def list_voices(_user: User = Depends(get_current_user)) -> list[VoiceOut]:
    try:
        voices = await google_speech.list_voices()
    except Exception as exc:  # noqa: BLE001
        raise _voice_error(exc) from exc
    return [VoiceOut(**v) for v in voices]


@router.post("/transcribe", response_model=TranscriptOut)
async def transcribe(
    file: UploadFile = File(...),
    _user: User = Depends(get_current_user),
) -> TranscriptOut:
    audio = await file.read()
    if not audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty audio upload.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Audio clip too large — keep recordings under a minute.",
        )
    try:
        text = await google_speech.transcribe(audio, file.content_type or "audio/webm")
    except Exception as exc:  # noqa: BLE001
        raise _voice_error(exc) from exc
    return TranscriptOut(text=text)


@router.post("/speak")
async def speak(
    body: SpeakRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Response:
    voice_name = body.voice or str(
        await _get_setting(db, "voice.voice_name") or google_speech.DEFAULT_VOICE
    )
    text = google_speech.strip_markdown(body.text)[:MAX_SPEAK_CHARS]
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to speak.")
    try:
        audio = await google_speech.synthesize(text, voice_name=voice_name)
    except Exception as exc:  # noqa: BLE001
        raise _voice_error(exc) from exc
    return Response(content=audio, media_type="audio/mpeg")
