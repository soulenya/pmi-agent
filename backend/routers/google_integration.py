"""
Google Workspace integration router.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services import email_contacts as ec
from services import google_service as gs
from services.embeddings.service import EmbeddingService, get_embedding_service_db

router = APIRouter(prefix="/api/google", tags=["google"])


# ── Auth status & OAuth flow ──────────────────────────────────────────────

@router.get("/status")
async def google_status(_user=Depends(get_current_user)):
    return gs.get_status()


@router.post("/auth/start")
async def google_auth_start(_user=Depends(get_current_user)):
    """
    Launches Google OAuth in the user's default browser.
    The backend waits for the callback (up to ~5 min) in a background thread.
    Poll GET /api/google/status until status == "connected".
    """
    gs.start_auth_flow()
    return {"status": "pending", "message": "Google sign-in window opened in your browser."}


@router.delete("/auth/revoke")
async def google_revoke(_user=Depends(get_current_user)):
    gs.revoke()
    return {"status": "disconnected"}


# ── Gmail ─────────────────────────────────────────────────────────────────

@router.get("/gmail/search")
async def gmail_search(q: str, max: int = 10, _user=Depends(get_current_user)):
    try:
        return {"messages": gs.gmail_search(q, max)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/gmail/inbox")
async def gmail_inbox(
    q: str = "in:inbox",
    max: int = 25,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """List inbox threads (summaries) for the Inbox view.

    Each thread is annotated with any learned tags for its sender (Phase 3 tag
    memory) so the chips appear automatically whenever the Inbox is opened.
    """
    try:
        threads = gs.gmail_list_threads(q, max)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    rules = await _get_tag_rules(db)
    for t in threads:
        t["tags"] = _resolve_tags(t.get("from", ""), rules)
    return {"threads": threads}


@router.get("/gmail/message/{message_id}")
async def gmail_message(message_id: str, _user=Depends(get_current_user)):
    try:
        return gs.gmail_get_message(message_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/gmail/thread/{thread_id}")
async def gmail_thread(thread_id: str, _user=Depends(get_current_user)):
    """Preview a Gmail thread (all messages + attachment metadata) before import."""
    try:
        return gs.gmail_get_thread(thread_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/gmail/message/{message_id}/attachment/{attachment_id}")
async def gmail_attachment(
    message_id: str,
    attachment_id: str,
    mime: str = "application/octet-stream",
    filename: str | None = None,
    _user=Depends(get_current_user),
):
    """Stream the raw bytes of a single Gmail attachment (for inline image
    preview and downloads in the Inbox reader)."""
    try:
        data = gs.gmail_get_attachment(message_id, attachment_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    # Sanitize header values to prevent response-header injection.
    safe_mime = mime.replace("\r", "").replace("\n", "")[:120] or "application/octet-stream"
    headers: dict[str, str] = {}
    if filename:
        safe_name = filename.replace("\r", "").replace("\n", "").replace('"', "")[:200]
        headers["Content-Disposition"] = f'inline; filename="{safe_name}"'
    return Response(content=data, media_type=safe_mime, headers=headers)


class AttachmentOpenRequest(BaseModel):
    filename: str | None = None
    mime_type: str | None = None


@router.post("/gmail/message/{message_id}/attachment/{attachment_id}/open-in-drive")
async def gmail_attachment_open_in_drive(
    message_id: str,
    attachment_id: str,
    req: AttachmentOpenRequest,
    _user=Depends(get_current_user),
):
    """Copy an email attachment into Google Drive and return a Workspace link.

    Office/text attachments (docx, xlsx, pptx, csv, txt, …) are converted into
    the matching native Google doc so they open in Google Docs/Sheets/Slides;
    other types open in the Drive viewer. Returns ``{id, name, url}``.
    """
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        data = gs.gmail_get_attachment(message_id, attachment_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    if not data:
        raise HTTPException(404, "Attachment is empty or unavailable.")
    try:
        result = gs.drive_import_attachment(
            data, (req.filename or "attachment").strip() or "attachment", req.mime_type
        )
    except Exception as exc:
        raise HTTPException(502, f"Could not open the attachment in Google Workspace: {exc}")
    if not result.get("url"):
        raise HTTPException(502, "Google Drive did not return an open link for the attachment.")
    return result


@router.post("/gmail/message/{message_id}/attachment/{attachment_id}/import-kb")
async def gmail_attachment_import_kb(
    message_id: str,
    attachment_id: str,
    req: AttachmentOpenRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
):
    """Import a single Gmail attachment into the Knowledge Base.

    Fetches the attachment bytes and ingests them as their own KB document in
    the dedicated "Email" category (kept out of the regulated document set),
    stamped with the source message/attachment id for traceability.
    """
    from services.documents.ingestion import DocumentIngestionService, DuplicateDocumentError
    from services.documents.email_import import EMAIL_CATEGORY_NAME
    from repositories.document_repo import DocumentCategoryRepository

    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        data = gs.gmail_get_attachment(message_id, attachment_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    if not data:
        raise HTTPException(404, "Attachment is empty or unavailable.")

    fname = (req.filename or "attachment").strip() or "attachment"
    cat = await DocumentCategoryRepository(db).get_or_create(EMAIL_CATEGORY_NAME)
    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    try:
        doc = await svc.ingest(
            filename=fname,
            raw_bytes=data,
            title=fname,
            category_id=cat.id,
            is_regulated=False,
            created_by_id=current_user.id,
        )
        doc.source_type = "email"
        # Gmail attachment IDs can exceed 300 chars; source_id is varchar(255).
        # The message id is the stable, traceable reference for the source email.
        doc.source_id = message_id
        doc.source_name = fname
    except DuplicateDocumentError:
        await db.rollback()
        return {"status": "skipped_duplicate", "filename": fname}
    except ValueError:
        await db.rollback()
        raise HTTPException(
            415, f"\u201c{fname}\u201d is not a supported file type for the Knowledge Base."
        )
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(500, f"Could not add the attachment to the Knowledge Base: {exc}")

    await db.commit()
    return {"status": "imported", "filename": fname, "id": str(doc.id)}


class GmailThreadImportRequest(BaseModel):
    thread_id: str
    title: str | None = None
    category_id: str | None = None
    is_regulated: bool = False
    include_attachments: bool = True
    force: bool = False


@router.post("/gmail/thread/import")
async def gmail_thread_import(
    req: GmailThreadImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
):
    """Ingest a Gmail thread (and optionally its attachments) into the Knowledge Base.

    Email-derived content defaults to a dedicated "Email" category so it stays
    out of the regulated document set.
    """
    from services.documents.ingestion import DuplicateDocumentError
    from services.documents.email_import import import_gmail_thread, EMAIL_CATEGORY_NAME
    from repositories.document_repo import DocumentCategoryRepository
    from uuid import UUID as _UUID

    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")

    if req.category_id:
        cat_id = _UUID(req.category_id)
    else:
        cat = await DocumentCategoryRepository(db).get_or_create(EMAIL_CATEGORY_NAME)
        cat_id = cat.id

    try:
        result = await import_gmail_thread(
            db=db,
            embedding_svc=embedding_svc,
            thread_id=req.thread_id,
            title=req.title,
            category_id=cat_id,
            is_regulated=req.is_regulated,
            created_by_id=current_user.id,
            include_attachments=req.include_attachments,
            force=req.force,
        )
    except DuplicateDocumentError as exc:
        existing = exc.existing
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_document",
                "message": (
                    f"This email is already in the Knowledge Base as \u201c{existing.title}\u201d. "
                    f"Import again only if you intend to keep a copy."
                ),
                "existing": {
                    "id": str(existing.id),
                    "title": existing.title,
                    "created_at": existing.created_at.isoformat() if existing.created_at else None,
                },
            },
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Email import failed: {exc}")

    await db.commit()
    doc = result["document"]
    return {
        "id": str(doc.id),
        "title": doc.title,
        "status": doc.status,
        "thread_id": req.thread_id,
        "category_id": str(cat_id),
        "attachments": result["attachments"],
    }


# ── Gmail compose / reply ─────────────────────────────────────────────────

SIG_MODE_KEY = "email.signature_mode"      # "gmail" | "custom" | "none"
SIG_CUSTOM_KEY = "email.signature_custom"  # plain-text signature


async def _get_setting_value(db: AsyncSession, key: str, default):
    from models.db.settings import SystemSetting

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return row.value if row is not None and row.value is not None else default


async def _set_setting_value(db: AsyncSession, key: str, value, user_id) -> None:
    from models.db.settings import SystemSetting

    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        db.add(SystemSetting(key=key, value=value, updated_by=user_id))
    else:
        row.value = value
        row.updated_by = user_id
    await db.flush()


# Shared with the Email Drafts generator and the agent's create_email_draft
# tool so every Gerry draft carries the same configured signature.
from services.email_signature import (  # noqa: E402
    html_to_text as _html_to_text,
    resolve_signature as _resolve_signature,
)


class SignatureUpdate(BaseModel):
    mode: str  # gmail | custom | none
    custom: str | None = None


@router.get("/gmail/signature")
async def get_gmail_signature(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Return the configured signature mode + custom text + the live Gmail signature."""
    mode = str(await _get_setting_value(db, SIG_MODE_KEY, "none"))
    custom = str(await _get_setting_value(db, SIG_CUSTOM_KEY, "") or "")
    gmail_sig = ""
    if gs.get_credentials():
        try:
            gmail_sig = _html_to_text(gs.gmail_get_signature())
        except Exception:
            gmail_sig = ""
    return {"mode": mode, "custom": custom, "gmail": gmail_sig}


