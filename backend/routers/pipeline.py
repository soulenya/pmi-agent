"""The sales pipeline's routes. Mounted only for a brand with the ``pipeline`` feature.

Every signed-in person at the company can read and work the pipeline; adding a
stage and importing from Odoo are for administrators. A desktop reaches these
through the hub proxy (``/hub/api/pipeline``).
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_admin
from models.db.erp import ErpConnection
from models.db.pipeline import PipelineLead
from models.db.user import User
from services import pipeline as svc
from services.erp.errors import ErpError

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


class StageIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class LeadIn(BaseModel):
    title: str | None = Field(None, max_length=500)
    company: str | None = Field(None, max_length=300)
    contact_name: str | None = Field(None, max_length=300)
    contact_title: str | None = Field(None, max_length=300)
    email: str | None = Field(None, max_length=320)
    phone: str | None = Field(None, max_length=100)
    address: str | None = None
    stage_id: str | None = None
    status: str | None = None
    value: float | None = None
    next_step: str | None = None
    next_step_due: str | None = None
    details: str | None = None


class NoteIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=20000)


class ImportIn(BaseModel):
    dry_run: bool = True


def _bad(exc: svc.PipelineError) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


async def _lead(db: AsyncSession, lead_id: uuid.UUID) -> PipelineLead:
    lead = await svc.lead_row(db, lead_id)
    if lead is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That lead does not exist.")
    return lead


@router.get("/stages")
async def list_stages(db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)) -> list[dict]:
    rows = await svc.stages(db)
    counts = await svc.stage_counts(db)
    return [{"id": str(s.id), "name": s.name, "position": s.position, "open": counts.get(s.id, 0)} for s in rows]


@router.post("/stages", status_code=status.HTTP_201_CREATED)
async def create_stage(
    body: StageIn, db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)
) -> dict:
    try:
        stage = await svc.add_stage(db, body.name)
    except svc.PipelineError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return {"id": str(stage.id), "name": stage.name, "position": stage.position, "open": 0}


@router.get("/overview")
async def get_overview(
    search: str = "",
    stage: str = "",
    lead_id: str = "",
    limit: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """What Gerry reads: counts, matching leads, or one lead in full."""
    return await svc.overview(db, search=search, stage=stage, lead_id=lead_id, limit=limit)


@router.get("/leads")
async def list_leads(
    stage_id: uuid.UUID | None = None,
    lead_status: str | None = Query("open", alias="status"),
    q: str | None = None,
    limit: int = Query(500, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    return await svc.list_leads(db, stage_id=stage_id, status=lead_status, q=q, limit=limit)


@router.post("/leads", status_code=status.HTTP_201_CREATED)
async def create_lead(
    body: LeadIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    try:
        lead = await svc.create_lead(db, user, body.model_dump(exclude_unset=True))
    except svc.PipelineError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return await svc.get_lead(db, lead.id)


@router.get("/leads/{lead_id}")
async def get_lead(
    lead_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
) -> dict:
    out = await svc.get_lead(db, lead_id)
    if out is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That lead does not exist.")
    return out


@router.patch("/leads/{lead_id}")
async def update_lead(
    lead_id: uuid.UUID,
    body: LeadIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    lead = await _lead(db, lead_id)
    try:
        await svc.update_lead(db, user, lead, body.model_dump(exclude_unset=True))
    except svc.PipelineError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return await svc.get_lead(db, lead.id)


@router.post("/leads/{lead_id}/notes", status_code=status.HTTP_201_CREATED)
async def add_note(
    lead_id: uuid.UUID,
    body: NoteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    lead = await _lead(db, lead_id)
    try:
        await svc.add_note(db, user, lead, body.body)
    except svc.PipelineError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return await svc.get_lead(db, lead.id)


@router.post("/import/odoo")
async def import_from_odoo(
    body: ImportIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """Read the leads, stages and notes from Odoo through this administrator's own
    connection and bring across what is not here yet. ``dry_run`` only counts."""
    conn = (
        await db.execute(
            select(ErpConnection).where(ErpConnection.user_id == admin.id, ErpConnection.provider == "odoo")
        )
    ).scalar_one_or_none()
    if conn is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Connect Odoo first: on this server, open the Odoo page and enter your Odoo details.",
        )
    try:
        snapshot = await svc.odoo_snapshot(conn)
    except ErpError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Odoo did not answer: {exc}") from exc
    report = await svc.import_snapshot(db, admin, snapshot, dry_run=body.dry_run)
    if body.dry_run:
        await db.rollback()
    else:
        await db.commit()
    return report
