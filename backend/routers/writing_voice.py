"""Writing voice API — build, store and manage a user's personal voice profile.

The profile is what makes a Gerry-written email sound like the person sending it.
Each user has their own; nothing here is shared between accounts.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services import writing_voice

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/writing-voice", tags=["writing-voice"])


class WritingVoiceOut(BaseModel):
    profile: str | None
    use_for_documents: bool
    updated_at: datetime | None


class WritingVoiceUpdate(BaseModel):
    profile: str | None = Field(default=None, max_length=writing_voice.MAX_PROFILE_CHARS)
    use_for_documents: bool | None = None


class AnalyzeRequest(BaseModel):
    max_messages: int = Field(default=writing_voice.MAX_SENT_MESSAGES, ge=10, le=300)


class AnalyzeResult(BaseModel):
    profile: str
    messages_analyzed: int


def _out(user: User) -> WritingVoiceOut:
    return WritingVoiceOut(
        profile=user.writing_voice_profile,
        use_for_documents=user.writing_voice_for_documents,
        updated_at=user.writing_voice_updated_at,
    )


@router.get("", response_model=WritingVoiceOut)
async def get_writing_voice(user: User = Depends(get_current_user)) -> WritingVoiceOut:
    return _out(user)


@router.put("", response_model=WritingVoiceOut)
async def update_writing_voice(
    payload: WritingVoiceUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WritingVoiceOut:
    updated = await writing_voice.set_profile(
        db, user.id, payload.profile, for_documents=payload.use_for_documents
    )
    if updated is None:
        raise HTTPException(404, "User not found.")
    await db.commit()
    await db.refresh(updated)
    return _out(updated)


@router.post("/upload", response_model=WritingVoiceOut)
async def upload_writing_voice(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WritingVoiceOut:
    """Accept a markdown/text file written elsewhere as this user's profile."""
    name = (file.filename or "").lower()
    if not name.endswith((".md", ".markdown", ".txt")):
        raise HTTPException(400, "Upload a .md or .txt file.")
    raw = await file.read()
    if len(raw) > 512 * 1024:
        raise HTTPException(400, "That file is too large — profiles are a few pages at most.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "That file isn't plain text I can read.")
    if not text.strip():
        raise HTTPException(400, "That file is empty.")

    updated = await writing_voice.set_profile(db, user.id, text)
    if updated is None:
        raise HTTPException(404, "User not found.")
    await db.commit()
    await db.refresh(updated)
    return _out(updated)


@router.delete("", response_model=WritingVoiceOut)
async def delete_writing_voice(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WritingVoiceOut:
    updated = await writing_voice.set_profile(db, user.id, "", for_documents=False)
    if updated is None:
        raise HTTPException(404, "User not found.")
    await db.commit()
    await db.refresh(updated)
    return _out(updated)


@router.post("/analyze", response_model=AnalyzeResult)
async def analyze_writing_voice(
    payload: AnalyzeRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnalyzeResult:
    """Read the connected Google account's sent mail and write a voice profile.

    The result is saved to the signed-in user and also returned so it can be
    reviewed and edited before it starts shaping drafts.
    """
    from services import google_service as gs

    if not gs.get_credentials():
        raise HTTPException(
            400,
            "Connect your Google account in Settings first — I need your sent mail "
            "to describe how you write.",
        )
    limit = payload.max_messages if payload else writing_voice.MAX_SENT_MESSAGES
    try:
        profile, count = await writing_voice.analyze_sent_mail(db, max_messages=limit)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:  # noqa: BLE001 — surface the real reason to the user
        logger.exception("Writing voice analysis failed")
        raise HTTPException(502, f"Analysis failed: {exc}")

    await writing_voice.set_profile(db, user.id, profile)
    await db.commit()
    return AnalyzeResult(profile=profile, messages_analyzed=count)
