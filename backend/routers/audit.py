"""Audit trail router — read-only access to the append-only event log."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin
from models.db.audit import AuditEvent
from models.db.user import User
from models.schemas.common import ApiResponse, Meta
from services.audit.logger import AuditLogger, get_audit_logger

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditEventOut:
    pass


from pydantic import BaseModel


class AuditEventResponse(BaseModel):
    id: UUID
    sequence_number: int
    event_type: str
    actor_id: UUID | None
    entity_type: str | None
    entity_id: UUID | None
    payload: dict[str, Any] | None
    ip_address: str | None
    record_hash: str
    previous_hash: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/events", response_model=ApiResponse[list[AuditEventResponse]])
async def list_audit_events(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    event_type: str | None = Query(default=None),
    actor_id: UUID | None = Query(default=None),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[list[AuditEventResponse]]:
    stmt = select(AuditEvent).order_by(AuditEvent.sequence_number.desc())

    if event_type:
        stmt = stmt.where(AuditEvent.event_type == event_type)
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_id == actor_id)

    from sqlalchemy import func, select as sa_select
    count_stmt = sa_select(func.count()).select_from(AuditEvent)
    if event_type:
        count_stmt = count_stmt.where(AuditEvent.event_type == event_type)
    if actor_id:
        count_stmt = count_stmt.where(AuditEvent.actor_id == actor_id)

    total = (await db.execute(count_stmt)).scalar_one()
    offset = (page - 1) * page_size

    result = await db.execute(stmt.offset(offset).limit(page_size))
    events = result.scalars().all()

    import math
    meta = Meta(
        page=page,
        page_size=page_size,
        total=total,
        total_pages=math.ceil(total / page_size) if total else 0,
    )
    return ApiResponse.ok(
        [AuditEventResponse.model_validate(e) for e in events],
        meta=meta,
    )


@router.post("/verify", response_model=ApiResponse[dict])
async def verify_audit_chain(
    limit: int = Query(default=1000, ge=1, le=10000),
    _admin: User = Depends(require_admin),
    audit: AuditLogger = Depends(get_audit_logger),
) -> ApiResponse[dict]:
    broken = await audit.verify_chain(limit=limit)
    return ApiResponse.ok(
        {
            "verified": limit,
            "broken_sequences": broken,
            "chain_intact": len(broken) == 0,
        }
    )
