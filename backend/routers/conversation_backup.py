"""Conversation backup router (Phase 5).

Tamper-evident, append-only conversation backups: read status/history,
change the schedule, trigger a manual backup, verify chain integrity, and
download a signed backup file.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services import conversation_backup as cb

router = APIRouter(prefix="/api/backups", tags=["backups"])


class BackupSettings(BaseModel):
    enabled: bool | None = None
    hour: int | None = Field(default=None, ge=0, le=23)
    drive_folder_id: str | None = None


def _google_connected() -> bool:
    try:
        from services.google_service import get_credentials

        return get_credentials() is not None
    except Exception:
        return False


@router.get("/status")
async def backup_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    config = await cb.get_config(db)
    history = await cb.list_backups(db)
    return {
        "config": config,
        "google_connected": _google_connected(),
        "count": len(history),
        "last": history[0] if history else None,
    }


@router.get("")
async def backup_list(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return {"backups": await cb.list_backups(db)}


@router.put("/settings")
async def backup_settings(
    body: BackupSettings,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return await cb.set_config(
        db,
        enabled=body.enabled,
        hour=body.hour,
        drive_folder_id=body.drive_folder_id,
        user_id=user.id,
    )


@router.post("/run")
async def backup_run(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return await cb.run_backup(db, reason="manual", user_id=user.id)


@router.get("/verify")
async def backup_verify(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return await cb.verify(db)


@router.get("/download/{filename}")
async def backup_download(
    filename: str,
    user: User = Depends(get_current_user),
) -> Response:
    data = cb.read_backup_file(filename)
    if data is None:
        raise HTTPException(status_code=404, detail="Backup file not found.")
    return Response(
        content=data,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
