"""ERP router — the company's ERP behind ``services.erp``.

Mounted twice: ``/api/erp`` (generic) and ``/api/odoo`` (the path PMI's
frontend has always used; same handlers, same shapes, plus ``provider`` and
``label`` on the status). Connection is per user; the Odoo API key or any
other secret is Fernet-encrypted at rest.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.erp import ErpConnection
from models.db.user import User
from repositories.conversation_repo import ApprovalRepository
from services import erp
from services.documents.ingestion import DocumentIngestionService, DuplicateDocumentError
from services.embeddings.service import EmbeddingService, get_embedding_service_db


# ── Schemas ──────────────────────────────────────────────────────────────────

class ConnectRequest(BaseModel):
    """Either the generic shape (provider + values) or the historical flat Odoo body."""

    provider: str | None = None
    values: dict[str, str] = Field(default_factory=dict)
    url: str | None = None
    database: str | None = None
    username: str | None = None
    api_key: str | None = None

    def resolved(self) -> tuple[str, dict[str, str]]:
        values = dict(self.values)
        for k in ("url", "database", "username", "api_key"):
            v = getattr(self, k)
            if v is not None and k not in values:
                values[k] = v
        return (self.provider or erp.default_key()), values


class StatusResponse(BaseModel):
    connected: bool
    provider: str
    label: str
    url: str | None = None
    database: str | None = None
    username: str | None = None
    display_name: str | None = None
    server_version: str | None = None
    last_connected_at: datetime | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ProviderOut(BaseModel):
    key: str
    label: str
    description: str
    fields: list[dict[str, Any]]
    defaults: dict[str, str]
    supports_writes: bool
    supports_bank_balances: bool


class ProvidersResponse(BaseModel):
    providers: list[ProviderOut]
    default: str


class IngestRequest(BaseModel):
    key: str = Field(..., description="Dataset key, e.g. 'customers' or 'sales'")
    ids: list[int] | None = Field(None, description="Specific record ids; omit for the first rows")
    limit: int = Field(50, ge=1, le=200)


class IngestResult(BaseModel):
    imported: int
    skipped: int
    failed: int


class ProposeActionRequest(BaseModel):
    action: str = Field(..., description="Write action key, e.g. 'confirm_quotation'")
    params: dict[str, Any] = Field(default_factory=dict, description="Action parameters")


class ProposeActionResult(BaseModel):
    approval_id: str
    title: str
    risk_level: str


class BankAccountBalance(BaseModel):
    journal: str
    type: str
    account: str
    balance: float


class BankBalanceResponse(BaseModel):
    accounts: list[BankAccountBalance]
    currency: str
    total: float


# ── Helpers ──────────────────────────────────────────────────────────────────

def _status(conn: ErpConnection | None) -> StatusResponse:
    provider = erp.provider_for(conn)
    if conn is None:
        return StatusResponse(connected=False, provider=provider.key, label=provider.label)
    return StatusResponse(
        connected=True,
        provider=provider.key,
        label=provider.label,
        url=conn.url or None,
        database=conn.database or None,
        username=conn.username or None,
        display_name=conn.display_name,
        server_version=conn.server_version,
        last_connected_at=conn.last_connected_at,
        details=provider.status_details(conn),
    )


async def _require_conn(db: AsyncSession, user: User) -> tuple[ErpConnection, erp.ErpProvider]:
    conn = await erp.load_connection(db, user.id)
    if conn is None:
        provider = erp.provider_for(None)
        if provider.key == "odoo":
            raise HTTPException(400, "Odoo is not connected. Connect it from the Odoo page first.")
        raise HTTPException(400, erp.NOT_CONNECTED)
    return conn, erp.provider_for(conn)


def _http(exc: erp.ErpError) -> HTTPException:
    # 400 (not 401): an ERP auth failure must not log the user out of the app.
    return HTTPException(400, str(exc))


# ── Router factory ───────────────────────────────────────────────────────────

def build_router(prefix: str, tag: str) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    @router.get("/providers", response_model=ProvidersResponse)
    async def providers(_user: User = Depends(get_current_user)):
        return ProvidersResponse(
            providers=[
                ProviderOut(
                    key=p.key, label=p.label, description=p.description,
                    fields=[f.__dict__ for f in p.fields], defaults=p.defaults,
                    supports_writes=p.supports_writes, supports_bank_balances=p.supports_bank_balances,
                )
                for p in erp.available()
            ],
            default=erp.default_key(),
        )

    @router.get("/status", response_model=StatusResponse)
    async def status(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
        return _status(await erp.load_connection(db, user.id))

    @router.post("/connect", response_model=StatusResponse)
    async def connect(
        body: ConnectRequest,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ):
        key, values = body.resolved()
        if key not in {p.key for p in erp.available()} or key == "none":
            raise HTTPException(400, f"Provider '{key}' is not available in this build.")
        provider = erp.get(key)
        try:
            info = await provider.test_connection(values)
        except erp.ErpError as exc:
            raise _http(exc)

        conn = await erp.load_connection(db, user.id)
        if conn is None:
            conn = ErpConnection(user_id=user.id)
            db.add(conn)
        provider.apply_connection(conn, values, info)
        conn.last_connected_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(conn)
        return _status(conn)

    @router.delete("/disconnect")
    async def disconnect(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
        conn = await erp.load_connection(db, user.id)
        if conn is not None:
            await db.delete(conn)
            await db.commit()
        return {"status": "disconnected"}

    @router.get("/models")
    async def models(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
        """The curated datasets the user's provider exposes."""
        provider = erp.provider_for(await erp.load_connection(db, user.id))
        return {"models": provider.datasets(), "provider": provider.key}

    @router.get("/bank-balance", response_model=BankBalanceResponse)
    async def bank_balance(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
        conn, provider = await _require_conn(db, user)
        try:
            return await provider.bank_balances(conn)
        except erp.ErpError as exc:
            raise _http(exc)

    @router.get("/data/{key}")
    async def data(
        key: str,
        search: str | None = None,
        limit: int = 50,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ):
        conn, provider = await _require_conn(db, user)
        if key not in provider.dataset_keys():
            raise HTTPException(404, f"Unknown dataset '{key}'.")
        try:
            return await provider.search_read(conn, key, search, limit)
        except erp.ErpError as exc:
            raise _http(exc)

    @router.post("/ingest", response_model=IngestResult)
    async def ingest(
        body: IngestRequest,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
        embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
    ):
        """Import ERP records into the Knowledge Base; byte-identical re-imports are skipped."""
        conn, provider = await _require_conn(db, user)
        if body.key not in provider.dataset_keys():
            raise HTTPException(404, f"Unknown dataset '{body.key}'.")
        try:
            rows = await provider.read_records(conn, body.key, body.ids, body.limit)
        except erp.ErpError as exc:
            raise _http(exc)

        ingestion = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
        imported = skipped = failed = 0
        for row in rows:
            title, body_text = provider.record_to_text(body.key, row)
            filename = f"{provider.key}-{body.key}-{row.get('id')}.txt"
            try:
                await ingestion.ingest(
                    filename=filename,
                    raw_bytes=body_text.encode("utf-8"),
                    title=title,
                    category_id=None,
                    is_regulated=False,
                    created_by_id=user.id,
                    source_type=provider.key,
                )
                imported += 1
            except DuplicateDocumentError:
                skipped += 1
            except Exception:
                failed += 1
        await db.commit()
        return IngestResult(imported=imported, skipped=skipped, failed=failed)

    @router.post("/actions/propose", response_model=ProposeActionResult)
    async def propose_action(
        body: ProposeActionRequest,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ):
        """Queue a write for human approval; nothing is written here."""
        conn, provider = await _require_conn(db, user)
        try:
            provider.validate_write(body.action, body.params)
        except erp.ErpError as exc:
            raise _http(exc)
        title, description = provider.describe_write(body.action, body.params)
        intent = await ApprovalRepository(db).create(
            user_id=user.id,
            intent_type=f"{provider.key}_write",
            intent_title=title[:500],
            intent_description=description,
            intent_payload={"action": body.action, "params": body.params, "provider": provider.key},
            risk_level=provider.default_risk(body.action),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=72),
        )
        await db.commit()
        return ProposeActionResult(approval_id=str(intent.id), title=title, risk_level=intent.risk_level)

    return router


router = build_router("/api/erp", "erp")
odoo_router = build_router("/api/odoo", "odoo")
