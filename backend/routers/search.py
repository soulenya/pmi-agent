"""
Knowledge base vector search router.

POST /search   — semantic search over document chunks
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.document import Document
from models.db.user import User
from models.schemas.common import ApiResponse
from models.schemas.documents import SearchRequest, SearchResult
from repositories.document_repo import DocumentChunkRepository, DocumentRepository
from services.embeddings.service import EmbeddingService, get_embedding_service

router = APIRouter(prefix="/search", tags=["search"])


@router.post("", response_model=ApiResponse[list[SearchResult]])
async def semantic_search(
    body: SearchRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service),
) -> ApiResponse[list[SearchResult]]:
    """
    Embed *query* with nomic-embed-text and run a cosine similarity search
    against all ready document chunks.
    """
    try:
        query_embedding = await embedding_svc.embed(body.query)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Embedding service unavailable: {exc}",
        )

    chunk_repo = DocumentChunkRepository(db)
    doc_repo = DocumentRepository(db)

    results = await chunk_repo.vector_search(
        query_embedding,
        top_k=body.top_k,
        category_id=body.category_id,
    )

    output: list[SearchResult] = []
    for chunk, score in results:
        doc = await doc_repo.get_active(chunk.document_id)
        if doc is None:
            continue
        output.append(
            SearchResult(
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document_title=doc.title,
                chunk_index=chunk.chunk_index,
                page_number=chunk.page_number,
                content=chunk.content,
                score=score,
            )
        )

    return ApiResponse.ok(output)
