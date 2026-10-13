"""Company Setup — /company-setup. Admin-only.

Where the company keeps its files on Drive (see services/company_drive.py):
read the current locations, set them by hand, create the standard layout in
a chosen shared drive or folder, publish the ids for other installs, or
adopt the ids an administrator published.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from brand import get_brand
from database import get_db
from dependencies import require_admin
from models.db.user import User
from services import company_drive

logger = logging.getLogger("main")

router = APIRouter(prefix="/company-setup", tags=["company-setup"])


class LocationsIn(BaseModel):
    locations: dict[str, Any] = Field(default_factory=dict)


class CreateLayoutIn(BaseModel):
    parent_id: str = Field(min_length=1, max_length=200)
    with_qms_template: bool = True


class ImportIn(BaseModel):
    overwrite: bool = False


def _google_connected() -> bool:
    from services.google_service import get_credentials

    try:
        return get_credentials() is not None
    except Exception:  # noqa: BLE001
        return False


@router.get("/status")
async def company_status(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    brand = get_brand()
    rows = await company_drive.status(db)
    return {
        "brand": brand.slug,
        "company_name": brand.company_name,
        "company_file": company_drive.company_file_name(),
        "google_connected": _google_connected(),
        "needs_import": company_drive.needs_import(),
        "locations": rows,
        "published_at": await company_drive._read(db, "company.published_at"),
        "imported_at": await company_drive._read(db, "company.imported_at"),
    }


@router.put("/locations")
async def put_locations(
    body: LocationsIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    try:
        await company_drive.set_locations(db, body.locations, admin.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    return {"locations": await company_drive.status(db)}


@router.get("/shared-drives")
async def shared_drives(_admin: User = Depends(require_admin)) -> dict:
    """Shared drives the connected Google account can see — parent choices for the layout."""
    if not _google_connected():
        raise HTTPException(status.HTTP_409_CONFLICT, "Google is not connected on this computer.")
    from services import google_service as gs

    try:
        drives = await asyncio.get_event_loop().run_in_executor(None, gs.drive_list_shared_drives)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Couldn't list shared drives: {exc}") from exc
    return {"drives": drives}


@router.post("/drive/create")
async def create_layout(
    body: CreateLayoutIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    try:
        report = await company_drive.create_layout(
            db, body.parent_id, admin.id, with_qms_template=body.with_qms_template
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Company Drive layout failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Drive refused: {exc}") from exc
    await db.commit()
    return {**report, "locations": await company_drive.status(db)}


@router.post("/publish")
async def publish(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    try:
        result = await company_drive.publish(db, admin.id)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Company file publish failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Drive refused: {exc}") from exc
    await db.commit()
    return result


@router.post("/import")
async def import_locations(
    body: ImportIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    try:
        result = await company_drive.import_from_drive(db, admin.id, overwrite=body.overwrite)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Company file import failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Drive refused: {exc}") from exc
    await db.commit()
    return {**result, "locations": await company_drive.status(db)}
