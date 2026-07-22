"""Budgets API — personal Drive-backed budgets (two surfaces, one ledger).

The Google Sheet is the system of record; these endpoints write through to
it and serve the refreshed mirror. User writes from this API are always
allowed — the per-budget `gerry_write_enabled` flag gates only the AGENT's
tool writes (Phase 2). NOT an official budget center.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.budget import Budget
from models.db.user import User
from services import budget_service
from services.budget_service import BudgetError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/budgets", tags=["budgets"])


# ── Schemas ──────────────────────────────────────────────────────────────


class BudgetCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    allotment: float | None = Field(None, ge=0)
    currency: str = Field("USD", max_length=8)
    categories: list[str] = Field(default_factory=list)


class BudgetLink(BaseModel):
    file_id: str = Field(..., min_length=10, max_length=500)


class BudgetUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    allotment: float | None = Field(None, ge=0)
    clear_allotment: bool = False
    gerry_write_enabled: bool | None = None


class EntryCreate(BaseModel):
    date: str = Field("", max_length=20)
    description: str = Field(..., min_length=1, max_length=300)
    category: str = Field("", max_length=100)
    amount: float
    note: str = Field("", max_length=500)


class EntryExpected(BaseModel):
    description: str = ""
    amount: float | None = None


class EntryUpdate(BaseModel):
    expected: EntryExpected
    date: str | None = None
    description: str | None = Field(None, max_length=300)
    category: str | None = Field(None, max_length=100)
    amount: float | None = None
    note: str | None = Field(None, max_length=500)


class EntryDelete(BaseModel):
    expected: EntryExpected


class BudgetOut(BaseModel):
    id: uuid.UUID
    title: str
    drive_file_id: str
    drive_url: str
    allotment: float | None
    currency: str
    gerry_write_enabled: bool
    external_readonly: bool
    cached_summary: dict
    cached_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetDetailOut(BudgetOut):
    cached_ledger: list = []
    cached_categories: list = []


# ── Helpers ──────────────────────────────────────────────────────────────


async def _get_owned(db: AsyncSession, budget_id: uuid.UUID, user_id: uuid.UUID) -> Budget:
    b = (
        await db.execute(
            select(Budget).where(Budget.id == budget_id, Budget.user_id == user_id)
        )
    ).scalar_one_or_none()
    if b is None:
        raise HTTPException(404, "Budget not found")
    return b


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("", response_model=list[BudgetOut])
async def list_budgets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BudgetOut]:
    rows = (
        await db.execute(
            select(Budget)
            .where(Budget.user_id == current_user.id)
            .order_by(desc(Budget.updated_at))
        )
    ).scalars()
    return [BudgetOut.model_validate(b) for b in rows]


@router.post("", response_model=BudgetDetailOut, status_code=status.HTTP_201_CREATED)
async def create_budget(
    body: BudgetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetDetailOut:
    try:
        budget = await budget_service.create_budget(
            db, current_user.id, body.title, body.allotment, body.currency, body.categories
        )
    except BudgetError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return BudgetDetailOut.model_validate(budget)


@router.post("/link", response_model=BudgetDetailOut, status_code=status.HTTP_201_CREATED)
async def link_budget(
    body: BudgetLink,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetDetailOut:
    try:
        budget = await budget_service.link_external_budget(db, current_user.id, body.file_id)
    except BudgetError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return BudgetDetailOut.model_validate(budget)


@router.get("/{budget_id}", response_model=BudgetDetailOut)
async def get_budget(
    budget_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetDetailOut:
    budget = await _get_owned(db, budget_id, current_user.id)
    # Two-surface contract: every read checks Drive's modifiedTime so edits
    # made directly in Google Sheets appear here without manual action.
    try:
        await budget_service.refresh_budget(db, budget)
        await db.commit()
    except BudgetError:
        logger.warning("Budget %s refresh failed; serving cache", budget_id)
    return BudgetDetailOut.model_validate(budget)


@router.post("/{budget_id}/refresh", response_model=BudgetDetailOut)
async def refresh_budget(
    budget_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetDetailOut:
    budget = await _get_owned(db, budget_id, current_user.id)
    try:
        await budget_service.refresh_budget(db, budget, force=True)
    except BudgetError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return BudgetDetailOut.model_validate(budget)


@router.patch("/{budget_id}", response_model=BudgetDetailOut)
async def update_budget(
    budget_id: uuid.UUID,
    body: BudgetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetDetailOut:
    budget = await _get_owned(db, budget_id, current_user.id)
    if body.gerry_write_enabled is not None:
        budget.gerry_write_enabled = body.gerry_write_enabled
    try:
        if body.title or body.allotment is not None or body.clear_allotment:
            await budget_service.update_settings(
                db,
                budget,
                title=body.title,
                allotment=(None if body.clear_allotment else (body.allotment if body.allotment is not None else ...)),
            )
    except BudgetError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return BudgetDetailOut.model_validate(budget)


@router.delete("/{budget_id}")
async def unlink_budget(
    budget_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Unlink from Little Gerry. The spreadsheet on Drive is NEVER deleted —
    the user keeps full ownership of their data."""
    budget = await _get_owned(db, budget_id, current_user.id)
    url = budget.drive_url
    await db.delete(budget)
    await db.commit()
    return {"unlinked": str(budget_id), "sheet_kept_at": url}


@router.post("/{budget_id}/entries", response_model=BudgetDetailOut, status_code=201)
async def add_entry(
    budget_id: uuid.UUID,
    body: EntryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetDetailOut:
    budget = await _get_owned(db, budget_id, current_user.id)
    try:
        await budget_service.add_entry(
            db,
            budget,
            date=body.date or datetime.now().strftime("%Y-%m-%d"),
            description=body.description,
            amount=body.amount,
            category=body.category,
            note=body.note,
            source="user",
        )
    except BudgetError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return BudgetDetailOut.model_validate(budget)


@router.patch("/{budget_id}/entries/{row_index}", response_model=BudgetDetailOut)
async def update_entry(
    budget_id: uuid.UUID,
    row_index: int,
    body: EntryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetDetailOut:
    budget = await _get_owned(db, budget_id, current_user.id)
    fields = {
        k: v
        for k, v in {
            "date": body.date, "description": body.description,
            "category": body.category, "amount": body.amount, "note": body.note,
        }.items()
        if v is not None
    }
    if not fields:
        raise HTTPException(422, "Nothing to update.")
    try:
        await budget_service.update_entry(
            db, budget, row_index, body.expected.model_dump(), fields
        )
    except BudgetError as exc:
        raise HTTPException(409, str(exc))
    await db.commit()
    return BudgetDetailOut.model_validate(budget)


@router.post("/{budget_id}/entries/{row_index}/delete", response_model=BudgetDetailOut)
async def delete_entry(
    budget_id: uuid.UUID,
    row_index: int,
    body: EntryDelete,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetDetailOut:
    budget = await _get_owned(db, budget_id, current_user.id)
    try:
        await budget_service.delete_entry(db, budget, row_index, body.expected.model_dump())
    except BudgetError as exc:
        raise HTTPException(409, str(exc))
    await db.commit()
    return BudgetDetailOut.model_validate(budget)
