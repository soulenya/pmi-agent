"""
Google Workspace integration router.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
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


@router.get("/gmail/message/{message_id}")
async def gmail_message(message_id: str, _user=Depends(get_current_user)):
    try:
        return gs.gmail_get_message(message_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))


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
    from services.documents.ingestion import DocumentIngestionService, DuplicateDocumentError
    from uuid import UUID as _UUID

    if not gs.get_credentials():
        raise HTTPException(401, "Google account not connected.")
    try:
        drive_file_data = gs.drive_get_content(req.file_id)
    except Exception as exc:
        raise HTTPException(400, f"Could not read Drive file: {exc}")

    from pathlib import Path as _Path

    content = drive_file_data.get("content", "")
    name = drive_file_data.get("name", "drive_file.txt")
    mime = drive_file_data.get("type", "text/plain")
    drive_raw_bytes = drive_file_data.get("raw_bytes")
    drive_extension = drive_file_data.get("extension", "")
    cat_id = _UUID(req.category_id) if req.category_id else None

    if drive_raw_bytes:
        # Binary file (PDF/DOCX): hand the raw bytes to the ingestion service so
        # it extracts text with the same robust parser used for uploads
        # (PyMuPDF for PDF, python-docx for DOCX). This avoids the weaker
        # pre-extraction that made Drive imports fail on files that uploaded fine.
        filename = _Path(name).stem + drive_extension
        raw_bytes = drive_raw_bytes
    else:
        # Google-native (Docs/Sheets/Slides) or text files arrive as plain text.
        if not content.strip():
            raise HTTPException(
                422,
                f"Could not extract text from '{name}' ({mime}). "
                "Supported types: Google Docs/Sheets/Slides, PDFs, Word documents, and plain text files.",
            )
        ext_map = {
            "application/vnd.google-apps.document":     ".txt",
            "application/vnd.google-apps.spreadsheet":  ".csv",
            "application/vnd.google-apps.presentation": ".txt",
            "text/plain": ".txt", "text/csv": ".csv",
            "text/markdown": ".md", "application/json": ".json",
        }
        ext = ext_map.get(mime, ".txt")
        filename = _Path(name).stem + ext
        raw_bytes = content.encode("utf-8")

    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    try:
        doc = await svc.ingest(
            filename=filename, raw_bytes=raw_bytes,
            title=req.title or name, category_id=cat_id,
            is_regulated=req.is_regulated, created_by_id=current_user.id,
            allow_duplicate=req.force,
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
    except Exception as exc:
        raise HTTPException(500, f"Ingestion failed: {exc}")

    # Record source linkage so the document can be checked for updates later.
    from datetime import datetime, timezone
    from services.documents.sync import parse_drive_time

    now = datetime.now(timezone.utc)
    doc.source_type = "google_drive"
    doc.source_id = req.file_id
    doc.source_name = name
    doc.source_modified_at = parse_drive_time(drive_file_data.get("modified", ""))
    doc.last_synced_at = now
    doc.last_checked_at = now
    doc.sync_status = "current"
    doc.sync_detail = None

    await db.commit()
    return {
        "id": str(doc.id), "title": doc.title, "filename": doc.file_name,
        "status": doc.status, "drive_file_id": req.file_id,
        "drive_url": drive_file_data.get("url", ""),
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
