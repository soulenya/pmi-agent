"""
Document management router.

Endpoints:
  GET    /documents/categories         list all categories
  GET    /documents                    list documents (filterable by category)
  POST   /documents/upload             multipart upload + ingest
  GET    /documents/{doc_id}           get document metadata
  PATCH  /documents/{doc_id}           update title / category / is_regulated
  DELETE /documents/{doc_id}           soft-delete + remove encrypted file
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from models.schemas.common import ApiResponse, Meta, PaginationParams
from models.schemas.documents import (
    DocumentCategoryOut,
    DocumentChunkOut,
    DocumentCreate,
    DocumentOut,
    DocumentUpdate,
)
from repositories.document_repo import DocumentCategoryRepository, DocumentRepository, DocumentChunkRepository
from services.documents.ingestion import DocumentIngestionService
from services.embeddings.service import EmbeddingService, get_embedding_service_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


# ── Helpers ───────────────────────────────────────────────────────────────────

def _doc_out(doc) -> DocumentOut:
    return DocumentOut.model_validate(doc)


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=ApiResponse[list[DocumentCategoryOut]])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[list[DocumentCategoryOut]]:
    repo = DocumentCategoryRepository(db)
    cats = await repo.list()
    return ApiResponse.ok([DocumentCategoryOut.model_validate(c) for c in cats])


# ── Documents ─────────────────────────────────────────────────────────────────

@router.get("", response_model=ApiResponse[list[DocumentOut]])
async def list_documents(
    pagination: PaginationParams = Depends(),
    category_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[list[DocumentOut]]:
    repo = DocumentRepository(db)
    docs = await repo.list_active(
        category_id=category_id,
        limit=pagination.limit,
        offset=pagination.offset,
    )
    total = await repo.count_active(category_id=category_id)
    return ApiResponse.ok(
        [_doc_out(d) for d in docs],
        meta=Meta(total=total, limit=pagination.limit, offset=pagination.offset),
    )


@router.post(
    "/upload",
    response_model=ApiResponse[DocumentOut],
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    category_id: UUID | None = Form(None),
    is_regulated: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
) -> ApiResponse[DocumentOut]:
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of {MAX_UPLOAD_BYTES // (1024*1024)} MB",
        )

    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    try:
        doc = await svc.ingest(
            filename=file.filename or "upload",
            raw_bytes=raw,
            title=title.strip(),
            category_id=category_id,
            is_regulated=is_regulated,
            created_by_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        logger.exception("Document ingestion failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ingestion failed: {exc}",
        )

    return ApiResponse.ok(_doc_out(doc))


@router.get("/{doc_id}", response_model=ApiResponse[DocumentOut])
async def get_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[DocumentOut]:
    doc = await DocumentRepository(db).get_active(doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return ApiResponse.ok(_doc_out(doc))


@router.patch("/{doc_id}", response_model=ApiResponse[DocumentOut])
async def update_document(
    doc_id: UUID,
    body: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[DocumentOut]:
    repo = DocumentRepository(db)
    doc = await repo.get_active(doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    updates = body.model_dump(exclude_none=True)
    for k, v in updates.items():
        setattr(doc, k, v)
    await db.flush()
    return ApiResponse.ok(_doc_out(doc))


@router.delete("/{doc_id}", response_model=ApiResponse[None])
async def delete_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ApiResponse[None]:
    svc = DocumentIngestionService(
        db=db, embedding_svc=EmbeddingService()
    )
    deleted = await svc.delete(doc_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return ApiResponse.ok(None)


@router.get("/{doc_id}/chunks", response_model=ApiResponse[list[DocumentChunkOut]])
async def list_document_chunks(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[list[DocumentChunkOut]]:
    doc = await DocumentRepository(db).get_active(doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    chunks = await DocumentChunkRepository(db).get_by_document(doc_id)
    return ApiResponse.ok([DocumentChunkOut.model_validate(c) for c in chunks])


@router.post("/{doc_id}/reembed", response_model=ApiResponse[DocumentOut])
async def reembed_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
) -> ApiResponse[DocumentOut]:
    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    try:
        doc = await svc.reembed(doc_id)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Stored file not found — cannot re-embed.",
        )
    except Exception:
        logger.exception("Re-embed failed for doc %s", doc_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Re-embed failed — check server logs",
        )
    await db.commit()
    return ApiResponse.ok(_doc_out(doc))
