"""
Generated files router.
Serves files from backend/generated_files/ — created by the AI agent's generate_file tool.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from dependencies import get_current_user
from fastapi import Depends

_FILES_DIR = Path(__file__).resolve().parent.parent / "generated_files"
_FILES_DIR.mkdir(exist_ok=True)

_ALLOWED_EXTENSIONS = {".txt", ".md", ".csv", ".json"}

router = APIRouter(prefix="/api/files", tags=["files"])


def _safe_path(name: str) -> Path:
    """Return resolved path, raising 400 if name is suspicious."""
    if "/" in name or "\\" in name:
        raise HTTPException(400, "Invalid filename")
    p = (_FILES_DIR / name).resolve()
    if not str(p).startswith(str(_FILES_DIR)):
        raise HTTPException(400, "Invalid filename")
    return p


@router.get("")
async def list_files(_user=Depends(get_current_user)):
    """List all generated files, newest first."""
    files = []
    for f in sorted(_FILES_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.is_file() and f.suffix in _ALLOWED_EXTENSIONS:
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "modified": f.stat().st_mtime,
            })
    return {"files": files}


@router.get("/{name}")
async def download_file(name: str, _user=Depends(get_current_user)):
    """Download a generated file."""
    p = _safe_path(name)
    if not p.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(p, filename=name)


@router.delete("/{name}")
async def delete_file(name: str, _user=Depends(get_current_user)):
    """Delete a generated file."""
    p = _safe_path(name)
    if not p.exists():
        raise HTTPException(404, "File not found")
    p.unlink()
    return {"deleted": name}
