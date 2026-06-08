"""Email Drafts API — LLM-assisted email drafting with human-in-the-loop approval."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.approval import ApprovalIntent
from models.db.email_draft import EmailDraft
from models.db.enums import ApprovalStatus, IntentType, RiskLevel
from models.db.user import User
from services.llm.router import get_llm_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/emails", tags=["emails"])

VALID_TONES = {"professional", "friendly", "formal", "concise", "empathetic", "persuasive"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class EmailDraftCreate(BaseModel):
    subject: str = Field(..., min_length=1, max_length=500)
    recipient_name: str | None = None
    recipient_email: str | None = None
    purpose: str = Field(..., min_length=10, max_length=2000)
    tone: str = Field(default="professional")
    key_points: str | None = None
    tags: list[str] = Field(default_factory=list)


class EmailDraftOut(BaseModel):
    id: uuid.UUID
    subject: str
    recipient_name: str | None
    recipient_email: str | None
    purpose: str
    tone: str
    key_points: str | None
    draft_body: str | None
    status: str
    approval_intent_id: uuid.UUID | None
    is_archived: bool
    tags: list[str]
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EmailDraftUpdate(BaseModel):
    subject: str | None = None
    recipient_name: str | None = None
    recipient_email: str | None = None
    purpose: str | None = None
    tone: str | None = None
    key_points: str | None = None
    draft_body: str | None = None
    tags: list[str] | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _llm_draft_email(
    subject: str,
    recipient_name: str | None,
    purpose: str,
    tone: str,
    key_points: str | None,
    db: AsyncSession,
) -> str:
    """Call Ollama to write an email draft. Returns the draft body text."""
    recipient_line = f"Recipient: {recipient_name}" if recipient_name else "Recipient: (not specified)"
    points_section = f"\nKey points to include:\n{key_points}" if key_points else ""
    prompt = (
        "You are an executive assistant at Precisian Medical Instruments (PMI), a medical device startup.\n"
        f"Write a {tone} email with the following details:\n\n"
        f"Subject: {subject}\n"
        f"{recipient_line}\n"
        f"Purpose: {purpose}"
        f"{points_section}\n\n"
        "Write ONLY the email body (salutation through sign-off). "
        "Do not include a Subject line header. "
        "Sign off as 'PMI Team' unless a specific name is implied. "
        "Keep it concise and professional."
    )
    try:
        client = await get_llm_client(db)
        chunk = await client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
        return chunk.content.strip()
    except Exception as exc:
        logger.warning("Email drafting LLM failed: %s", exc)
        return (
            f"Dear {recipient_name or 'Recipient'},\n\n"
            f"{purpose}\n\n"
            "Best regards,\nPMI Team"
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[EmailDraftOut])
async def list_drafts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[EmailDraftOut]:
    result = await db.execute(
        select(EmailDraft)
        .where(EmailDraft.created_by == current_user.id, EmailDraft.is_archived == False)
        .order_by(EmailDraft.created_at.desc())
        .limit(100)
    )
    return [EmailDraftOut.model_validate(d) for d in result.scalars().all()]


@router.post("", response_model=EmailDraftOut, status_code=status.HTTP_201_CREATED)
async def create_and_draft(
    body: EmailDraftCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailDraftOut:
    """Create a draft record and immediately generate an LLM draft body."""
    if body.tone not in VALID_TONES:
        raise HTTPException(
            status_code=422,
            detail=f"tone must be one of: {', '.join(sorted(VALID_TONES))}",
        )
    # Generate draft via LLM
    draft_body = await _llm_draft_email(
        subject=body.subject,
        recipient_name=body.recipient_name,
        purpose=body.purpose,
        tone=body.tone,
        key_points=body.key_points,
        db=db,
    )
    draft = EmailDraft(
        id=uuid.uuid4(),
        subject=body.subject,
        recipient_name=body.recipient_name,
        recipient_email=body.recipient_email,
        purpose=body.purpose,
        tone=body.tone,
        key_points=body.key_points,
        draft_body=draft_body,
        status="draft",
        tags=body.tags,
        created_by=current_user.id,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return EmailDraftOut.model_validate(draft)


@router.get("/{draft_id}", response_model=EmailDraftOut)
async def get_draft(
    draft_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailDraftOut:
    result = await db.execute(select(EmailDraft).where(EmailDraft.id == draft_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return EmailDraftOut.model_validate(draft)


@router.put("/{draft_id}", response_model=EmailDraftOut)
async def update_draft(
    draft_id: uuid.UUID,
    body: EmailDraftUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailDraftOut:
    result = await db.execute(select(EmailDraft).where(EmailDraft.id == draft_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if draft.status not in ("draft",):
        raise HTTPException(status_code=409, detail="Cannot edit a draft that is pending approval")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(draft, field, value)
    await db.commit()
    await db.refresh(draft)
    return EmailDraftOut.model_validate(draft)


@router.post("/{draft_id}/regenerate", response_model=EmailDraftOut)
async def regenerate_draft(
    draft_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailDraftOut:
    """Re-run LLM to produce a new draft body for an existing record."""
    result = await db.execute(select(EmailDraft).where(EmailDraft.id == draft_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    draft.draft_body = await _llm_draft_email(
        subject=draft.subject,
        recipient_name=draft.recipient_name,
        purpose=draft.purpose,
        tone=draft.tone,
        key_points=draft.key_points,
        db=db,
    )
    draft.status = "draft"
    await db.commit()
    await db.refresh(draft)
    return EmailDraftOut.model_validate(draft)


@router.post("/{draft_id}/submit-for-approval", response_model=EmailDraftOut)
async def submit_for_approval(
    draft_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailDraftOut:
    """
    Human-in-the-loop gate: creates an ApprovalIntent; email is NEVER sent automatically.
    """
    result = await db.execute(select(EmailDraft).where(EmailDraft.id == draft_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not draft.draft_body:
        raise HTTPException(status_code=400, detail="Draft body is empty — generate it first")
    if draft.status == "pending_approval":
        raise HTTPException(status_code=409, detail="Already pending approval")

    intent = ApprovalIntent(
        id=uuid.uuid4(),
        user_id=current_user.id,
        intent_type=IntentType.SEND_EMAIL,
        intent_title=f"Send email: {draft.subject}",
        intent_description=(
            f"To: {draft.recipient_name or draft.recipient_email or 'Unknown'}\n"
            f"Purpose: {draft.purpose}"
        ),
        intent_payload={
            "draft_id": str(draft.id),
            "subject": draft.subject,
            "recipient_name": draft.recipient_name,
            "recipient_email": draft.recipient_email,
            "draft_body": draft.draft_body,
        },
        risk_level=RiskLevel.MEDIUM,
        status=ApprovalStatus.PENDING,
    )
    db.add(intent)
    await db.flush()

    draft.status = "pending_approval"
    draft.approval_intent_id = intent.id
    await db.commit()
    await db.refresh(draft)
    return EmailDraftOut.model_validate(draft)


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    draft_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    result = await db.execute(select(EmailDraft).where(EmailDraft.id == draft_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    draft.is_archived = True
    await db.commit()
