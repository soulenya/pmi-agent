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
from models.db.budget import Budget, BudgetFolder, BudgetReference
from models.db.user import User
from services import budget_folder_service, budget_service
from services.budget_folder_service import BudgetFolderError, folder_extracted_total
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
    gmail_check_enabled: bool | None = None


class FolderLink(BaseModel):
    kind: str = Field(..., pattern="^(invoice|receipt)$")
    ref: str = Field(..., min_length=10, max_length=500)


class FolderUpdate(BaseModel):
    auto_scan: bool | None = None


class ReferenceCreate(BaseModel):
    ref_budget_id: uuid.UUID
    include_as_entry: bool = False


class OdooCompareBody(BaseModel):
    dataset: str = Field("invoices", pattern="^(invoices|sales|purchases|customers|bank_balances)$")
    search: str = Field("", max_length=200)


class FolderOut(BaseModel):
    id: uuid.UUID
    kind: str
    folder_id: str
    folder_name: str
    folder_url: str
    auto_scan: bool
    last_scan_at: datetime | None
    files_scanned: int = 0
    extracted_total: float = 0.0

    @classmethod
    def from_row(cls, f: BudgetFolder) -> "FolderOut":
        return cls(
            id=f.id, kind=f.kind, folder_id=f.folder_id, folder_name=f.folder_name,
            folder_url=f.folder_url, auto_scan=f.auto_scan, last_scan_at=f.last_scan_at,
            files_scanned=len(f.scanned_files or {}),
            extracted_total=folder_extracted_total(f),
        )


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
    gmail_check_enabled: bool = False
    external_readonly: bool
    cached_summary: dict
    cached_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetDetailOut(BudgetOut):
    cached_ledger: list = []
    cached_categories: list = []
    folders: list[FolderOut] = []
    references: list[dict] = []


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


async def _budget_folders(db: AsyncSession, budget_id: uuid.UUID) -> list[BudgetFolder]:
    return list(
        (
            await db.execute(
                select(BudgetFolder)
                .where(BudgetFolder.budget_id == budget_id)
                .order_by(BudgetFolder.created_at)
            )
        ).scalars()
    )


async def _detail_out(db: AsyncSession, budget: Budget) -> BudgetDetailOut:
    out = BudgetDetailOut.model_validate(budget)
    out.folders = [FolderOut.from_row(f) for f in await _budget_folders(db, budget.id)]
    try:
        out.references = await budget_service.sync_budget_references(db, budget)
        out.cached_ledger = budget.cached_ledger or []
        out.cached_summary = budget.cached_summary or {}
        await db.commit()  # ref-row sync writes through to the sheet + mirror
    except Exception:  # noqa: BLE001 — references must never break the read
        logger.exception("Reference sync failed for %s", budget.id)
    return out


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
    return await _detail_out(db, budget)


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
    if body.gmail_check_enabled is not None:
        budget.gmail_check_enabled = body.gmail_check_enabled
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
    return await _detail_out(db, budget)


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


# ── Linked folders (Phase 6 — read-only to Gerry) ─────────────────────


