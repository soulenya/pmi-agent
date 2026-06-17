"""
Odoo ERP integration router.

Phase 1 — read-only:
  * Connect / disconnect a single Odoo account (API-key auth, encrypted at rest).
  * Report connection status.
  * Read curated datasets (customers, sales, invoices, products, leads,
    purchases, manufacturing, employees) via ``search_read``.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.odoo import OdooConnection
from models.db.user import User
from services import odoo_service as odoo
from services.documents.ingestion import DocumentIngestionService, DuplicateDocumentError
from services.embeddings.service import EmbeddingService, get_embedding_service_db

router = APIRouter(prefix="/api/odoo", tags=["odoo"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ConnectRequest(BaseModel):
    url: str = Field(..., description="Odoo base URL, e.g. https://acme.odoo.com")
    database: str = Field(..., description="Odoo database name")
    username: str = Field(..., description="Login email")
    api_key: str = Field(..., description="Odoo API key")


class StatusResponse(BaseModel):
    connected: bool
    url: str | None = None
    database: str | None = None
    username: str | None = None
    display_name: str | None = None
    server_version: str | None = None
    last_connected_at: datetime | None = None


class IngestRequest(BaseModel):
    key: str = Field(..., description="Dataset key, e.g. 'customers' or 'sales'")
    ids: list[int] | None = Field(None, description="Specific Odoo record ids; omit for the first rows")
    limit: int = Field(50, ge=1, le=200)


class IngestResult(BaseModel):
    imported: int
    skipped: int
    failed: int


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _load_conn(db: AsyncSession, user: User) -> OdooConnection:
    conn = (
        await db.execute(
            select(OdooConnection).where(OdooConnection.user_id == user.id)
        )
    ).scalar_one_or_none()
    if conn is None:
        raise HTTPException(400, "Odoo is not connected. Connect it from the Odoo page first.")
    return conn


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/status", response_model=StatusResponse)
async def odoo_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conn = (
        await db.execute(
            select(OdooConnection).where(OdooConnection.user_id == user.id)
        )
    ).scalar_one_or_none()
    if conn is None:
        return StatusResponse(connected=False)
    return StatusResponse(
        connected=True,
        url=conn.url,
        database=conn.database,
        username=conn.username,
        display_name=conn.display_name,
        server_version=conn.server_version,
        last_connected_at=conn.last_connected_at,
    )


@router.post("/connect", response_model=StatusResponse)
async def odoo_connect(
    body: ConnectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Verify the credentials before persisting anything.
    try:
        info = await odoo.test_connection(body.url, body.database, body.username, body.api_key)
    except odoo.OdooAuthError as exc:
        raise HTTPException(401, str(exc))
    except odoo.OdooError as exc:
        raise HTTPException(400, str(exc))

    normalized_url = odoo._normalize_url(body.url)
    now = datetime.now(timezone.utc)

    conn = (
        await db.execute(
            select(OdooConnection).where(OdooConnection.user_id == user.id)
        )
    ).scalar_one_or_none()

    if conn is None:
        conn = OdooConnection(user_id=user.id)
        db.add(conn)

    conn.url = normalized_url
    conn.database = body.database
    conn.username = body.username
    conn.api_key_encrypted = odoo.encrypt_secret(body.api_key)
    conn.display_name = info.get("display_name")
    conn.server_version = info.get("server_version")
    conn.last_connected_at = now

    await db.commit()
    await db.refresh(conn)

    return StatusResponse(
        connected=True,
        url=conn.url,
        database=conn.database,
        username=conn.username,
        display_name=conn.display_name,
        server_version=conn.server_version,
        last_connected_at=conn.last_connected_at,
    )


@router.delete("/disconnect")
async def odoo_disconnect(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conn = (
        await db.execute(
            select(OdooConnection).where(OdooConnection.user_id == user.id)
        )
    ).scalar_one_or_none()
    if conn is not None:
        await db.delete(conn)
        await db.commit()
    return {"status": "disconnected"}


@router.get("/models")
async def odoo_models(_user: User = Depends(get_current_user)):
    """List the curated datasets the user can browse."""
    return {"models": odoo.model_catalog()}


@router.get("/data/{key}")
async def odoo_data(
    key: str,
    search: str | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if key not in odoo.MODEL_CONFIG:
        raise HTTPException(404, f"Unknown dataset '{key}'.")
    conn = await _load_conn(db, user)
    api_key = odoo.decrypt_secret(conn.api_key_encrypted)
    try:
        return await odoo.search_read(
            conn.url, conn.database, conn.username, api_key, key, search, limit
        )
    except odoo.OdooAuthError as exc:
        raise HTTPException(401, str(exc))
    except odoo.OdooError as exc:
        raise HTTPException(400, str(exc))


@router.post("/ingest", response_model=IngestResult)
async def odoo_ingest(
    body: IngestRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
):
    """Ingest Odoo records into the Knowledge Base so they become searchable.

    Pass specific ``ids`` to import selected rows, or omit them to import the
    first ``limit`` rows of the dataset. Byte-identical re-imports are skipped.
    """
    if body.key not in odoo.MODEL_CONFIG:
        raise HTTPException(404, f"Unknown dataset '{body.key}'.")
    conn = await _load_conn(db, user)
    api_key = odoo.decrypt_secret(conn.api_key_encrypted)
    try:
        rows = await odoo.read_records(
            conn.url, conn.database, conn.username, api_key, body.key, body.ids, body.limit
        )
    except odoo.OdooAuthError as exc:
        raise HTTPException(401, str(exc))
    except odoo.OdooError as exc:
        raise HTTPException(400, str(exc))

    ingestion = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    imported = skipped = failed = 0
    for row in rows:
        title, body_text = odoo.record_to_text(body.key, row)
        filename = f"odoo-{body.key}-{row.get('id')}.txt"
        try:
            await ingestion.ingest(
                filename=filename,
                raw_bytes=body_text.encode("utf-8"),
                title=title,
                category_id=None,
                is_regulated=False,
                created_by_id=user.id,
            )
            imported += 1
        except DuplicateDocumentError:
            skipped += 1
        except Exception:
            failed += 1
    await db.commit()
    return IngestResult(imported=imported, skipped=skipped, failed=failed)
