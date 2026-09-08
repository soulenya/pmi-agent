"""
Knowledge base vector search router.

POST /search   — semantic search over document chunks
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.conversation import Conversation
from models.db.document import Document
from models.db.task import Project, Task
from models.db.user import User
from models.schemas.common import ApiResponse
from models.schemas.documents import SearchRequest, SearchResult
from repositories.document_repo import DocumentChunkRepository, DocumentRepository
from services.email_contacts import get_contacts, search_contacts_store
from services.embeddings.service import EmbeddingService, get_embedding_service_db
from services.projects.access import visible_project_ids

router = APIRouter(prefix="/search", tags=["search"])


@router.post("", response_model=ApiResponse[list[SearchResult]])
async def semantic_search(
    body: SearchRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
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


# ── Everything ────────────────────────────────────────────────────────────────
#
# The omnibar's one box. A name typed there has to find a project, a task, a
# document, a conversation or a person without the user first choosing which.
# Cheap prefix/substring matches by title, capped per kind, newest first.


class Hit(BaseModel):
    kind: Literal["project", "task", "document", "conversation", "contact"]
    id: str
    title: str
    subtitle: str | None = None
    updated_at: datetime | None = None


class EverythingOut(BaseModel):
    query: str
    hits: list[Hit]


@router.get("/everything", response_model=EverythingOut)
async def search_everything(
    q: str = Query(..., min_length=1, max_length=200),
    per_kind: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EverythingOut:
    needle = f"%{q.strip()}%"
    hits: list[Hit] = []

    visible = await visible_project_ids(db, current_user.id)
    if visible:
        # A project moved to the hub is archived here but keeps its tasks;
        # those rows are the stale twin, not work, so they are left out.
        live = [
            r[0]
            for r in (
                await db.execute(
                    select(Project.id).where(
                        Project.id.in_(visible), Project.is_archived.is_(False)
                    )
                )
            ).all()
        ]
        projects = (
            await db.execute(
                select(Project)
                .where(Project.id.in_(live), Project.name.ilike(needle))
                .order_by(Project.updated_at.desc())
                .limit(per_kind)
            )
        ).scalars() if live else []
        hits += [
            Hit(kind="project", id=str(p.id), title=p.name, subtitle=p.status, updated_at=p.updated_at)
            for p in projects
        ]

        tasks = (
            await db.execute(
                select(Task)
                .where(
                    or_(Task.project_id.in_(live), Task.project_id.is_(None)) if live else Task.project_id.is_(None),
                    Task.title.ilike(needle),
                    Task.status.notin_(["done", "cancelled"]),
                )
                .order_by(Task.updated_at.desc())
                .limit(per_kind)
            )
        ).scalars()
        hits += [
            Hit(kind="task", id=str(t.id), title=t.title, subtitle=t.status, updated_at=t.updated_at)
            for t in tasks
        ]

    docs = (
        await db.execute(
            select(Document)
            .where(Document.deleted_at.is_(None), Document.title.ilike(needle))
            .order_by(Document.updated_at.desc())
            .limit(per_kind)
        )
    ).scalars()
    hits += [
        Hit(kind="document", id=str(d.id), title=d.title, subtitle=d.source_type, updated_at=d.updated_at)
        for d in docs
    ]

    convs = (
        await db.execute(
            select(Conversation)
            .where(
                Conversation.user_id == current_user.id,
                Conversation.is_archived.is_(False),
                Conversation.hub_mirror.is_(False),
                Conversation.title.ilike(needle),
            )
            .order_by(Conversation.updated_at.desc())
            .limit(per_kind)
        )
    ).scalars()
    hits += [
        Hit(kind="conversation", id=str(c.id), title=c.title or "Untitled", subtitle=c.kind, updated_at=c.updated_at)
        for c in convs
    ]

    contacts = search_contacts_store(await get_contacts(db), q, limit=per_kind)
    hits += [
        Hit(
            kind="contact",
            id=str(c.get("email", "")),
            title=str(c.get("name") or c.get("email") or ""),
            subtitle=str(c.get("company") or c.get("email") or "") or None,
        )
        for c in contacts
        if c.get("email")
    ]

    return EverythingOut(query=q, hits=hits)