@router.post("/{budget_id}/folders", response_model=FolderOut, status_code=201)
async def link_folder(
    budget_id: uuid.UUID,
    body: FolderLink,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FolderOut:
    budget = await _get_owned(db, budget_id, current_user.id)
    try:
        folder = await budget_folder_service.link_folder(db, budget, body.kind, body.ref)
    except BudgetFolderError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return FolderOut.from_row(folder)


@router.patch("/{budget_id}/folders/{folder_row_id}", response_model=FolderOut)
async def update_folder(
    budget_id: uuid.UUID,
    folder_row_id: uuid.UUID,
    body: FolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FolderOut:
    await _get_owned(db, budget_id, current_user.id)
    folder = (
        await db.execute(
            select(BudgetFolder).where(
                BudgetFolder.id == folder_row_id, BudgetFolder.budget_id == budget_id
            )
        )
    ).scalar_one_or_none()
    if folder is None:
        raise HTTPException(404, "Linked folder not found")
    if body.auto_scan is not None:
        folder.auto_scan = body.auto_scan
    await db.commit()
    return FolderOut.from_row(folder)


@router.delete("/{budget_id}/folders/{folder_row_id}")
async def unlink_folder(
    budget_id: uuid.UUID,
    folder_row_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Unlink only — the Drive folder and its files are never touched."""
    await _get_owned(db, budget_id, current_user.id)
    folder = (
        await db.execute(
            select(BudgetFolder).where(
                BudgetFolder.id == folder_row_id, BudgetFolder.budget_id == budget_id
            )
        )
    ).scalar_one_or_none()
    if folder is None:
        raise HTTPException(404, "Linked folder not found")
    await db.delete(folder)
    await db.commit()
    return {"unlinked": str(folder_row_id)}


@router.post("/{budget_id}/folders/{folder_row_id}/scan")
async def scan_folder(
    budget_id: uuid.UUID,
    folder_row_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """One read-only scan pass (capped per call). New extractable documents
    become accept/dismiss suggestions — nothing is written without consent."""
    budget = await _get_owned(db, budget_id, current_user.id)
    folder = (
        await db.execute(
            select(BudgetFolder).where(
                BudgetFolder.id == folder_row_id, BudgetFolder.budget_id == budget_id
            )
        )
    ).scalar_one_or_none()
    if folder is None:
        raise HTTPException(404, "Linked folder not found")
    try:
        summary = await budget_folder_service.scan_folder(db, budget, folder)
    except BudgetFolderError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return summary


# ── Cross-budget references ─────────────────────────────────────


@router.post("/{budget_id}/references", status_code=201)
async def add_reference(
    budget_id: uuid.UUID,
    body: ReferenceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    budget = await _get_owned(db, budget_id, current_user.id)
    if body.ref_budget_id == budget_id:
        raise HTTPException(400, "A budget can't reference itself.")
    await _get_owned(db, body.ref_budget_id, current_user.id)  # 404 if not yours
    if body.include_as_entry and budget.external_readonly:
        raise HTTPException(
            400,
            "This budget is a read-only linked sheet — it can show references "
            "but Gerry can't write a line item into it.",
        )
    dup = (
        await db.execute(
            select(BudgetReference).where(
                BudgetReference.budget_id == budget_id,
                BudgetReference.ref_budget_id == body.ref_budget_id,
            )
        )
    ).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(409, "That budget is already referenced.")
    if await budget_service.check_reference_cycle(db, budget_id, body.ref_budget_id):
        raise HTTPException(400, "That reference would create a circle of budgets referencing each other.")
    db.add(
        BudgetReference(
            budget_id=budget_id,
            ref_budget_id=body.ref_budget_id,
            include_as_entry=body.include_as_entry,
        )
    )
    await db.flush()
    try:
        await budget_service.sync_budget_references(db, budget)
    except Exception:  # noqa: BLE001
        logger.exception("Initial reference sync failed for %s", budget_id)
    await db.commit()
    return {"linked": str(body.ref_budget_id)}


@router.delete("/{budget_id}/references/{reference_id}")
async def remove_reference(
    budget_id: uuid.UUID,
    reference_id: uuid.UUID,
    remove_row: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    budget = await _get_owned(db, budget_id, current_user.id)
    ref = (
        await db.execute(
            select(BudgetReference).where(
                BudgetReference.id == reference_id,
                BudgetReference.budget_id == budget_id,
            )
        )
    ).scalar_one_or_none()
    if ref is None:
        raise HTTPException(404, "Reference not found")
    row_removed = False
    if remove_row and ref.include_as_entry and not budget.external_readonly:
        row_removed = await budget_service.remove_reference_row(db, budget, ref.ref_budget_id)
    await db.delete(ref)
    await db.commit()
    return {"removed": str(reference_id), "row_removed": row_removed}


# ── Odoo cross-check (advisory, read-only) ───────────────────────────


@router.post("/{budget_id}/odoo-compare")
async def odoo_compare(
    budget_id: uuid.UUID,
    body: OdooCompareBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Advisory side-by-side of this budget vs live Odoo data. Read-only;
    a cross-check, never a reconciliation — the two track different things."""
    import asyncio

    from models.db.odoo import OdooConnection
    from services import odoo_service as odoo

    budget = await _get_owned(db, budget_id, current_user.id)
    conn = (
        await db.execute(
            select(OdooConnection).where(OdooConnection.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    if conn is None:
        raise HTTPException(400, "Odoo is not connected — connect it on the Odoo page first.")
    try:
        await budget_service.refresh_budget(db, budget)
        await db.commit()
    except BudgetError:
        pass  # the cached side still makes an honest comparison

    s = budget.cached_summary or {}
    result: dict = {
        "budget": {
            "title": budget.title,
            "total_spent": s.get("total_spent", 0),
            "allotment": s.get("allotment"),
            "remaining": s.get("remaining"),
            "entry_count": s.get("entry_count", 0),
            "currency": budget.currency,
        },
        "advisory": (
            "Advisory only: a personal ledger and ERP data track different "
            "things and may legitimately differ (timing, scope, untracked items)."
        ),
    }
    try:
        api_key = odoo.decrypt_secret(conn.api_key_encrypted)
        if body.dataset == "bank_balances":
            data = await odoo.bank_balances(conn.url, conn.database, conn.username, api_key)
            result["odoo"] = {
                "label": "Bank & cash balances",
                "total": data.get("total", 0),
                "count": len(data.get("accounts", [])),
                "rows": [
                    f"{a['journal']} ({a['type']}): {a['balance']:,.2f}"
                    for a in data.get("accounts", [])[:10]
                ],
                "currency": data.get("currency", ""),
            }
        else:
            search = body.search.strip() or budget.title
            data = await odoo.search_read(
                conn.url, conn.database, conn.username, api_key, body.dataset, search, 100
            )
            rows = data.get("rows", [])
            total = 0.0
            has_amounts = "amount_total" in data.get("fields", [])
            for row in rows:
                try:
                    total += float(row.get("amount_total") or 0)
                except (TypeError, ValueError):
                    continue
            result["odoo"] = {
                "label": data.get("label", body.dataset),
                "search": search,
                "total": round(total, 2) if has_amounts else None,
                "count": len(rows),
                "rows": [
                    " | ".join(odoo._field_text(row.get(f)) or "—" for f in data.get("fields", []))
                    for row in rows[:10]
                ],
            }
    except odoo.OdooError as exc:
        msg = str(exc)
        if "doesn't exist" in msg:
            raise HTTPException(400, f"Odoo doesn't have the {body.dataset} module installed — try another dataset.")
        raise HTTPException(400, f"Odoo error: {msg[:200]}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Odoo read failed: {str(exc)[:200]}")
    return result
