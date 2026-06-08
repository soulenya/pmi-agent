"""Regulatory file explorer API.

A self-referential folder/file tree (``regulatory_nodes``) backed by a local
on-disk store. Everyone can browse/read; only users with regulatory write
permission (or admins) can create folders, upload, import from Drive, edit,
rename, move, or delete.

File bytes live under ``~/.pmi-agent/regulatory/`` keyed by a stable
``{uuid}{ext}`` name, so renames and moves only touch the database.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_regulatory_write
from models.db.regulatory import RegulatoryNode
from models.db.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/regulatory-files", tags=["regulatory-files"])

# ── Local store ────────────────────────────────────────────────────────────────

REG_STORE = Path.home() / ".pmi-agent" / "regulatory"
REG_STORE.mkdir(parents=True, exist_ok=True)

# Extensions whose content can be viewed/edited as plain text in the browser.
TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".yaml", ".yml",
    ".html", ".htm", ".css", ".js", ".ts", ".log", ".rst", ".ini", ".cfg",
}

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_TEXT_EDIT_BYTES = 2 * 1024 * 1024  # 2 MB


# ── Schemas ────────────────────────────────────────────────────────────────────

class NodeOut(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    node_type: str
    name: str
    size_bytes: int | None = None
    mime_type: str | None = None
    extension: str | None = None
    source_type: str | None = None
    source_url: str | None = None
    source_modified_at: datetime | None = None
    is_editable: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class Breadcrumb(BaseModel):
    id: uuid.UUID | None
    name: str


class ListingOut(BaseModel):
    parent_id: uuid.UUID | None
    breadcrumb: list[Breadcrumb]
    nodes: list[NodeOut]


class CreateFolderRequest(BaseModel):
    name: str
    parent_id: uuid.UUID | None = None


class NodePatch(BaseModel):
    name: str | None = None
    # When ``move`` is True, ``parent_id`` is applied (None = move to root).
    parent_id: uuid.UUID | None = None
    move: bool = False


class ImportDriveRequest(BaseModel):
    file_id: str
    parent_id: uuid.UUID | None = None


class TextContentOut(BaseModel):
    id: uuid.UUID
    name: str
    content: str


class SaveTextRequest(BaseModel):
    content: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _to_out(node: RegulatoryNode) -> NodeOut:
    out = NodeOut.model_validate(node)
    out.is_editable = (
        node.node_type == "file" and (node.extension or "").lower() in TEXT_EXTENSIONS
    )
    return out


def _store_path(stored_filename: str) -> Path:
    """Resolve a stored filename to a path inside REG_STORE (traversal-safe)."""
    p = (REG_STORE / stored_filename).resolve()
    if not str(p).startswith(str(REG_STORE.resolve())):
        raise HTTPException(status_code=400, detail="Invalid stored file path.")
    return p


def _ext_of(name: str) -> str:
    return name[name.rfind("."):].lower() if "." in name else ""


async def _get_folder(db: AsyncSession, parent_id: uuid.UUID | None) -> RegulatoryNode | None:
    """Validate a parent id refers to an existing folder; return it (or None for root)."""
    if parent_id is None:
        return None
    parent = await db.get(RegulatoryNode, parent_id)
    if parent is None or parent.node_type != "folder":
        raise HTTPException(status_code=404, detail="Parent folder not found.")
    return parent


async def _dedupe_name(db: AsyncSession, parent_id: uuid.UUID | None, name: str) -> str:
    """Return ``name`` or a suffixed variant so it's unique within ``parent_id``."""
    existing = await _sibling_names(db, parent_id)
    if name.lower() not in existing:
        return name
    stem, ext = (name[: name.rfind(".")], name[name.rfind("."):]) if "." in name else (name, "")
    i = 1
    while f"{stem} ({i}){ext}".lower() in existing:
        i += 1
    return f"{stem} ({i}){ext}"


async def _sibling_names(
    db: AsyncSession, parent_id: uuid.UUID | None, exclude_id: uuid.UUID | None = None
) -> set[str]:
    stmt = select(RegulatoryNode.name)
    stmt = stmt.where(RegulatoryNode.parent_id == parent_id) if parent_id is not None \
        else stmt.where(RegulatoryNode.parent_id.is_(None))
    if exclude_id is not None:
        stmt = stmt.where(RegulatoryNode.id != exclude_id)
    rows = (await db.execute(stmt)).scalars().all()
    return {n.lower() for n in rows}


