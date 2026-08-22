"""Whole-install backup and restore.

Distinct from ``conversation_backup``, which ledgers conversations only. This
router moves everything: database, documents, generated files.
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from database import get_db
from dependencies import require_admin
from models.db.user import User
from services import data_transfer as dt

router = APIRouter(prefix="/api/data", tags=["data-transfer"])


@router.get("/summary")
async def data_summary(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict:
    return await dt.summarise(db)


@router.post("/export")
async def data_export(user: User = Depends(require_admin)) -> dict:
    try:
        return await run_in_threadpool(dt.create_export)
    except dt.DataTransferError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/export/{filename}")
async def data_export_download(
    filename: str,
    user: User = Depends(require_admin),
) -> FileResponse:
    try:
        path = dt.safe_archive_path(filename)
    except dt.DataTransferError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, media_type="application/zip", filename=path.name)


@router.delete("/export/{filename}")
async def data_export_delete(
    filename: str,
    user: User = Depends(require_admin),
) -> dict:
    try:
        dt.safe_archive_path(filename).unlink()
    except dt.DataTransferError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/import")
async def data_import(
    file: UploadFile = File(...),
    user: User = Depends(require_admin),
) -> dict:
    """Restore an uploaded archive over this install. Requires a restart after."""
    if not (file.filename or "").endswith(dt.ARCHIVE_SUFFIX):
        raise HTTPException(status_code=400, detail="Choose a .lgbackup file.")

    with tempfile.TemporaryDirectory() as tmp:
        staged = Path(tmp) / "upload.lgbackup"
        with staged.open("wb") as out:
            await run_in_threadpool(shutil.copyfileobj, file.file, out)
        try:
            return await run_in_threadpool(dt.restore_export, staged)
        except dt.DataTransferError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import/inspect")
async def data_import_inspect(
    file: UploadFile = File(...),
    user: User = Depends(require_admin),
) -> dict:
    """Read an archive's manifest without changing anything."""
    with tempfile.TemporaryDirectory() as tmp:
        staged = Path(tmp) / "upload.lgbackup"
        with staged.open("wb") as out:
            await run_in_threadpool(shutil.copyfileobj, file.file, out)
        try:
            manifest = await run_in_threadpool(dt.read_manifest, staged)
        except dt.DataTransferError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    manifest["reconnect_required"] = (
        manifest.get("fernet_fingerprint") != dt._key_fingerprint()
    )
    manifest.pop("fernet_fingerprint", None)
    return manifest
