"""Regulatory template wizard API.

Drives the "Generate document" wizard in the Regulatory tab:

1. ``GET  /regulatory-templates``            — list the FDA / ISO template catalog
2. ``POST /regulatory-templates/recommend``  — AI-recommended structure + format
3. ``POST /regulatory-templates/generate``   — draft the document and save it as
   an editable file in the regulatory file store

Generated files land in the regulatory_nodes tree (source_type="generated")
so they behave like any other regulatory file: rename, move, download, and —
for Markdown output — in-app text editing. The generate response includes a
suggested review task the frontend can create via ``POST /tasks``.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_regulatory_write
from models.db.regulatory import RegulatoryNode
from models.db.user import User
from routers.regulatory_files import NodeOut, _dedupe_name, _get_folder, _store_path, _to_out
from services.embeddings.service import EmbeddingService, get_embedding_service
from services.regulatory.docgen import markdown_to_docx_bytes
from services.regulatory.generator import generate_markdown, recommend_formatting
from services.regulatory.templates import REG_TEMPLATES, get_template

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/regulatory-templates", tags=["regulatory-templates"])

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


# ── Schemas ────────────────────────────────────────────────────────────────────

class TemplateOut(BaseModel):
    key: str
    label: str
    category: str
    description: str
    related_standards: list[str]
    default_sections: list[str]
    recommended_format: str


class RecommendRequest(BaseModel):
    template_key: str
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=2000)


class RecommendOut(BaseModel):
    format: str
    sections: list[str]
    rationale: str


class GenerateRequest(BaseModel):
    template_key: str
    title: str = Field(min_length=1, max_length=300)
    doc_number: str | None = Field(default=None, max_length=100)
    sections: list[str] = []
    format: str = "docx"  # "docx" | "md"
    auto_populate: bool = True
    notes: str | None = Field(default=None, max_length=2000)
    parent_id: uuid.UUID | None = None


class ReviewTaskSuggestion(BaseModel):
    title: str
    description: str
    priority: str
    due_date: datetime
    tags: list[str]


class GenerateOut(BaseModel):
    node: NodeOut
    review_task: ReviewTaskSuggestion


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=list[TemplateOut])
async def list_templates(
    _user: User = Depends(get_current_user),
) -> list[TemplateOut]:
    """List the curated FDA / ISO document template catalog."""
    return [
        TemplateOut(
            key=t.key,
            label=t.label,
            category=t.category,
            description=t.description,
            related_standards=list(t.related_standards),
            default_sections=list(t.default_sections),
            recommended_format=t.recommended_format,
        )
        for t in REG_TEMPLATES
    ]


@router.post("/recommend", response_model=RecommendOut)
async def recommend(
    body: RecommendRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> RecommendOut:
    """AI-recommended section structure and output format for a planned document."""
    template = get_template(body.template_key)
    if template is None:
        raise HTTPException(status_code=404, detail="Unknown template.")
    rec = await recommend_formatting(db, template, body.title.strip(), body.notes)
    return RecommendOut(**rec)


@router.post("/generate", response_model=GenerateOut, status_code=status.HTTP_201_CREATED)
async def generate(
    body: GenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_regulatory_write),
    embedding_svc: EmbeddingService = Depends(get_embedding_service),
) -> GenerateOut:
    """Generate the document and save it as an editable file in the regulatory store."""
    template = get_template(body.template_key)
    if template is None:
        raise HTTPException(status_code=404, detail="Unknown template.")
    if body.format not in ("docx", "md"):
        raise HTTPException(status_code=400, detail="Format must be 'docx' or 'md'.")
    await _get_folder(db, body.parent_id)

    title = body.title.strip()
    sections = [s.strip() for s in body.sections if s.strip()] or list(template.default_sections)

    try:
        content = await generate_markdown(
            db,
            embedding_svc,
            template,
            title=title,
            doc_number=body.doc_number,
            sections=sections,
            auto_populate=body.auto_populate,
            notes=body.notes,
        )
    except Exception as exc:  # noqa: BLE001 — surface a readable error to the wizard
        logger.warning("Regulatory document generation failed: %s", exc)
        raise HTTPException(
            status_code=502, detail=f"Document generation failed: {exc}"
        ) from exc

    # Render + store the file
    safe_stem = re.sub(r"[^\w.\- ]", "_", title).strip() or "Regulatory Document"
    if body.format == "docx":
        raw = markdown_to_docx_bytes(title, content)
        ext, mime = ".docx", DOCX_MIME
    else:
        raw = content.encode("utf-8")
        ext, mime = ".md", "text/markdown"

    name = await _dedupe_name(db, body.parent_id, f"{safe_stem}{ext}")
    stored = f"{uuid.uuid4().hex}{ext}"
    _store_path(stored).write_bytes(raw)

    node = RegulatoryNode(
        parent_id=body.parent_id,
        node_type="file",
        name=name,
        stored_filename=stored,
        size_bytes=len(raw),
        mime_type=mime,
        extension=ext,
        source_type="generated",
        created_by=user.id,
    )
    db.add(node)
    await db.flush()
    await db.refresh(node)
    await db.commit()

    review_task = ReviewTaskSuggestion(
        title=f"Review generated document: {title}",
        description=(
            f"Review and approve the AI-generated {template.label} "
            f"\"{name}\" in Regulatory Files. Verify all "
            f"[FILL IN: …] placeholders are resolved and content meets "
            f"{', '.join(template.related_standards)}."
        ),
        priority="high",
        due_date=datetime.now(timezone.utc) + timedelta(days=7),
        tags=["regulatory", template.key],
    )
    return GenerateOut(node=_to_out(node), review_task=review_task)