async def _build_breadcrumb(db: AsyncSession, node: RegulatoryNode | None) -> list[Breadcrumb]:
    crumbs: list[Breadcrumb] = [Breadcrumb(id=None, name="Regulatory")]
    chain: list[RegulatoryNode] = []
    cur = node
    while cur is not None:
        chain.append(cur)
        cur = await db.get(RegulatoryNode, cur.parent_id) if cur.parent_id else None
    for n in reversed(chain):
        crumbs.append(Breadcrumb(id=n.id, name=n.name))
    return crumbs


async def _is_descendant(db: AsyncSession, node_id: uuid.UUID, maybe_ancestor_id: uuid.UUID) -> bool:
    """True if ``maybe_ancestor_id`` is ``node_id`` itself or sits below it."""
    cur_id: uuid.UUID | None = maybe_ancestor_id
    while cur_id is not None:
        if cur_id == node_id:
            return True
        parent = await db.get(RegulatoryNode, cur_id)
        cur_id = parent.parent_id if parent else None
    return False


# ── Browse / read ──────────────────────────────────────────────────────────────

@router.get("", response_model=ListingOut)
async def list_nodes(
    parent_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ListingOut:
    parent = await _get_folder(db, parent_id)

    stmt = select(RegulatoryNode)
    stmt = stmt.where(RegulatoryNode.parent_id == parent_id) if parent_id is not None \
        else stmt.where(RegulatoryNode.parent_id.is_(None))
    # Folders first, then alphabetical
    stmt = stmt.order_by(RegulatoryNode.node_type.desc(), func.lower(RegulatoryNode.name))
    nodes = (await db.execute(stmt)).scalars().all()

    return ListingOut(
        parent_id=parent_id,
        breadcrumb=await _build_breadcrumb(db, parent),
        nodes=[_to_out(n) for n in nodes],
    )


@router.get("/{node_id}/download")
async def download_node(
    node_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> FileResponse:
    node = await db.get(RegulatoryNode, node_id)
    if node is None or node.node_type != "file" or not node.stored_filename:
        raise HTTPException(status_code=404, detail="File not found.")
    path = _store_path(node.stored_filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File contents missing on disk.")
    return FileResponse(
        path,
        filename=node.name,
        media_type=node.mime_type or "application/octet-stream",
    )


@router.get("/{node_id}/text", response_model=TextContentOut)
async def get_text(
    node_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> TextContentOut:
    node = await db.get(RegulatoryNode, node_id)
    if node is None or node.node_type != "file" or not node.stored_filename:
        raise HTTPException(status_code=404, detail="File not found.")
    if (node.extension or "").lower() not in TEXT_EXTENSIONS:
        raise HTTPException(status_code=415, detail="This file type can't be edited as text.")
    path = _store_path(node.stored_filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File contents missing on disk.")
    raw = path.read_bytes()
    return TextContentOut(id=node.id, name=node.name, content=raw.decode("utf-8", errors="replace"))


# ── Create / import (write) ────────────────────────────────────────────────────

@router.post("/folder", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
async def create_folder(
    body: CreateFolderRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_regulatory_write),
) -> NodeOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name is required.")
    await _get_folder(db, body.parent_id)
    name = await _dedupe_name(db, body.parent_id, name)
    node = RegulatoryNode(
        parent_id=body.parent_id,
        node_type="folder",
        name=name,
        source_type="folder",
        created_by=user.id,
    )
    db.add(node)
    await db.flush()
    await db.refresh(node)
    await db.commit()
    return _to_out(node)


@router.post("/upload", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    parent_id: uuid.UUID | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_regulatory_write),
) -> NodeOut:
    await _get_folder(db, parent_id)
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 50 MB limit.")

    name = await _dedupe_name(db, parent_id, (file.filename or "upload").strip())
    ext = _ext_of(name)
    stored = f"{uuid.uuid4().hex}{ext}"
    _store_path(stored).write_bytes(raw)

    node = RegulatoryNode(
        parent_id=parent_id,
        node_type="file",
        name=name,
        stored_filename=stored,
        size_bytes=len(raw),
        mime_type=file.content_type or "application/octet-stream",
        extension=ext,
        source_type="upload",
        created_by=user.id,
    )
    db.add(node)
    await db.flush()
    await db.refresh(node)
    await db.commit()
    return _to_out(node)


@router.post("/import-drive", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
async def import_from_drive(
    body: ImportDriveRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_regulatory_write),
) -> NodeOut:
    await _get_folder(db, body.parent_id)

    from services import google_service

    try:
        dl = google_service.drive_download_bytes(body.file_id)
    except Exception as exc:  # surface a real message to the UI
        logger.warning("Drive download failed for %s: %s", body.file_id, exc)
        raise HTTPException(status_code=502, detail=f"Drive import failed: {exc}") from exc

    raw: bytes = dl["content"] or b""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 50 MB limit.")

    name = await _dedupe_name(db, body.parent_id, dl["name"])
    ext = (dl.get("extension") or _ext_of(name)).lower()
    stored = f"{uuid.uuid4().hex}{ext}"
    _store_path(stored).write_bytes(raw)

    modified = None
    if dl.get("modified"):
        try:
            modified = datetime.fromisoformat(dl["modified"].replace("Z", "+00:00"))
        except ValueError:
            modified = None

    node = RegulatoryNode(
        parent_id=body.parent_id,
        node_type="file",
        name=name,
        stored_filename=stored,
        size_bytes=len(raw),
        mime_type=dl.get("mime_type") or "application/octet-stream",
        extension=ext,
        source_type="google_drive",
        source_file_id=body.file_id,
        source_url=dl.get("url"),
        source_modified_at=modified,
        created_by=user.id,
    )
    db.add(node)
    await db.flush()
    await db.refresh(node)
    await db.commit()
    return _to_out(node)


# ── Edit / rename / move (write) ───────────────────────────────────────────────

@router.put("/{node_id}/text", response_model=NodeOut)
async def save_text(
    node_id: uuid.UUID,
    body: SaveTextRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_regulatory_write),
) -> NodeOut:
    node = await db.get(RegulatoryNode, node_id)
    if node is None or node.node_type != "file" or not node.stored_filename:
        raise HTTPException(status_code=404, detail="File not found.")
    if (node.extension or "").lower() not in TEXT_EXTENSIONS:
        raise HTTPException(status_code=415, detail="This file type can't be edited as text.")
    raw = body.content.encode("utf-8")
    if len(raw) > MAX_TEXT_EDIT_BYTES:
        raise HTTPException(status_code=413, detail="Text exceeds the 2 MB edit limit.")
    _store_path(node.stored_filename).write_bytes(raw)
    node.size_bytes = len(raw)
    node.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(node)
    await db.commit()
    return _to_out(node)


@router.patch("/{node_id}", response_model=NodeOut)
async def update_node(
    node_id: uuid.UUID,
    body: NodePatch,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_regulatory_write),
) -> NodeOut:
    node = await db.get(RegulatoryNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Item not found.")

    target_parent = node.parent_id
    if body.move:
        # Validate destination folder and prevent cycles.
        await _get_folder(db, body.parent_id)
        if body.parent_id is not None and await _is_descendant(db, node.id, body.parent_id):
            raise HTTPException(status_code=400, detail="Can't move a folder into itself.")
        target_parent = body.parent_id

    new_name = node.name
    if body.name is not None:
        new_name = body.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Name can't be empty.")
        # Preserve a file's extension if the user dropped it
        if node.node_type == "file" and node.extension and not new_name.lower().endswith(node.extension):
            if "." not in new_name:
                new_name = f"{new_name}{node.extension}"

    # Conflict check against destination siblings (excluding self)
    siblings = await _sibling_names(db, target_parent, exclude_id=node.id)
    if new_name.lower() in siblings:
        raise HTTPException(status_code=409, detail="An item with that name already exists here.")

    node.name = new_name
    node.parent_id = target_parent
    if node.node_type == "file" and "." in new_name:
        node.extension = _ext_of(new_name)
    node.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(node)
    await db.commit()
    return _to_out(node)


# ── Delete (write) ─────────────────────────────────────────────────────────────

@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(
    node_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_regulatory_write),
) -> None:
    node = await db.get(RegulatoryNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Item not found.")

    # Collect on-disk files for this node and all descendants, then unlink.
    stored_files: list[str] = []
    queue: list[RegulatoryNode] = [node]
    while queue:
        cur = queue.pop()
        if cur.node_type == "file" and cur.stored_filename:
            stored_files.append(cur.stored_filename)
        else:
            children = (
                await db.execute(
                    select(RegulatoryNode).where(RegulatoryNode.parent_id == cur.id)
                )
            ).scalars().all()
            queue.extend(children)

    await db.delete(node)  # DB ON DELETE CASCADE removes descendant rows
    await db.commit()

    for fname in stored_files:
        try:
            p = (REG_STORE / fname).resolve()
            if str(p).startswith(str(REG_STORE.resolve())) and p.exists():
                p.unlink()
        except OSError as exc:
            logger.warning("Failed to delete regulatory file %s: %s", fname, exc)
