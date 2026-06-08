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
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
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
from services.embeddings.service import (
    EmbeddingService,
    get_embedding_service_db,
    get_embedding_service_for_db,
    get_provider_dimension,
    PROVIDER_DIMENSIONS,
)

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

    await db.commit()
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


# ── Knowledge Base Re-index ───────────────────────────────────────────────────

class ReindexRequest(BaseModel):
    provider: str | None = Field(None, pattern="^(ollama|openai|voyage)$")
    model: str | None = Field(None, min_length=1, max_length=100)


@router.post("/reindex")
async def reindex_knowledge_base(
    body: ReindexRequest = ReindexRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """
    Re-embed all documents through the active (or specified) embedding provider.

    Streams Server-Sent Events (SSE):
      data: {"status": "running", "processed": N, "total": M, "doc_title": "..."}
      data: {"status": "done", "processed": N, "total": M}
      data: {"status": "error", "detail": "..."}

    Automatically:
      1. Detects target dimension from provider/model
      2. ALTERs the pgvector column if dimension changed
      3. Deletes all existing chunks
      4. Re-embeds every ready document
      5. Updates system_settings llm.embedding_dimension + llm.kb_needs_reindex
    """
    from sqlalchemy import select, text
    from models.db.settings import SystemSetting
    from models.db.document import Document

    async def _stream():
        import json

        def _event(data: dict) -> str:
            return f"data: {json.dumps(data)}\n\n"

        try:
            # Resolve provider + model
            async def _read(key: str, default: str) -> str:
                row = (await db.execute(
                    select(SystemSetting).where(SystemSetting.key == key)
                )).scalar_one_or_none()
                return str(row.value) if row and row.value else default

            provider = body.provider or await _read("llm.embedding_provider", "ollama")
            model = body.model or await _read("llm.embedding_model", "nomic-embed-text")

            target_dim = get_provider_dimension(provider, model)
            current_dim_str = await _read("llm.embedding_dimension", "768")
            current_dim = int(current_dim_str)

            # ── Step 1: ALTER column if dimension changed ─────────────────────
            if target_dim != current_dim:
                yield _event({
                    "status": "running",
                    "phase": "alter_schema",
                    "detail": f"Changing vector dimension from {current_dim} to {target_dim}…",
                    "processed": 0,
                    "total": 0,
                })
                # Drop existing index first (pgvector requires this for ALTER)
                await db.execute(text(
                    "DROP INDEX IF EXISTS ix_document_chunks_embedding"
                ))
                # ALTER the column — USING NULL resets existing vectors to NULL
                await db.execute(text(
                    f"ALTER TABLE document_chunks "
                    f"ALTER COLUMN embedding TYPE vector({target_dim}) USING NULL"
                ))
                await db.commit()

            # ── Step 2: Delete all existing chunks ────────────────────────────
            chunk_repo = DocumentChunkRepository(db)
            deleted = await chunk_repo.delete_all_chunks()
            await db.commit()

            # ── Step 3: Get all ready document IDs ────────────────────────────
            doc_ids = await chunk_repo.get_all_document_ids_ready()
            total = len(doc_ids)

            if total == 0:
                # Update settings and exit early
                await _update_settings(db, provider, model, target_dim, current_user.id)
                await db.commit()
                yield _event({"status": "done", "processed": 0, "total": 0})
                return

            # ── Step 4: Build embedding service ───────────────────────────────
            try:
                embedding_svc = await get_embedding_service_for_db(db)
            except RuntimeError as exc:
                yield _event({"status": "error", "detail": str(exc)})
                return

            # ── Step 5: Re-embed each document ────────────────────────────────
            doc_repo = DocumentRepository(db)
            ingestion_svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)

            processed = 0
            for doc_id in doc_ids:
                doc = await doc_repo.get_active(doc_id)
                if doc is None:
                    continue
                try:
                    await ingestion_svc.reembed(doc_id)
                    await db.commit()
                    processed += 1
                    yield _event({
                        "status": "running",
                        "processed": processed,
                        "total": total,
                        "doc_title": doc.title,
                    })
                except Exception as exc:
                    logger.exception("Re-index failed for doc %s", doc_id)
                    yield _event({
                        "status": "error",
                        "detail": f"Failed on '{doc.title}': {exc}",
                        "processed": processed,
                        "total": total,
                    })
                    return

            # ── Step 6: Recreate vector index + update settings ───────────────
            await db.execute(text(
                f"CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding "
                f"ON document_chunks USING ivfflat (embedding vector_cosine_ops)"
            ))
            await _update_settings(db, provider, model, target_dim, current_user.id)
            await db.commit()

            yield _event({"status": "done", "processed": processed, "total": total})

        except Exception as exc:
            logger.exception("Re-index stream error")
            import json
            yield f"data: {json.dumps({'status': 'error', 'detail': str(exc)})}\n\n"

    async def _update_settings(db, provider: str, model: str, dim: int, user_id) -> None:
        from sqlalchemy import select
        from models.db.settings import SystemSetting

        async def _upsert(key: str, value: str) -> None:
            row = (await db.execute(
                select(SystemSetting).where(SystemSetting.key == key)
            )).scalar_one_or_none()
            if row is None:
                db.add(SystemSetting(key=key, value=value, updated_by=user_id))
            else:
                row.value = value
                row.updated_by = user_id
            await db.flush()

        await _upsert("llm.embedding_provider", provider)
        await _upsert("llm.embedding_model", model)
        await _upsert("llm.embedding_dimension", str(dim))
        await _upsert("llm.kb_needs_reindex", "false")

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
