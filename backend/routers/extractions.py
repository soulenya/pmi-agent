"""Extractions API — run vision document extraction from the UI + manage saved schemas."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/extractions", tags=["extractions"])

RAW_TEXT_RESPONSE_CAP = 20_000

SOURCE_KINDS = ("chat_attachment", "regulatory_node", "generated_file")


# ── Schemas ───────────────────────────────────────────────────────────────────

class SchemaEntry(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field("", max_length=500)
    schema_: dict = Field(..., alias="schema")

    model_config = {"populate_by_name": True}


class SchemasIn(BaseModel):
    schemas: list[SchemaEntry]


class RunIn(BaseModel):
    source_kind: str
    source_ref: str = Field(..., min_length=1, max_length=500)
    schema_name: str | None = None
    schema_: dict | None = Field(default=None, alias="schema")
    instruction: str | None = Field(default=None, max_length=2000)

    model_config = {"populate_by_name": True}


class ExtractionOut(BaseModel):
    id: uuid.UUID
    status: str
    error: str | None
    file_name: str
    model: str
    pages: int | None
    structured: dict | None
    raw_text: str
    raw_text_truncated: bool
    input_tokens: int | None
    output_tokens: int | None


# ── Source resolution ─────────────────────────────────────────────────────────

async def _resolve_source(
    db: AsyncSession, user: User, kind: str, ref: str
) -> tuple[bytes, str, str | None]:
    """Returns (raw, file_name, mime_type). Raises HTTPException on any miss."""
    if kind == "chat_attachment":
        from models.db.conversation import Conversation, ConversationAttachment
        from services import chat_attachments as ca

        try:
            att_id = uuid.UUID(ref)
        except ValueError:
            raise HTTPException(422, "source_ref must be the attachment id.")
        att = (
            await db.execute(
                select(ConversationAttachment)
                .join(Conversation, Conversation.id == ConversationAttachment.conversation_id)
                .where(ConversationAttachment.id == att_id, Conversation.user_id == user.id)
            )
        ).scalar_one_or_none()
        if att is None or not att.stored_path:
            raise HTTPException(404, "Attachment not found.")
        return ca.decrypt_attachment(att.stored_path), att.file_name, att.mime_type

    if kind == "regulatory_node":
        from models.db.regulatory import RegulatoryNode
        from routers.regulatory_files import _store_path

        try:
            node_id = uuid.UUID(ref)
        except ValueError:
            raise HTTPException(422, "source_ref must be the regulatory file id.")
        node = await db.get(RegulatoryNode, node_id)
        if node is None or node.node_type != "file" or not node.stored_filename:
            raise HTTPException(404, "Regulatory file not found.")
        path = _store_path(node.stored_filename)
        if not path.is_file():
            raise HTTPException(404, "Stored file is missing on disk.")
        return path.read_bytes(), node.name, node.mime_type

    if kind == "generated_file":
        from services.agent.tools import _GENERATED_FILES_DIR

        base = _GENERATED_FILES_DIR.resolve()
        path = (base / ref).resolve()
        if not (str(path).startswith(str(base)) and path.is_file()):
            raise HTTPException(404, "Generated file not found.")
        return path.read_bytes(), path.name, None

    raise HTTPException(422, f"source_kind must be one of: {', '.join(SOURCE_KINDS)}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/schemas")
async def get_schemas(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    from services.extraction_schemas import list_schemas

    return await list_schemas(db)


@router.put("/schemas")
async def put_schemas(
    body: SchemasIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    from services.extraction_schemas import SchemaValidationError, save_schemas

    try:
        return await save_schemas(
            db, [e.model_dump(by_alias=True) for e in body.schemas]
        )
    except SchemaValidationError as exc:
        raise HTTPException(422, str(exc))


@router.post("/run", response_model=ExtractionOut)
async def run_extraction(
    body: RunIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExtractionOut:
    from services.document_extraction import extract_document
    from services.extraction_schemas import find_schema

    raw, file_name, mime_type = await _resolve_source(
        db, current_user, body.source_kind, body.source_ref
    )

    schema = body.schema_
    if schema is None and body.schema_name:
        entry = await find_schema(db, body.schema_name)
        if entry is None:
            raise HTTPException(404, f'No saved schema named "{body.schema_name}".')
        schema = entry["schema"]

    row = await extract_document(
        db,
        raw=raw,
        file_name=file_name,
        mime_type=mime_type,
        schema=schema,
        instruction=body.instruction,
        user_id=current_user.id,
        source_kind=body.source_kind,
        source_ref=body.source_ref,
    )
    truncated = len(row.raw_text) > RAW_TEXT_RESPONSE_CAP
    return ExtractionOut(
        id=row.id,
        status=row.status,
        error=row.error,
        file_name=row.file_name,
        model=row.model,
        pages=row.pages,
        structured=row.structured,
        raw_text=row.raw_text[:RAW_TEXT_RESPONSE_CAP],
        raw_text_truncated=truncated,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
    )
