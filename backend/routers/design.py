"""Design — /design. The company's look as Settings (services/design_tokens).

``GET /design`` is public (the login page needs the logo and accent before
anyone signs in); everything that changes something is admin-only.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin
from models.db.user import User
from services import design_tokens as dt

logger = logging.getLogger("main")

router = APIRouter(prefix="/design", tags=["design"])


class TokensIn(BaseModel):
    tokens: dict[str, Any] = Field(default_factory=dict)


def _full() -> dict:
    t = dt.current()
    return {
        "source": dt.source(),
        "tokens": dt.to_dict(t),
        "defaults": dt.to_dict(dt.DEFAULTS),
        "fonts": dt.available_fonts(),
        "logos": {"light": bool(dt.logo_path("light")), "dark": bool(dt.logo_path("dark"))},
        "contrast": {
            "body_on_white": dt.contrast_ratio(t.body, "FFFFFF"),
            "accent_on_white": dt.contrast_ratio(t.accent, "FFFFFF"),
            "text_on_dark": dt.contrast_ratio(t.dark_text, t.dark_background),
            "body_on_dark": dt.contrast_ratio(t.dark_body, t.dark_background),
            "white_on_app_accent": dt.contrast_ratio("FFFFFF", t.app_accent),
        },
    }


@router.get("")
async def public_design() -> dict:
    """Accent, fonts and which logos exist — enough to paint the shell and login page."""
    return dt.public_view()


@router.get("/logo/{kind}")
async def logo(kind: str):
    path = dt.logo_path(kind)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No logo of that kind is set.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-cache"})


@router.get("/tokens")
async def get_tokens(_admin: User = Depends(require_admin)) -> dict:
    return _full()


@router.put("/tokens")
async def put_tokens(
    body: TokensIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    _tokens, problems = await dt.save(db, {**dt.to_dict(dt.current()), **body.tokens}, admin.id)
    await db.commit()
    return {**_full(), "problems": problems}


@router.post("/reset")
async def reset_tokens(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    await dt.reset(db)
    await db.commit()
    return _full()


@router.post("/logo/{kind}")
async def upload_logo(
    kind: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    raw = await file.read(2 * 1024 * 1024 + 1)
    try:
        name = dt.save_logo(kind, raw)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    key = "logo_light" if kind == "light" else "logo_dark"
    await dt.save(db, {**dt.to_dict(dt.current()), key: name}, admin.id)
    await db.commit()
    return _full()


@router.delete("/logo/{kind}")
async def remove_logo(
    kind: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    if kind not in ("light", "dark"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo kind must be light or dark.")
    key = "logo_light" if kind == "light" else "logo_dark"
    await dt.save(db, {**dt.to_dict(dt.current()), key: ""}, admin.id)
    await db.commit()
    return _full()


@router.post("/fonts")
async def upload_font(
    family: str = Form(...),
    regular: UploadFile = File(...),
    bold: UploadFile = File(...),
    _admin: User = Depends(require_admin),
) -> dict:
    """Upload a Regular + Bold pair for one family (.ttf/.otf, 4 MB each)."""
    try:
        for face, up in (("Regular", regular), ("Bold", bold)):
            raw = await up.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError(f"{face} file is larger than 4 MB.")
            ext = (up.filename or "").rsplit(".", 1)[-1] if "." in (up.filename or "") else ""
            dt.save_font(family, face, raw, ext)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return _full()


@router.get("/font/{family}/{face}")
async def font_file(family: str, face: str):
    """Serve a font file so the Settings preview can render the actual face."""
    files = dt.font_files(family)
    if not files or face not in files:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such font.")
    return FileResponse(files[face], media_type="font/ttf", headers={"Cache-Control": "max-age=86400"})
