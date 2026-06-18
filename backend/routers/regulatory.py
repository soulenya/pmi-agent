"""Regulatory Documents, Risk Items, and CAPA REST API."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from models.schemas.regulatory import (
    CAPACreate,
    CAPAOut,
    CAPAUpdate,
    RegDocCreate,
    RegDocOut,
    RegDocUpdate,
    RiskItemCreate,
    RiskItemOut,
    RiskItemUpdate,
)
from repositories.regulatory_repo import CAPARepository, RegulatoryDocRepository, RiskItemRepository
from repositories.document_repo import DocumentChunkRepository, DocumentRepository
from services.embeddings.service import get_embedding_service_for_db
from services.llm.router import get_llm_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/regulatory", tags=["regulatory"])
capa_router = APIRouter(prefix="/capas", tags=["capa"])


# ── Regulatory Documents ──────────────────────────────────────────────────────

@router.get("", response_model=list[RegDocOut])
async def list_reg_docs(
    doc_type: str | None = Query(None),
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RegDocOut]:
    repo = RegulatoryDocRepository(db)
    docs = await repo.list(doc_type=doc_type, status=status)
    return [RegDocOut.model_validate(d) for d in docs]


@router.post("", response_model=RegDocOut, status_code=status.HTTP_201_CREATED)
async def create_reg_doc(
    body: RegDocCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RegDocOut:
    repo = RegulatoryDocRepository(db)
    doc = await repo.create(created_by=current_user.id, **body.model_dump())
    await db.commit()
    return RegDocOut.model_validate(doc)


@router.get("/{doc_id}", response_model=RegDocOut)
async def get_reg_doc(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RegDocOut:
    repo = RegulatoryDocRepository(db)
    doc = await repo.get(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Regulatory document not found.")
    return RegDocOut.model_validate(doc)


@router.patch("/{doc_id}", response_model=RegDocOut)
async def update_reg_doc(
    doc_id: uuid.UUID,
    body: RegDocUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RegDocOut:
    repo = RegulatoryDocRepository(db)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    doc = await repo.update(doc_id, **updates)
    if doc is None:
        raise HTTPException(status_code=404, detail="Regulatory document not found.")
    await db.commit()
    return RegDocOut.model_validate(doc)


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reg_doc(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    repo = RegulatoryDocRepository(db)
    deleted = await repo.delete(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Regulatory document not found.")
    await db.commit()


# ── AI Content Drafting ───────────────────────────────────────────────────────

class AIDraftOut(BaseModel):
    doc_id: str
    content: str


@router.post("/{doc_id}/ai-draft", response_model=AIDraftOut)
async def ai_draft_content(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AIDraftOut:
    """Generate AI-drafted content for a regulatory document using KB context."""
    repo = RegulatoryDocRepository(db)
    doc = await repo.get(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Regulatory document not found.")

    # Search KB for relevant context. Use the DB-aware embedding service so the
    # query is embedded with the SAME provider/model the documents were ingested
    # with — otherwise the vectors live in a different space and the search
    # returns nothing (no company data gets auto-populated).
    kb_context = ""
    try:
        embedding_svc = await get_embedding_service_for_db(db)
        query_embedding = await embedding_svc.embed(
            f"{doc.doc_type} {doc.title} {' '.join(doc.related_standards or [])}"
        )
        chunk_repo = DocumentChunkRepository(db)
        results = await chunk_repo.vector_search(query_embedding, top_k=5)
        if results:
            excerpts = [f"[{i+1}] {chunk.content[:500]}" for i, (chunk, _) in enumerate(results)]
            kb_context = "\n\n".join(excerpts)
    except Exception as exc:
        logger.warning("KB search for AI draft failed: %s", exc)

    standards_str = ", ".join(doc.related_standards) if doc.related_standards else "none specified"
    context_block = f"\n\nRelevant Knowledge Base Context:\n{kb_context}" if kb_context else ""

    prompt = (
        "You are a regulatory affairs specialist at Precisian Medical Instruments (PMI), "
        "a medical device startup developing VACTOR — a hyper-compact, battery-powered suction device "
        "for emergency, military, and EMS applications.\n\n"
        f"Document Type: {doc.doc_type}\n"
        f"Document Number: {doc.doc_number or 'TBD'}\n"
        f"Title: {doc.title}\n"
        f"Revision: {doc.revision}\n"
        f"Related Standards: {standards_str}\n"
        f"{context_block}\n\n"
        "Draft professional content for this regulatory document. "
        "Structure the content with clear sections using ## headings. "
        "Be specific to VACTOR and PMI's regulatory context. "
        "Include scope, purpose, responsibilities, and relevant procedure steps where applicable. "
        "Output ONLY the document content — no meta-commentary."
    )

    try:
        client = await get_llm_client(db, task="regulatory")
        response = await client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        content = response.content.strip()
    except Exception as exc:
        logger.warning("LLM regulatory draft failed: %s", exc)
        content = (
            f"# {doc.title}\n\n"
            f"**Document Type:** {doc.doc_type}\n"
            f"**Doc Number:** {doc.doc_number or 'TBD'}\n"
            f"**Revision:** {doc.revision}\n\n"
            "AI generation is currently unavailable. Please draft this document manually."
        )

    return AIDraftOut(doc_id=str(doc_id), content=content)


# ── Risk Items ────────────────────────────────────────────────────────────────

@router.get("/risks", response_model=list[RiskItemOut])
async def list_all_risk_items(
    regulatory_doc_id: uuid.UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[RiskItemOut]:
    """List all risk items, optionally filtered by regulatory document."""
    repo = RiskItemRepository(db)
    items = await repo.list(regulatory_doc_id=regulatory_doc_id)
    return [RiskItemOut.model_validate(i) for i in items]


@router.get("/{doc_id}/risks", response_model=list[RiskItemOut])
async def list_risk_items(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RiskItemOut]:
    repo = RiskItemRepository(db)
    items = await repo.list(regulatory_doc_id=doc_id)
    return [RiskItemOut.model_validate(i) for i in items]


@router.post("/{doc_id}/risks", response_model=RiskItemOut, status_code=status.HTTP_201_CREATED)
async def create_risk_item(
    doc_id: uuid.UUID,
    body: RiskItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RiskItemOut:
    # Verify doc exists
    reg_repo = RegulatoryDocRepository(db)
    if await reg_repo.get(doc_id) is None:
        raise HTTPException(status_code=404, detail="Regulatory document not found.")
    data = body.model_dump()
    data["regulatory_doc_id"] = doc_id
    repo = RiskItemRepository(db)
    item = await repo.create(**data)
    await db.commit()
    return RiskItemOut.model_validate(item)


@router.patch("/risks/{item_id}", response_model=RiskItemOut)
async def update_risk_item(
    item_id: uuid.UUID,
    body: RiskItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RiskItemOut:
    repo = RiskItemRepository(db)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    item = await repo.update(item_id, **updates)
    if item is None:
        raise HTTPException(status_code=404, detail="Risk item not found.")
    await db.commit()
    return RiskItemOut.model_validate(item)


@router.delete("/risks/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> None:
    repo = RiskItemRepository(db)
    deleted = await repo.delete(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Risk item not found.")
    await db.commit()


# ── CAPAs ──────────────────────────────────────────────────────────────────────

@capa_router.get("", response_model=list[CAPAOut])
async def list_capas(
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CAPAOut]:
    repo = CAPARepository(db)
    capas = await repo.list(status=status)
    return [CAPAOut.model_validate(c) for c in capas]


@capa_router.post("", response_model=CAPAOut, status_code=status.HTTP_201_CREATED)
async def create_capa(
    body: CAPACreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CAPAOut:
    repo = CAPARepository(db)
    capa = await repo.create(**body.model_dump())
    await db.commit()
    return CAPAOut.model_validate(capa)


@capa_router.get("/{capa_id}", response_model=CAPAOut)
async def get_capa(
    capa_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CAPAOut:
    repo = CAPARepository(db)
    capa = await repo.get(capa_id)
    if capa is None:
        raise HTTPException(status_code=404, detail="CAPA not found.")
    return CAPAOut.model_validate(capa)


@capa_router.patch("/{capa_id}", response_model=CAPAOut)
async def update_capa(
    capa_id: uuid.UUID,
    body: CAPAUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CAPAOut:
    repo = CAPARepository(db)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    capa = await repo.update(capa_id, **updates)
    if capa is None:
        raise HTTPException(status_code=404, detail="CAPA not found.")
    await db.commit()
    return CAPAOut.model_validate(capa)