@router.put("/gmail/signature")
async def set_gmail_signature(
    req: SignatureUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save the signature preference (which signature Gerry appends to drafts)."""
    if req.mode not in ("gmail", "custom", "none"):
        raise HTTPException(422, "mode must be 'gmail', 'custom', or 'none'.")
    await _set_setting_value(db, SIG_MODE_KEY, req.mode, current_user.id)
    if req.custom is not None:
        await _set_setting_value(db, SIG_CUSTOM_KEY, req.custom, current_user.id)
    await db.commit()
    return {"mode": req.mode, "custom": req.custom or ""}


def _extract_email(addr: str) -> str:
    """Pull the bare email address out of a 'Name <email>' header value."""
    import re

    m = re.search(r"<([^>]+)>", addr or "")
    return (m.group(1) if m else (addr or "")).strip()


def _reply_subject(subject: str) -> str:
    s = (subject or "").strip()
    return s if s.lower().startswith("re:") else f"Re: {s}" if s else "Re:"


class GmailSendRequest(BaseModel):
    to: str
    cc: str | None = None
    subject: str
    body: str
    thread_id: str | None = None
    reply_to_message_id: str | None = None


@router.post("/gmail/send")
async def gmail_send_endpoint(req: GmailSendRequest, _user=Depends(get_current_user)):
    """Send a user-written email directly (no approval gate).

    Per the locked approval rules, emails the user writes themselves send
    freely; only Gerry-authored drafts route through Approvals.
    """
    if not req.to.strip() or not req.subject.strip():
        raise HTTPException(422, "Recipient and subject are required.")
    try:
        return gs.gmail_send(
            to=req.to,
            subject=req.subject,
            body=req.body,
            thread_id=req.thread_id,
            reply_to_message_id=req.reply_to_message_id,
            cc=(req.cc or "").strip() or None,
        )
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.post("/gmail/send-compose")
async def gmail_send_compose(
    to: str = Form(...),
    subject: str = Form(...),
    body: str = Form(""),
    cc: str = Form(""),
    bcc: str = Form(""),
    files: list[UploadFile] = File(default=[]),  # noqa: B008
    _user=Depends(get_current_user),
):
    """Send a brand-new user-written email (optional Cc/Bcc + attachments).

    User-written mail sends directly with no approval gate, per the locked
    rules; only Gerry-authored drafts route through Approvals.
    """
    if not to.strip() or not subject.strip():
        raise HTTPException(422, "Recipient and subject are required.")
    attachments: list[dict] = []
    for f in files or []:
        data = await f.read()
        if not data:
            continue
        attachments.append({
            "filename": f.filename or "attachment",
            "mime_type": f.content_type or "application/octet-stream",
            "data": data,
        })
    try:
        return gs.gmail_send(
            to=to,
            subject=subject,
            body=body,
            cc=cc.strip() or None,
            bcc=bcc.strip() or None,
            attachments=attachments,
        )
    except RuntimeError as e:
        raise HTTPException(401, str(e))


class GmailDraftReplyRequest(BaseModel):
    thread_id: str
    message_id: str | None = None
    instruction: str | None = None
    cc: str | None = None


class GmailDraftSelectedRequest(BaseModel):
    thread_ids: list[str] = []


async def _llm_draft_reply(
    *, thread: dict, instruction: str | None, db: AsyncSession, signature: str = ""
) -> str:
    """Ask the LLM to draft a reply to a Gmail thread. Returns the body text."""
    from services.llm.router import get_llm_client

    messages = thread.get("messages", [])
    transcript_parts = []
    for m in messages[-6:]:  # last few messages for context
        transcript_parts.append(
            f"From: {m.get('from', '')}\nDate: {m.get('date', '')}\n{m.get('body', '')}"
        )
    transcript = "\n\n---\n\n".join(transcript_parts)
    guidance = f"\n\nThe user's instruction for this reply: {instruction}" if instruction else ""
    if signature:
        closing = (
            "End with a brief closing line such as 'Best regards,'. Do NOT add a name "
            "or signature block after it — a signature is appended automatically."
        )
    else:
        closing = "Sign off as 'PMI Team' unless a specific name is implied."
    prompt = (
        "You are an executive assistant at Precisian Medical Instruments (PMI), a "
        "medical device startup. Draft a reply to the most recent message in the "
        "email thread below. Write a professional, concise reply.\n\n"
        f"EMAIL THREAD (oldest to newest):\n{transcript}{guidance}\n\n"
        f"Write ONLY the reply body (salutation through closing). Do not include a "
        f"Subject line. {closing}"
    )
    try:
        client = await get_llm_client(db, task="emails")
        chunk = await client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
        return chunk.content.strip()
    except Exception as exc:
        raise HTTPException(502, f"Drafting failed: {exc}")


async def _llm_draft_compose(
    *,
    recipient: str,
    instruction: str,
    key_points: str | None,
    tone: str,
    subject: str | None,
    db: AsyncSession,
    signature: str = "",
) -> dict:
    """Ask the LLM to write a NEW email. Returns ``{subject, body}``."""
    import json
    import re as _re

    from services.llm.router import get_llm_client

    kp = f"\nKey points to cover:\n{key_points}" if key_points else ""
    subj_line = (
        f"Use exactly this subject line: {subject}"
        if subject
        else "Also propose a concise, specific Subject line."
    )
    if signature:
        closing = (
            "End with a brief closing line such as 'Best regards,'. Do NOT add a name "
            "or signature block after it — a signature is appended automatically."
        )
    else:
        closing = "Sign off as 'PMI Team' unless a specific name is implied."
    prompt = (
        "You are an executive assistant at Precisian Medical Instruments (PMI), a "
        f"medical device startup. Write a new {tone} email.\n\n"
        f"Recipient: {recipient}\nWhat the email needs to say: {instruction}{kp}\n\n"
        f"{subj_line}\n"
        'Return ONLY a JSON object: {"subject": "...", "body": "..."} where "body" '
        "is the complete email (salutation through closing) and contains no Subject "
        f"line. {closing}"
    )
    try:
        client = await get_llm_client(db, task="emails")
        chunk = await client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
    except Exception as exc:
        raise HTTPException(502, f"Drafting failed: {exc}")

    text = (chunk.content or "").strip()
    subj_out = (subject or "").strip()
    body_out = text
    m = _re.search(r"\{.*\}", text, _re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict):
                if not subj_out:
                    subj_out = str(data.get("subject") or "").strip()
                body_out = str(data.get("body") or "").strip() or body_out
        except Exception:
            pass
    return {"subject": subj_out or "(no subject)", "body": body_out}


async def _build_gerry_reply(
    *,
    thread: dict,
    instruction: str | None,
    db: AsyncSession,
    user: User,
    reply_to_message_id: str | None = None,
    cc: str | None = None,
) -> dict:
    """Draft a Gerry reply for a thread and persist an EmailDraft + ApprovalIntent.

    Flush-only — the caller is responsible for committing. Returns a summary
    dict. Raises ``ValueError`` if the thread has no messages.
    """
    from models.db.email_draft import EmailDraft
    from models.db.enums import IntentType, RiskLevel
    from repositories.conversation_repo import ApprovalRepository as _ApprovalRepo

    messages = thread.get("messages", [])
    if not messages:
        raise ValueError("Thread has no messages.")
    last = messages[-1]
    recipient_email = _extract_email(last.get("from", ""))
    recipient_name = (last.get("from", "").split("<")[0]).strip().strip('"') or recipient_email
    subject = _reply_subject(thread.get("subject", ""))
    thread_id = thread.get("thread_id", "")
    reply_target = reply_to_message_id or last.get("id")

    signature = await _resolve_signature(db)
    draft_body = await _llm_draft_reply(
        thread=thread, instruction=instruction, db=db, signature=signature
    )
    if signature:
        draft_body = f"{draft_body}\n\n{signature}"

    draft = EmailDraft(
        id=uuid.uuid4(),
        subject=subject,
        recipient_name=recipient_name,
        recipient_email=recipient_email,
        purpose=f"Reply to thread: {thread.get('subject', '')}",
        tone="professional",
        key_points=instruction,
        draft_body=draft_body,
        status="pending_approval",
        tags=["gerry-reply"],
        created_by=user.id,
    )
    db.add(draft)
    await db.flush()

    intent = await _ApprovalRepo(db).create(
        user_id=user.id,
        intent_type=IntentType.SEND_EMAIL,
        intent_title=f"Send reply: {subject}",
        intent_description=f"To: {recipient_name or recipient_email}",
        intent_payload={
            "draft_id": str(draft.id),
            "to": recipient_email,
            "cc": cc or "",
            "recipient_name": recipient_name,
            "recipient_email": recipient_email,
            "subject": subject,
            "draft_body": draft_body,
            "thread_id": thread_id,
            "reply_to_message_id": reply_target,
        },
        risk_level=RiskLevel.MEDIUM,
    )
    draft.approval_intent_id = intent.id

    return {
        "draft_id": str(draft.id),
        "approval_intent_id": str(intent.id),
        "to": recipient_email,
        "subject": subject,
        "draft_body": draft_body,
        "status": "pending_approval",
    }


async def _build_gerry_compose(
    *,
    to: str,
    cc: str | None,
    bcc: str | None,
    subject: str | None,
    instruction: str,
    key_points: str | None,
    tone: str,
    db: AsyncSession,
    user: User,
) -> dict:
    """Draft a NEW Gerry email → EmailDraft + ApprovalIntent (never auto-sent).

    Flush-only — the caller commits. Mirrors ``_build_gerry_reply`` but for a
    fresh (non-reply) email composed from an instruction + key points.
    """
    from models.db.email_draft import EmailDraft
    from models.db.enums import IntentType, RiskLevel
    from repositories.conversation_repo import ApprovalRepository as _ApprovalRepo

    recipient_email = _extract_email(to)
    recipient_name = (to.split("<")[0]).strip().strip('"') or recipient_email

    signature = await _resolve_signature(db)
    composed = await _llm_draft_compose(
        recipient=to,
        instruction=instruction,
        key_points=key_points,
        tone=tone,
        subject=subject,
        db=db,
        signature=signature,
    )
    subject_final = composed["subject"]
    draft_body = composed["body"]
    if signature:
        draft_body = f"{draft_body}\n\n{signature}"

    draft = EmailDraft(
        id=uuid.uuid4(),
        subject=subject_final,
        recipient_name=recipient_name,
        recipient_email=recipient_email,
        purpose=f"New email: {instruction[:200]}",
        tone=tone,
        key_points=key_points,
        draft_body=draft_body,
        status="pending_approval",
        tags=["gerry-compose"],
        created_by=user.id,
    )
    db.add(draft)
    await db.flush()

    payload: dict = {
        "draft_id": str(draft.id),
        "to": recipient_email,
        "recipient_name": recipient_name,
        "recipient_email": recipient_email,
        "subject": subject_final,
        "draft_body": draft_body,
    }
    if cc:
        payload["cc"] = cc
    if bcc:
        payload["bcc"] = bcc

    intent = await _ApprovalRepo(db).create(
        user_id=user.id,
        intent_type=IntentType.SEND_EMAIL,
        intent_title=f"Send email: {subject_final}",
        intent_description=f"To: {recipient_name or recipient_email}",
        intent_payload=payload,
        risk_level=RiskLevel.MEDIUM,
    )
    draft.approval_intent_id = intent.id

    return {
        "draft_id": str(draft.id),
        "approval_intent_id": str(intent.id),
        "to": recipient_email,
        "subject": subject_final,
        "draft_body": draft_body,
        "status": "pending_approval",
    }


@router.post("/gmail/draft-reply")
async def gmail_draft_reply(
    req: GmailDraftReplyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Let Gerry draft a reply to a thread → routes to Approvals (never auto-sent).

    Creates an EmailDraft (status ``pending_approval``) plus an ApprovalIntent so
    the user reviews/edits/approves it on the Approvals page before it is sent.
    """
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")

    try:
        thread = gs.gmail_get_thread(req.thread_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))

    try:
        result = await _build_gerry_reply(
            thread=thread,
            instruction=req.instruction,
            db=db,
            user=current_user,
            reply_to_message_id=req.message_id,
            cc=(req.cc or "").strip() or None,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    await db.commit()
    return result


@router.post("/gmail/draft-selected")
async def gmail_draft_selected(
    req: GmailDraftSelectedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Let Gerry draft a reply to each user-selected thread.

    The user ticks the threads they want (from any list — inbox, unread, today,
    or a tag view) and Gerry drafts a reply for each. Every draft routes to
    Approvals individually (no auto-send, no "approve all"). Because the user
    chose these threads explicitly, automated-sender skipping is NOT applied.
    Returns a per-thread summary of drafted vs. skipped threads.
    """
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")

    thread_ids = [tid for tid in dict.fromkeys(req.thread_ids) if tid][:25]
    if not thread_ids:
        raise HTTPException(422, "Select at least one email to draft a reply for.")

    drafted: list[dict] = []
    skipped: list[dict] = []
    for tid in thread_ids:
        try:
            full = gs.gmail_get_thread(tid)
            async with db.begin_nested():
                res = await _build_gerry_reply(
                    thread=full, instruction=None, db=db, user=current_user,
                )
            drafted.append({
                "thread_id": tid,
                "subject": res["subject"],
                "to": res["to"],
                "draft_id": res["draft_id"],
            })
        except Exception as exc:
            skipped.append({
                "thread_id": tid,
                "subject": "",
                "error": str(exc),
            })

    await db.commit()
    return {"count": len(drafted), "drafted": drafted, "skipped": skipped}


@router.post("/gmail/thread/{thread_id}/trash")
async def gmail_thread_trash(thread_id: str, _user=Depends(get_current_user)):
    """Move a thread to the Gmail Trash (recoverable for 30 days).

    Requires the ``gmail.modify`` scope — if the account was connected before
    that scope was added, the user must reconnect Google to grant it.
    """
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        return gs.gmail_trash_thread(thread_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as exc:
        msg = str(exc).lower()
        if "insufficient" in msg or "scope" in msg or "permission" in msg or "403" in msg:
            raise HTTPException(
                403,
                "Deleting emails needs an extra Google permission. Please reconnect "
                "your Google account (Google Workspace → reconnect) to grant it.",
            )
        raise HTTPException(502, f"Could not move the email to Trash: {exc}")


class GmailComposeDraftRequest(BaseModel):
    to: str
    instruction: str
    key_points: str | None = None
    tone: str = "professional"
    subject: str | None = None
    cc: str | None = None
    bcc: str | None = None


@router.post("/gmail/compose-draft")
async def gmail_compose_draft(
    req: GmailComposeDraftRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Let Gerry compose a brand-new email → routes to Approvals (never auto-sent).

    Creates an EmailDraft (status ``pending_approval``) plus an ApprovalIntent so
    the user reviews/edits/approves it on the Approvals page before it is sent.
    """
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    if not req.to.strip():
        raise HTTPException(422, "A recipient is required.")
    if not req.instruction.strip():
        raise HTTPException(422, "Tell Gerry what the email should say.")
    result = await _build_gerry_compose(
        to=req.to,
        cc=(req.cc or "").strip() or None,
        bcc=(req.bcc or "").strip() or None,
        subject=(req.subject or "").strip() or None,
        instruction=req.instruction,
        key_points=req.key_points,
        tone=req.tone,
        db=db,
        user=current_user,
    )
    await db.commit()
    return result


# ── Gmail tag memory (Phase 3) ────────────────────────────────────────────

TAG_RULES_KEY = "email.tag_rules"  # {"by_email": {...}, "by_domain": {...}}
_MAX_TAG_LEN = 40
_MAX_TAGS = 12


def _domain_of(email: str) -> str:
    """Return the lowercase domain part of an email address ('' if none)."""
    email = (email or "").strip().lower()
    return email.rsplit("@", 1)[-1] if "@" in email else ""


def _clean_tags(tags) -> list[str]:
    """Trim, de-duplicate (case-insensitively) and cap a list of tags."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in tags or []:
        tag = str(raw).strip()[:_MAX_TAG_LEN]
        key = tag.lower()
        if tag and key not in seen:
            seen.add(key)
            out.append(tag)
        if len(out) >= _MAX_TAGS:
            break
    return out


async def _get_tag_rules(db: AsyncSession) -> dict:
    """Load the learned tag rules ({by_email, by_domain}) from settings."""
    raw = await _get_setting_value(db, TAG_RULES_KEY, {}) or {}
    raw = raw if isinstance(raw, dict) else {}
    by_email = raw.get("by_email", {})
    by_domain = raw.get("by_domain", {})
    return {
        "by_email": by_email if isinstance(by_email, dict) else {},
        "by_domain": by_domain if isinstance(by_domain, dict) else {},
    }


def _resolve_tags(from_header: str, rules: dict) -> list[str]:
    """Union of the learned tags for a sender's email and its domain."""
    email = _extract_email(from_header).lower()
    domain = _domain_of(email)
    tags: list[str] = []
    tags.extend(rules.get("by_domain", {}).get(domain, []) or [])
    tags.extend(rules.get("by_email", {}).get(email, []) or [])
    return _clean_tags(tags)


def _parse_tag_list(text: str) -> list[str]:
    """Parse an LLM response into a list of tags (JSON array preferred)."""
    import json
    import re

    text = (text or "").strip()
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, list):
                return _clean_tags([str(x) for x in data])
        except Exception:
            pass
    raw = re.split(r"[\n,]+", text)
    return _clean_tags([r.strip("-•* \t").strip() for r in raw])


async def _llm_suggest_tags(*, thread: dict, db: AsyncSession) -> list[str]:
    """Ask the LLM to propose filing tags for an email thread."""
    from services.llm.router import get_llm_client

    messages = thread.get("messages", [])
    subject = thread.get("subject", "")
    parts = []
    for m in messages[-4:]:
        body = (m.get("body") or "")[:1500]
        parts.append(f"From: {m.get('from', '')}\n{body}")
    transcript = "\n\n---\n\n".join(parts)
    prompt = (
        "You organize the email of Precisian Medical Instruments (PMI), a "
        "medical device startup. Suggest 3 to 6 short topic/category tags for "
        "filing the email thread below. Each tag is 1-2 words, lowercase, no "
        "punctuation (e.g. 'supplier', 'regulatory', 'purchase order', "
        "'support', 'invoice'). Return ONLY a JSON array of strings.\n\n"
        f"SUBJECT: {subject}\n\nTHREAD (oldest to newest):\n{transcript}"
    )
    try:
        client = await get_llm_client(db, task="emails")
        chunk = await client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        return _parse_tag_list(chunk.content)
    except Exception as exc:
        raise HTTPException(502, f"Tag suggestion failed: {exc}")


def _thread_sender(thread: dict) -> tuple[str, str]:
    """Return (sender_email, domain) derived from a thread's latest message."""
    msgs = thread.get("messages", [])
    if not msgs:
        raise HTTPException(404, "Thread has no messages.")
    sender = _extract_email(msgs[-1].get("from", "")).lower()
    return sender, _domain_of(sender)


@router.get("/gmail/thread/{thread_id}/tags")
async def get_thread_tags(
    thread_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Return the learned tags for this thread's sender (contact + domain)."""
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        thread = gs.gmail_get_thread(thread_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    sender, domain = _thread_sender(thread)
    rules = await _get_tag_rules(db)
    return {
        "sender": sender,
        "domain": domain,
        "contact_tags": _clean_tags(rules["by_email"].get(sender, [])),
        "domain_tags": _clean_tags(rules["by_domain"].get(domain, [])),
    }


@router.post("/gmail/thread/{thread_id}/tags/suggest")
async def suggest_thread_tags(
    thread_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Let Gerry propose filing tags for a thread (excludes already-learned)."""
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        thread = gs.gmail_get_thread(thread_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    msgs = thread.get("messages", [])
    if not msgs:
        raise HTTPException(404, "Thread has no messages.")
    rules = await _get_tag_rules(db)
    known = {t.lower() for t in _resolve_tags(msgs[-1].get("from", ""), rules)}
    suggested = [
        t for t in await _llm_suggest_tags(thread=thread, db=db)
        if t.lower() not in known
    ]
    return {"suggested": suggested}


class ThreadTagsUpdate(BaseModel):
    scope: str  # "contact" | "domain"
    tags: list[str] = []


@router.put("/gmail/thread/{thread_id}/tags")
async def set_thread_tags(
    thread_id: str,
    req: ThreadTagsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remember the user-confirmed tags for this sender's email or domain.

    Saved associations are auto-applied to future inbox threads from the same
    contact (scope ``contact``) or anyone at the same domain (scope ``domain``).
    Passing an empty tag list clears the rule for that key.
    """
    if req.scope not in ("contact", "domain"):
        raise HTTPException(422, "scope must be 'contact' or 'domain'.")
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        thread = gs.gmail_get_thread(thread_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    sender, domain = _thread_sender(thread)
    tags = _clean_tags(req.tags)

    rules = await _get_tag_rules(db)
    bucket = "by_email" if req.scope == "contact" else "by_domain"
    key = sender if req.scope == "contact" else domain
    if not key:
        raise HTTPException(422, "Could not determine the sender for this thread.")
    if tags:
        rules[bucket][key] = tags
    else:
        rules[bucket].pop(key, None)
    await _set_setting_value(db, TAG_RULES_KEY, rules, current_user.id)
    await db.commit()
    last_from = thread["messages"][-1].get("from", "")
    return {
        "sender": sender,
        "domain": domain,
        "contact_tags": _clean_tags(rules["by_email"].get(sender, [])),
        "domain_tags": _clean_tags(rules["by_domain"].get(domain, [])),
        "resolved": _resolve_tags(last_from, rules),
    }


@router.get("/gmail/tags")
async def list_email_tags(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """List every learned tag with how many senders/domains carry it.

    Powers the Inbox "Tag" filter — each tag becomes a saved list of the emails
    from every contact/domain the user has filed under it.
    """
    rules = await _get_tag_rules(db)
    labels: dict[str, str] = {}
    counts: dict[str, int] = {}
    for tags in list(rules["by_email"].values()) + list(rules["by_domain"].values()):
        for tag in _clean_tags(tags):
            key = tag.lower()
            labels.setdefault(key, tag)
            counts[key] = counts.get(key, 0) + 1
    out = [
        {"tag": labels[k], "count": counts[k]}
        for k in sorted(labels, key=lambda x: x)
    ]
    return {"tags": out}


@router.get("/gmail/by-tag")
async def gmail_by_tag(
    tag: str,
    max: int = 25,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """List inbox threads filed under a given tag (by learned sender/domain).

    Resolves the tag to every contact email and domain the user has tagged with
    it, then returns the matching inbox threads (annotated with their tags, like
    the normal Inbox view).
    """
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    key = (tag or "").strip().lower()
    if not key:
        raise HTTPException(422, "A tag is required.")
    rules = await _get_tag_rules(db)
    emails = [
        e for e, tags in rules["by_email"].items()
        if any(str(t).lower() == key for t in (tags or []))
    ]
    domains = [
        d for d, tags in rules["by_domain"].items()
        if any(str(t).lower() == key for t in (tags or []))
    ]
    if not emails and not domains:
        return {"threads": [], "tag": tag}
    parts = [f"from:{addr}" for addr in emails] + [f"from:{dom}" for dom in domains]
    query = "in:inbox (" + " OR ".join(parts) + ")"
    try:
        threads = gs.gmail_list_threads(query, max)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    for t in threads:
        t["tags"] = _resolve_tags(t.get("from", ""), rules)
    return {"threads": threads, "tag": tag}


# ── Drive ─────────────────────────────────────────────────────────────────

@router.get("/drive/search")
async def drive_search(q: str, max: int = 10, _user=Depends(get_current_user)):
    try:
        return {"files": gs.drive_search(q, max)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/drive/file/{file_id}")
async def drive_file(file_id: str, _user=Depends(get_current_user)):
    try:
        return gs.drive_get_content(file_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/drive/shared-drives")
async def drive_shared_drives(_user=Depends(get_current_user)):
    try:
        return {"drives": gs.drive_list_shared_drives()}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/drive/list")
async def drive_list(folder_id: str = "root", drive_id: str | None = None, _user=Depends(get_current_user)):
    try:
        return {"items": gs.drive_list_folder(folder_id, drive_id=drive_id)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.post("/drive/upload")
async def drive_upload(
    file: UploadFile = File(...),
    folder_id: str | None = Form(None),
    _user=Depends(get_current_user),
):
    """Upload a file into the user's Google Drive (My Drive root or a chosen folder)."""
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(413, "File exceeds the 50 MB upload limit")
    try:
        return gs.drive_upload_bytes(
            data,
            file.filename or "file",
            file.content_type,
            folder_id or None,
        )
    except RuntimeError as e:
        raise HTTPException(401, str(e))


class DriveImportRequest(BaseModel):
    file_id: str
    title: str
    category_id: str | None = None
    is_regulated: bool = False
    force: bool = False


@router.post("/drive/import")
async def drive_import(
    req: DriveImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
):
    """Fetch a Google Drive file and ingest it into the Knowledge Base."""
    from services.documents.ingestion import DuplicateDocumentError
    from services.documents.drive_import import import_drive_file
    from uuid import UUID as _UUID

    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")

    cat_id = _UUID(req.category_id) if req.category_id else None
    try:
        doc = await import_drive_file(
            db=db,
            embedding_svc=embedding_svc,
            file_id=req.file_id,
            title=req.title,
            category_id=cat_id,
            is_regulated=req.is_regulated,
            created_by_id=current_user.id,
            force=req.force,
        )
    except DuplicateDocumentError as exc:
        existing = exc.existing
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_document",
                "message": (
                    f"This file is already in the Knowledge Base as \u201c{existing.title}\u201d. "
                    f"Import again only if you intend to keep a copy."
                ),
                "existing": {
                    "id": str(existing.id),
                    "title": existing.title,
                    "file_name": existing.file_name,
                    "created_at": existing.created_at.isoformat() if existing.created_at else None,
                },
            },
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Ingestion failed: {exc}")

    await db.commit()
    return {
        "id": str(doc.id), "title": doc.title, "filename": doc.file_name,
        "status": doc.status, "drive_file_id": req.file_id,
        "drive_url": f"https://drive.google.com/open?id={req.file_id}",
    }


# ── Google Tasks ──────────────────────────────────────────────────────────

@router.get("/tasks")
async def google_tasks_list(
    max_results: int = 50,
    show_completed: bool = False,
    _user=Depends(get_current_user),
):
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        import asyncio
        tasks = await asyncio.get_event_loop().run_in_executor(
            None, lambda: gs.tasks_list(max_results, show_completed)
        )
        return {"tasks": tasks}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


class GoogleTaskImportRequest(BaseModel):
    task_ids: list[str]


@router.post("/tasks/import")
async def google_tasks_import(
    req: GoogleTaskImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import asyncio
    import uuid as _uuid
    from models.db.task import Task as DBTask
    from models.db.enums import TaskPriority, TaskStatus

    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")

    all_tasks = await asyncio.get_event_loop().run_in_executor(
        None, lambda: gs.tasks_list(200, False)
    )
    by_id = {t["id"]: t for t in all_tasks}
    imported_ids = []

    for tid in req.task_ids:
        gt = by_id.get(tid)
        if not gt:
            continue
        due = None
        if gt.get("due"):
            try:
                from datetime import date
                due = date.fromisoformat(gt["due"][:10])
            except Exception:
                pass
        task = DBTask(
            id=_uuid.uuid4(),
            title=gt.get("title", "(No title)"),
            description=gt.get("notes") or None,
            status=TaskStatus.todo,
            priority=TaskPriority.medium,
            due_date=due,
            created_by_id=current_user.id,
            tags=["google-tasks"],
            attachments=[],
        )
        db.add(task)
        imported_ids.append(str(task.id))

    await db.commit()
    return {"imported": len(imported_ids), "task_ids": imported_ids}


# ── Calendar ──────────────────────────────────────────────────────────────

@router.get("/calendar/events")
async def calendar_events(
    days_behind: int = 0, days_ahead: int = 7,
    _user=Depends(get_current_user),
):
    try:
        return {"events": gs.calendar_events(days_behind, days_ahead)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


# ── Contacts ──────────────────────────────────────────────────────────────

@router.get("/contacts/search")
async def contacts_search(q: str, max: int = 10, _user=Depends(get_current_user)):
    try:
        return {"contacts": gs.contacts_search(q, max)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


# ── Gerry contact store (Phase 4) ─────────────────────────────────────────
# Contacts auto-derived from inbox senders + manually editable, stored in the
# SystemSetting sidecar (see services/email_contacts.py). Tied into tag memory.


def _contact_with_tags(contact: dict, rules: dict) -> dict:
    return {**contact, "tags": _resolve_tags(contact.get("email", ""), rules)}


@router.get("/contacts")
async def list_contacts(
    q: str = "",
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """List Gerry's contacts (derived + manual), each with its learned tags."""
    contacts = await ec.get_contacts(db)
    rules = await _get_tag_rules(db)
    items = ec.search_contacts_store(contacts, q, limit=500)
    return {"contacts": [_contact_with_tags(c, rules) for c in items]}


@router.get("/contacts/suggest")
async def suggest_contacts(
    q: str = "",
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Lightweight recipient autofill for the compose/reply box."""
    contacts = await ec.get_contacts(db)
    items = ec.search_contacts_store(contacts, q, limit=8)
    return {
        "contacts": [
            {"email": c["email"], "name": c.get("name", ""), "company": c.get("company", "")}
            for c in items
        ]
    }


@router.post("/contacts/sync")
async def sync_contacts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Derive contacts from recent inbox senders (auto-applied on view/sync)."""
    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        threads = gs.gmail_list_threads("in:inbox", 60)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    senders = [t.get("from", "") for t in threads]
    result = await ec.derive_from_senders(db, senders, current_user.id)
    await db.commit()
    return result


class ContactUpsert(BaseModel):
    email: str
    name: str | None = None
    company: str | None = None
    notes: str | None = None


@router.post("/contacts")
async def create_contact(
    req: ContactUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add or overwrite a contact by hand (marked as a manual entry)."""
    email = ec.extract_email(req.email)
    if not email or "@" not in email:
        raise HTTPException(422, "A valid email address is required.")
    contacts = await ec.get_contacts(db)
    domain = ec.domain_of(email)
    existing = contacts.get(email, {})
    contacts[email] = {
        "email": email,
        "name": (req.name if req.name is not None else existing.get("name") or "").strip(),
        "company": (
            req.company if req.company is not None
            else existing.get("company") or ec.company_from_domain(domain)
        ).strip(),
        "domain": domain,
        "notes": (req.notes if req.notes is not None else existing.get("notes") or "").strip(),
        "source": "manual",
        "count": int(existing.get("count", 0) or 0),
        "last_seen": existing.get("last_seen", ""),
    }
    await ec.save_contacts(db, contacts, current_user.id)
    await db.commit()
    rules = await _get_tag_rules(db)
    return _contact_with_tags(contacts[email], rules)


class ContactEdit(BaseModel):
    name: str | None = None
    company: str | None = None
    notes: str | None = None


@router.put("/contacts/{email}")
async def update_contact(
    email: str,
    req: ContactEdit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit a contact's name/company/notes (promotes it to a manual entry)."""
    key = ec.extract_email(email)
    contacts = await ec.get_contacts(db)
    contact = contacts.get(key)
    if contact is None:
        raise HTTPException(404, "Contact not found.")
    if req.name is not None:
        contact["name"] = req.name.strip()
    if req.company is not None:
        contact["company"] = req.company.strip()
    if req.notes is not None:
        contact["notes"] = req.notes.strip()
    contact["source"] = "manual"
    await ec.save_contacts(db, contacts, current_user.id)
    await db.commit()
    rules = await _get_tag_rules(db)
    return _contact_with_tags(contact, rules)


@router.delete("/contacts/{email}")
async def delete_contact(
    email: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a contact from Gerry's store."""
    key = ec.extract_email(email)
    contacts = await ec.get_contacts(db)
    if contacts.pop(key, None) is None:
        raise HTTPException(404, "Contact not found.")
    await ec.save_contacts(db, contacts, current_user.id)
    await db.commit()
    return {"deleted": key}


# ── Human-in-the-loop write proposals ────────────────────────────────────

_proposals: dict[str, dict[str, Any]] = {}


class ProposeRequest(BaseModel):
    action_type: str      # "send_email" | "create_event"
    params: dict[str, Any]


def _describe(action_type: str, params: dict) -> str:
    if action_type == "send_email":
        return (
            f"Send email\n"
            f"  To: {params.get('to', '')}\n"
            f"  Subject: {params.get('subject', '')}\n"
            f"  Body: {str(params.get('body', ''))[:300]}"
        )
    if action_type == "create_event":
        return (
            f"Create calendar event\n"
            f"  Title: {params.get('title', '')}\n"
            f"  When: {params.get('start', '')} → {params.get('end', '')}\n"
            f"  Location: {params.get('location', 'N/A')}"
        )
    return f"{action_type}: {params}"


@router.post("/actions/propose")
async def propose_action(req: ProposeRequest, _user=Depends(get_current_user)):
    if req.action_type not in ("send_email", "create_event"):
        raise HTTPException(400, f"Unknown action_type: {req.action_type}")
    pid = str(uuid.uuid4())[:8]
    _proposals[pid] = {
        "id": pid,
        "action_type": req.action_type,
        "params": req.params,
        "description": _describe(req.action_type, req.params),
        "status": "pending",
    }
    return _proposals[pid]


@router.get("/actions/pending")
async def list_pending(_user=Depends(get_current_user)):
    return {"proposals": [p for p in _proposals.values() if p["status"] == "pending"]}


@router.post("/actions/{proposal_id}/approve")
async def approve_action(proposal_id: str, _user=Depends(get_current_user)):
    p = _proposals.get(proposal_id)
    if not p:
        raise HTTPException(404, "Proposal not found")
    if p["status"] != "pending":
        raise HTTPException(400, f"Proposal is already {p['status']}")
    try:
        if p["action_type"] == "send_email":
            result = gs.gmail_send(**p["params"])
        elif p["action_type"] == "create_event":
            result = gs.calendar_create_event(**p["params"])
        else:
            raise HTTPException(400, "Unknown action type")
        p["status"] = "approved"
        return {"status": "executed", "result": result}
    except Exception as exc:
        p["status"] = "error"
        raise HTTPException(500, str(exc))


@router.delete("/actions/{proposal_id}")
async def cancel_action(proposal_id: str, _user=Depends(get_current_user)):
    p = _proposals.get(proposal_id)
    if not p:
        raise HTTPException(404, "Proposal not found")
    p["status"] = "cancelled"
    return {"status": "cancelled"}
