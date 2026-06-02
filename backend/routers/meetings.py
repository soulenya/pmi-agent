"""Meeting Notes API — save transcripts, summarize, extract action items."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.meeting import MeetingNote
from models.db.task import Task
from models.db.user import User
from services.llm.router import get_llm_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/meetings", tags=["meetings"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class MeetingNoteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    raw_transcript: str = Field(..., min_length=10)
    meeting_date: datetime | None = None
    attendees: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class MeetingNoteOut(BaseModel):
    id: uuid.UUID
    title: str
    raw_transcript: str
    summary: str | None
    decisions: str | None
    action_items: str | None
    next_steps: str | None
    meeting_date: datetime | None
    attendees: list[str]
    tags: list[str]
    generated_task_ids: list[str]
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SummarizeRequest(BaseModel):
    create_tasks: bool = True  # auto-create Task rows from action items


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _llm_summarize(title: str, transcript: str) -> dict:
    """
    Call Ollama to produce structured meeting notes.
    Returns dict with keys: summary, decisions, action_items, next_steps.
    Falls back to plain text if LLM unavailable.
    """
    prompt = (
        "You are an executive assistant at Precisian Medical Instruments (PMI), a medical device startup.\n"
        f"Meeting title: {title}\n\n"
        f"Transcript / notes:\n{transcript[:6000]}\n\n"
        "Extract and structure the following sections. Use concise bullet points (- item):\n\n"
        "## SUMMARY\n"
        "(2-4 sentence overview of the meeting)\n\n"
        "## DECISIONS\n"
        "(bullet list of decisions made)\n\n"
        "## ACTION ITEMS\n"
        "(bullet list, each with assignee if mentioned, format: '- [Person] Action description')\n\n"
        "## NEXT STEPS\n"
        "(ordered list of what happens next)\n\n"
        "Output ONLY the four sections above with their ## headings."
    )
    try:
        client = await get_llm_client(db)
        chunk = await client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        text = chunk.content.strip()
        return _parse_sections(text)
    except Exception as exc:
        logger.warning("Meeting summarization LLM failed: %s", exc)
        return {
            "summary": f"Meeting notes saved: {title}",
            "decisions": None,
            "action_items": None,
            "next_steps": None,
        }


def _parse_sections(text: str) -> dict:
    """Parse ## headed sections from LLM output."""
    sections = {"summary": None, "decisions": None, "action_items": None, "next_steps": None}
    current: str | None = None
    buf: list[str] = []

    key_map = {
        "SUMMARY": "summary",
        "DECISIONS": "decisions",
        "ACTION ITEMS": "action_items",
        "NEXT STEPS": "next_steps",
    }

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            if current and buf:
                sections[current] = "\n".join(buf).strip() or None
                buf = []
            heading = stripped[3:].upper().strip()
            current = key_map.get(heading)
        elif current:
            buf.append(line)

    if current and buf:
        sections[current] = "\n".join(buf).strip() or None

    return sections


def _extract_action_lines(action_items_text: str | None) -> list[str]:
    """Return list of action item strings (strip leading '- ')."""
    if not action_items_text:
        return []
    lines = []
    for line in action_items_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            stripped = stripped[2:].strip()
        if stripped:
            lines.append(stripped)
    return lines


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[MeetingNoteOut])
async def list_meetings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MeetingNoteOut]:
    result = await db.execute(
        select(MeetingNote)
        .where(MeetingNote.created_by == current_user.id)
        .order_by(MeetingNote.created_at.desc())
        .limit(100)
    )
    return [MeetingNoteOut.model_validate(m) for m in result.scalars().all()]


@router.post("", response_model=MeetingNoteOut, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    body: MeetingNoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingNoteOut:
    meeting = MeetingNote(
        id=uuid.uuid4(),
        title=body.title,
        raw_transcript=body.raw_transcript,
        meeting_date=body.meeting_date,
        attendees=body.attendees,
        tags=body.tags,
        generated_task_ids=[],
        created_by=current_user.id,
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)
    return MeetingNoteOut.model_validate(meeting)


@router.get("/{meeting_id}", response_model=MeetingNoteOut)
async def get_meeting(
    meeting_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingNoteOut:
    result = await db.execute(
        select(MeetingNote).where(MeetingNote.id == meeting_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return MeetingNoteOut.model_validate(meeting)


@router.post("/{meeting_id}/summarize", response_model=MeetingNoteOut)
async def summarize_meeting(
    meeting_id: uuid.UUID,
    body: SummarizeRequest = SummarizeRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingNoteOut:
    result = await db.execute(
        select(MeetingNote).where(MeetingNote.id == meeting_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    # Run LLM summarization
    sections = await _llm_summarize(meeting.title, meeting.raw_transcript)
    meeting.summary = sections["summary"]
    meeting.decisions = sections["decisions"]
    meeting.action_items = sections["action_items"]
    meeting.next_steps = sections["next_steps"]

    task_ids: list[str] = []

    if body.create_tasks and sections["action_items"]:
        action_lines = _extract_action_lines(sections["action_items"])
        for line in action_lines[:10]:  # cap at 10 auto-tasks
            task = Task(
                id=uuid.uuid4(),
                title=line[:255],
                description=f"Auto-created from meeting: {meeting.title}",
                status="todo",
                priority="medium",
                created_by=current_user.id,
                assignee_id=current_user.id,
            )
            db.add(task)
            task_ids.append(str(task.id))

    meeting.generated_task_ids = task_ids
    await db.commit()
    await db.refresh(meeting)
    return MeetingNoteOut.model_validate(meeting)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    result = await db.execute(
        select(MeetingNote).where(MeetingNote.id == meeting_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.execute(delete(MeetingNote).where(MeetingNote.id == meeting_id))
    await db.commit()
