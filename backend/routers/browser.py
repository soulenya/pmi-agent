"""Research browser — bookmarks, the live page Gerry can see, and save-to-KB.

The browser window itself lives in the desktop shell (launcher.py). The React
app drives it over the pywebview bridge and posts what it reads here.
"""

from __future__ import annotations

import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.browser import BrowserBookmark
from models.db.user import User
from repositories.document_repo import DocumentCategoryRepository
from services import browser_context
from services.documents.ingestion import DocumentIngestionService, DuplicateDocumentError
from services.embeddings.service import EmbeddingService, get_embedding_service_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/browser", tags=["browser"])

# A page saved to the Knowledge Base is stored as markdown, so the same chunking
# and embedding path as any other text document applies.
_KB_CATEGORY = "Web Research"
_MAX_PAGE_CHARS = 400_000


class PageIn(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    title: str = Field(default="", max_length=500)
    text: str = Field(default="")


class FollowIn(BaseModel):
    following: bool


class BookmarkIn(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    title: str = Field(default="", max_length=300)


class SaveToKbIn(PageIn):
    category: str | None = Field(default=None, max_length=100)


def _clean_url(url: str) -> str:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only http and https addresses can be used.",
        )
    return url


def _safe_filename(title: str, url: str) -> str:
    base = (title or "").strip() or re.sub(r"^https?://", "", url)
    base = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", base).strip()
    return (base[:120] or "web page") + ".md"


# ── the page Gerry can see ───────────────────────────────────────────────────

@router.get("/state")
async def get_state(current_user: User = Depends(get_current_user)) -> dict:
    page = browser_context.get_page(current_user.id)
    return {
        "following": browser_context.is_following(current_user.id),
        "page": None
        if page is None
        else {
            "url": page.url,
            "title": page.title,
            "chars": len(page.text),
            "captured_at": page.captured_at.isoformat(),
        },
    }


@router.put("/follow")
async def set_follow(
    body: FollowIn, current_user: User = Depends(get_current_user)
) -> dict:
    browser_context.set_following(current_user.id, body.following)
    return {"following": body.following}


@router.put("/page")
async def set_page(
    body: PageIn, current_user: User = Depends(get_current_user)
) -> dict:
    """Called by the frontend as the user navigates, while following is on."""
    if not browser_context.is_following(current_user.id):
        return {"stored": False}
    browser_context.set_page(
        current_user.id,
        url=_clean_url(body.url),
        title=body.title,
        text=body.text[:_MAX_PAGE_CHARS],
    )
    return {"stored": True}


# ── bookmarks ────────────────────────────────────────────────────────────────

@router.get("/bookmarks")
async def list_bookmarks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    rows = (
        await db.execute(
            select(BrowserBookmark)
            .where(BrowserBookmark.user_id == current_user.id)
            .order_by(BrowserBookmark.created_at.desc())
        )
    ).scalars().all()
    return [
        {"id": str(r.id), "url": r.url, "title": r.title, "created_at": r.created_at.isoformat()}
        for r in rows
    ]


@router.post("/bookmarks", status_code=status.HTTP_201_CREATED)
async def add_bookmark(
    body: BookmarkIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    url = _clean_url(body.url)
    existing = (
        await db.execute(
            select(BrowserBookmark).where(
                BrowserBookmark.user_id == current_user.id,
                BrowserBookmark.url == url,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return {"id": str(existing.id), "url": existing.url, "title": existing.title}

    row = BrowserBookmark(user_id=current_user.id, url=url, title=body.title.strip())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": str(row.id), "url": row.url, "title": row.title}


@router.delete("/bookmarks/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bookmark(
    bookmark_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await db.execute(
        delete(BrowserBookmark).where(
            BrowserBookmark.id == bookmark_id,
            BrowserBookmark.user_id == current_user.id,
        )
    )
    await db.commit()


# ── save the page to the Knowledge Base ──────────────────────────────────────

@router.post("/save-to-kb", status_code=status.HTTP_201_CREATED)
async def save_to_kb(
    body: SaveToKbIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
) -> dict:
    url = _clean_url(body.url)
    text = body.text.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That page had no readable text to save.",
        )

    title = (body.title or "").strip() or url
    markdown = f"# {title}\n\nSource: {url}\n\n---\n\n{text[:_MAX_PAGE_CHARS]}\n"

    category = await DocumentCategoryRepository(db).get_or_create(
        (body.category or _KB_CATEGORY).strip() or _KB_CATEGORY
    )

    try:
        doc = await DocumentIngestionService(db, embedding_svc).ingest(
            filename=_safe_filename(title, url),
            raw_bytes=markdown.encode("utf-8"),
            title=title[:300],
            category_id=category.id,
            is_regulated=False,
            created_by_id=current_user.id,
        )
    except DuplicateDocumentError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That exact page is already in the Knowledge Base.",
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {
        "id": str(doc.id),
        "title": doc.title,
        "chunk_count": doc.chunk_count,
        "category": category.name,
    }
