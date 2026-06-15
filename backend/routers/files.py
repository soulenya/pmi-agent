"""
Generated files router.
Serves files from backend/generated_files/ — created by the AI agent's generate_file tool.
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from fastapi import Depends
from models.db.user import User
from services.documents.ingestion import DocumentIngestionService, DuplicateDocumentError
from services.embeddings.service import EmbeddingService, get_embedding_service_db

logger = logging.getLogger(__name__)

_FILES_DIR = Path(__file__).resolve().parent.parent / "generated_files"
_FILES_DIR.mkdir(exist_ok=True)

_ALLOWED_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".docx", ".doc"}

router = APIRouter(prefix="/api/files", tags=["files"])


def _safe_path(name: str) -> Path:
    """Return resolved path, raising 400 if name is suspicious."""
    if "/" in name or "\\" in name:
        raise HTTPException(400, "Invalid filename")
    p = (_FILES_DIR / name).resolve()
    if not str(p).startswith(str(_FILES_DIR)):
        raise HTTPException(400, "Invalid filename")
    return p


@router.get("")
async def list_files(_user=Depends(get_current_user)):
    """List all generated files, newest first."""
    files = []
    for f in sorted(_FILES_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.is_file() and f.suffix in _ALLOWED_EXTENSIONS:
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "modified": f.stat().st_mtime,
            })
    return {"files": files}


@router.get("/{name}")
async def download_file(name: str, _user=Depends(get_current_user)):
    """Download a generated file."""
    p = _safe_path(name)
    if not p.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(p, filename=name)


@router.delete("/{name}")
async def delete_file(name: str, _user=Depends(get_current_user)):
    """Delete a generated file."""
    p = _safe_path(name)
    if not p.exists():
        raise HTTPException(404, "File not found")
    p.unlink()
    return {"deleted": name}


class ToKnowledgeBaseRequest(BaseModel):
    title: str | None = None
    force: bool = False


class ToDriveRequest(BaseModel):
    target_name: str | None = None
    folder_id: str | None = None


@router.post("/{name}/to-knowledge-base", status_code=201)
async def move_file_to_knowledge_base(
    name: str,
    body: ToKnowledgeBaseRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
):
    """Ingest a generated file into the Knowledge Base, then remove it (move semantics)."""
    p = _safe_path(name)
    if not p.exists():
        raise HTTPException(404, "File not found")

    raw = p.read_bytes()
    title = ((body.title if body else None) or p.stem).strip() or p.stem

    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    try:
        doc = await svc.ingest(
            filename=name,
            raw_bytes=raw,
            title=title,
            category_id=None,
            is_regulated=False,
            created_by_id=current_user.id,
            allow_duplicate=bool(body.force) if body else False,
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
        logger.exception("Moving generated file %s to knowledge base failed", name)
        raise HTTPException(500, f"Ingestion failed: {exc}")

    await db.commit()
    p.unlink(missing_ok=True)
    return {"document_id": str(doc.id), "title": doc.title, "moved": name}


@router.post("/{name}/to-drive")
async def upload_file_to_drive(
    name: str,
    body: ToDriveRequest | None = None,
    _user=Depends(get_current_user),
):
    """Upload a generated file to the user's Google Drive (My Drive root or a folder)."""
    p = _safe_path(name)
    if not p.exists():
        raise HTTPException(404, "File not found")

    from services.google_service import drive_upload_file

    try:
        return drive_upload_file(
            str(p),
            name=(body.target_name if body else None) or None,
            folder_id=(body.folder_id if body else None) or None,
        )
    except RuntimeError as e:
        raise HTTPException(401, str(e))
