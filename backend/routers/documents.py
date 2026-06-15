"""
Document management router.

Endpoints:
  GET    /documents/categories         list all categories
  GET    /documents                    list documents (filterable by category)
  POST   /documents/upload             multipart upload + ingest
  GET    /documents/{doc_id}           get document metadata
  PATCH  /documents/{doc_id}           update title / category / is_regulated
  DELETE /documents/{doc_id}           soft-delete + remove encrypted file
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import get_current_user
from models.db.user import User
from models.schemas.common import ApiResponse, Meta, PaginationParams
from models.schemas.documents import (
    DocumentCategoryOut,
    DocumentChunkOut,
    DocumentCreate,
    DocumentOut,
    DocumentUpdate,
)
from repositories.document_repo import DocumentCategoryRepository, DocumentRepository, DocumentChunkRepository
from services.documents.ingestion import DocumentIngestionService, DuplicateDocumentError
from services.embeddings.service import (
    EmbeddingService,
    get_embedding_service_db,
    get_embedding_service_for_db,
    get_provider_dimension,
    PROVIDER_DIMENSIONS,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


# ── Helpers ───────────────────────────────────────────────────────────────────

def _doc_out(doc) -> DocumentOut:
    return DocumentOut.model_validate(doc)


def _duplicate_detail(existing) -> dict:
    """409 payload describing the existing document a new upload duplicates."""
    return {
        "code": "duplicate_document",
        "message": (
            f"This file is already in the Knowledge Base as \u201c{existing.title}\u201d. "
            f"Import again only if you intend to keep a copy."
        ),
        "existing": {
            "id": str(existing.id),
            "title": existing.title,
            "file_name": existing.file_name,
            "created_at": existing.created_at.isoformat() if existing.created_at else None,
        },
    }


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=ApiResponse[list[DocumentCategoryOut]])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[list[DocumentCategoryOut]]:
    repo = DocumentCategoryRepository(db)
    cats = await repo.list()
    return ApiResponse.ok([DocumentCategoryOut.model_validate(c) for c in cats])


# ── Documents ─────────────────────────────────────────────────────────────────

@router.get("", response_model=ApiResponse[list[DocumentOut]])
async def list_documents(
    pagination: PaginationParams = Depends(),
    category_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[list[DocumentOut]]:
    repo = DocumentRepository(db)
    docs = await repo.list_active(
        category_id=category_id,
        limit=pagination.limit,
        offset=pagination.offset,
    )
    total = await repo.count_active(category_id=category_id)
    return ApiResponse.ok(
        [_doc_out(d) for d in docs],
        meta=Meta(total=total, limit=pagination.limit, offset=pagination.offset),
    )


@router.get("/duplicates", response_model=ApiResponse[dict])
async def scan_duplicates(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[dict]:
    """Manual duplicate scan.

    Groups active documents by SHA-256 and returns every group with 2+ members
    (byte-identical files). Each group is ordered oldest-first so the first entry
    is the original to keep.
    """
    groups = await DocumentRepository(db).find_duplicate_groups()
    out_groups = [
        {
            "checksum": group[0].checksum_sha256,
            "count": len(group),
            "documents": [_doc_out(d) for d in group],
        }
        for group in groups
    ]
    redundant = sum(len(g) - 1 for g in groups)
    return ApiResponse.ok(
        {
            "groups": out_groups,
            "group_count": len(out_groups),
            "redundant_count": redundant,
        }
    )


# ── Drive linking + Knowledge Base manifest (share/portability) ────────────────

def _choose_drive_match(matches: list[dict], size: int | None) -> dict | None:
    """Pick a confident Drive match for a local upload, else None (ambiguous).

    A single name-exact candidate is accepted (size differences just mean a newer
    revision, which "Check for updates" will surface). With multiple candidates we
    only auto-link when exactly one matches the file size.
    """
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    if size is not None:
        size_matches = [m for m in matches if m.get("size") == size]
        if len(size_matches) == 1:
            return size_matches[0]
    return None


@router.post("/link-to-drive", response_model=ApiResponse[dict])
async def link_uploads_to_drive(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[dict]:
    """Match locally-uploaded documents to their Google Drive original and link them.

    For each active document that isn't already linked to a Drive source, search
    Drive for a file with the same name; when a confident match is found, record
    the Drive source linkage so the document becomes update-trackable and can be
    shared via a KB manifest. Content is left untouched (it's the same file).
    """
    import services.google_service as gs
    from datetime import datetime, timezone
    from services.documents.sync import parse_drive_time

    if not gs.get_credentials():
        raise HTTPException(status_code=401, detail="Google account not connected.")

    repo = DocumentRepository(db)
    candidates = await repo.list_unlinked_uploads()
    linked: list[dict] = []
    ambiguous: list[dict] = []
    not_found: list[dict] = []
    now = datetime.now(timezone.utc)

    for doc in candidates:
        name = doc.file_name or ""
        if not name:
            continue
        try:
            matches = gs.drive_find_file_matches(name)
        except Exception as exc:  # noqa: BLE001 - report, keep scanning
            ambiguous.append({"id": str(doc.id), "title": doc.title, "reason": f"Drive search failed: {exc}"})
            continue

        chosen = _choose_drive_match(matches, doc.file_size_bytes)
        if chosen is None:
            if matches:
                ambiguous.append({
                    "id": str(doc.id),
                    "title": doc.title,
                    "file_name": name,
                    "candidates": len(matches),
                })
            else:
                not_found.append({"id": str(doc.id), "title": doc.title, "file_name": name})
            continue

        doc.source_type = "google_drive"
        doc.source_id = chosen["id"]
        doc.source_name = chosen["name"]
        doc.source_modified_at = parse_drive_time(chosen.get("modified", ""))
        doc.last_synced_at = now
        doc.last_checked_at = now
        doc.sync_status = "current"
        doc.sync_detail = None
        linked.append({
            "id": str(doc.id),
            "title": doc.title,
            "drive_url": f"https://drive.google.com/open?id={chosen['id']}",
        })

    await db.commit()
    return ApiResponse.ok({
        "scanned": len(candidates),
        "linked": linked,
        "ambiguous": ambiguous,
        "not_found": not_found,
        "linked_count": len(linked),
        "ambiguous_count": len(ambiguous),
        "not_found_count": len(not_found),
    })


@router.get("/manifest", response_model=ApiResponse[dict])
async def export_manifest(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[dict]:
    """Export a portable manifest of every Drive-linked Knowledge Base document.

    The manifest carries each document's Drive file id (so recipients re-import
    from the shared source and keep update tracking) plus title, category name,
    and regulated flag. Locally-uploaded documents with no Drive link are not
    included — run "Link to Drive" first to bring them in.
    """
    manifest = await _build_manifest(db)
    return ApiResponse.ok(manifest)


@router.post("/manifest/save", response_model=ApiResponse[dict])
async def save_manifest(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[dict]:
    """Write the KB manifest to the user's Downloads folder and return the paths.

    The app runs inside a desktop webview where a browser-style blob download
    silently fails (especially WKWebView on macOS), so the backend — which runs
    on the same machine in this local-first app — writes the files directly.
    """
    import json as _json
    from pathlib import Path

    manifest = await _build_manifest(db)
    if manifest["count"] == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "empty_manifest",
                "message": "No Drive-linked documents to export yet. Run \u201cLink uploads to Drive\u201d first.",
            },
        )

    downloads = Path.home() / "Downloads"
    target_dir = downloads if downloads.is_dir() else Path.home()
    json_path = target_dir / "littlegerry-kb.json"
    md_path = target_dir / "littlegerry-kb.md"

    try:
        json_path.write_text(_json.dumps(manifest, indent=2), encoding="utf-8")
        md_path.write_text(_manifest_markdown(manifest), encoding="utf-8")
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "write_failed", "message": f"Couldn't save the manifest: {exc}"},
        ) from exc

    return ApiResponse.ok({
        "count": manifest["count"],
        "directory": str(target_dir),
        "json_path": str(json_path),
        "md_path": str(md_path),
    })


async def _build_manifest(db: AsyncSession) -> dict:
    """Assemble the portable KB manifest dict from Drive-linked documents."""
    from datetime import datetime, timezone

    repo = DocumentRepository(db)
    cat_repo = DocumentCategoryRepository(db)
    cats = {c.id: c.name for c in await cat_repo.list()}
    docs = await repo.list_drive_linked()

    items = [
        {
            "title": d.title,
            "category": cats.get(d.category_id),
            "is_regulated": d.is_regulated,
            "source_id": d.source_id,
            "source_name": d.source_name or d.file_name,
            "drive_url": f"https://drive.google.com/open?id={d.source_id}",
            "mime_type": d.mime_type,
            "file_name": d.file_name,
        }
        for d in docs
    ]
    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(items),
        "items": items,
    }


def _manifest_markdown(manifest: dict) -> str:
    """Human-readable Markdown table of the manifest with a Drive link per row."""
    count = manifest["count"]
    lines = [
        "# Little Gerry \u2014 Knowledge Base manifest",
        "",
        f"Generated {manifest['generated_at']} \u00b7 {count} document{'' if count == 1 else 's'}.",
        "",
        "**To import:** open Little Gerry \u2192 Knowledge Base \u2192 **Share KB \u2192 Import manifest**, "
        "and choose the `littlegerry-kb.json` file. \u201cCheck for updates\u201d keeps working "
        "because each document stays linked to its Google Drive source.",
        "",
        "| # | Document | Category | Regulated | Drive link |",
        "|---|----------|----------|-----------|------------|",
    ]
    for i, it in enumerate(manifest["items"], start=1):
        cat = it.get("category") or "\u2014"
        reg = "Yes" if it.get("is_regulated") else "\u2014"
        title = (it.get("title") or "").replace("|", "\\|")
        lines.append(f"| {i} | {title} | {cat} | {reg} | [open]({it['drive_url']}) |")
    lines.append("")
    return "\n".join(lines)



class ManifestImportItem(BaseModel):
    source_id: str
    title: str | None = None
    category: str | None = None
    is_regulated: bool = False


class ManifestImportRequest(BaseModel):
    items: list[ManifestImportItem]
    force: bool = False


@router.post("/manifest/import", response_model=ApiResponse[dict])
async def import_manifest(
    req: ManifestImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
) -> ApiResponse[dict]:
    """Import every document listed in a KB manifest from Google Drive.

    Categories are matched by name (created if missing) so they carry across
    different users' databases. Byte-identical documents already present are
    skipped (unless ``force``); per-item failures are reported, not fatal.
    """
    import services.google_service as gs
    from services.documents.drive_import import import_drive_file

    if not gs.get_credentials():
        raise HTTPException(status_code=401, detail="Google account not connected.")

    cat_repo = DocumentCategoryRepository(db)
    # Pre-resolve categories by name once, in the outer transaction.
    cat_cache: dict[str, UUID] = {}
    for name in {i.category for i in req.items if i.category}:
        cat = await cat_repo.get_or_create(name)
        cat_cache[name] = cat.id
    await db.flush()

    imported: list[dict] = []
    skipped: list[dict] = []
    failed: list[dict] = []

    for item in req.items:
        cat_id = cat_cache.get(item.category) if item.category else None
        try:
            async with db.begin_nested():
                doc = await import_drive_file(
                    db=db,
                    embedding_svc=embedding_svc,
                    file_id=item.source_id,
                    title=item.title,
                    category_id=cat_id,
                    is_regulated=item.is_regulated,
                    created_by_id=current_user.id,
                    force=req.force,
                )
            imported.append({"id": str(doc.id), "title": doc.title})
        except DuplicateDocumentError as exc:
            skipped.append({
                "title": item.title or item.source_id,
                "existing": exc.existing.title,
            })
        except Exception as exc:  # noqa: BLE001 - report per item, keep going
            failed.append({"title": item.title or item.source_id, "error": str(exc)})

    await db.commit()
    return ApiResponse.ok({
        "imported": imported,
        "skipped": skipped,
        "failed": failed,
        "imported_count": len(imported),
        "skipped_count": len(skipped),
        "failed_count": len(failed),
    })


@router.post(
    "/upload",
    response_model=ApiResponse[DocumentOut],
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    category_id: UUID | None = Form(None),
    is_regulated: bool = Form(False),
    force: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
) -> ApiResponse[DocumentOut]:
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of {MAX_UPLOAD_BYTES // (1024*1024)} MB",
        )

    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    try:
        doc = await svc.ingest(
            filename=file.filename or "upload",
            raw_bytes=raw,
            title=title.strip(),
            category_id=category_id,
            is_regulated=is_regulated,
            created_by_id=current_user.id,
            allow_duplicate=force,
        )
    except DuplicateDocumentError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_duplicate_detail(exc.existing),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        logger.exception("Document ingestion failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ingestion failed: {exc}",
        )

    await db.commit()
    return ApiResponse.ok(_doc_out(doc))


@router.get("/{doc_id}", response_model=ApiResponse[DocumentOut])
async def get_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[DocumentOut]:
    doc = await DocumentRepository(db).get_active(doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return ApiResponse.ok(_doc_out(doc))


@router.patch("/{doc_id}", response_model=ApiResponse[DocumentOut])
async def update_document(
    doc_id: UUID,
    body: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[DocumentOut]:
    repo = DocumentRepository(db)
    doc = await repo.get_active(doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    updates = body.model_dump(exclude_none=True)
    for k, v in updates.items():
        setattr(doc, k, v)
    await db.flush()
    await db.commit()
    return ApiResponse.ok(_doc_out(doc))


@router.delete("/{doc_id}", response_model=ApiResponse[None])
async def delete_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ApiResponse[None]:
    svc = DocumentIngestionService(
        db=db, embedding_svc=EmbeddingService()
    )
    deleted = await svc.delete(doc_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    await db.commit()
    return ApiResponse.ok(None)


@router.get("/{doc_id}/chunks", response_model=ApiResponse[list[DocumentChunkOut]])
async def list_document_chunks(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[list[DocumentChunkOut]]:
    doc = await DocumentRepository(db).get_active(doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    chunks = await DocumentChunkRepository(db).get_by_document(doc_id)
    return ApiResponse.ok([DocumentChunkOut.model_validate(c) for c in chunks])


@router.post("/{doc_id}/reembed", response_model=ApiResponse[DocumentOut])
async def reembed_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
) -> ApiResponse[DocumentOut]:
    svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)
    try:
        doc = await svc.reembed(doc_id)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Stored file not found — cannot re-embed.",
        )
    except Exception:
        logger.exception("Re-embed failed for doc %s", doc_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Re-embed failed — check server logs",
        )
    await db.commit()
    return ApiResponse.ok(_doc_out(doc))


# ── Source update detection (Google Drive sync) ───────────────────────────────

@router.post("/check-updates")
async def check_document_updates_endpoint(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[dict]:
    """Scan all Drive-linked documents and flag any source changes."""
    from services.documents.sync import check_document_updates

    summary = await check_document_updates(db)
    return ApiResponse.ok(summary)


@router.post("/{doc_id}/apply-update", response_model=ApiResponse[DocumentOut])
async def apply_document_update_endpoint(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
    embedding_svc: EmbeddingService = Depends(get_embedding_service_db),
) -> ApiResponse[DocumentOut]:
    """Re-import a flagged document's current content from Google Drive."""
    from services.documents.sync import apply_document_update

    try:
        doc = await apply_document_update(db, embedding_svc, doc_id)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception:
        logger.exception("Apply-update failed for doc %s", doc_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Apply update failed — check server logs",
        )
    return ApiResponse.ok(_doc_out(doc))


@router.post("/{doc_id}/dismiss-update", response_model=ApiResponse[DocumentOut])
async def dismiss_document_update_endpoint(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[DocumentOut]:
    """Acknowledge a flagged change without re-importing (re-baselines)."""
    from services.documents.sync import dismiss_document_update

    try:
        doc = await dismiss_document_update(db, doc_id)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return ApiResponse.ok(_doc_out(doc))


# ── Knowledge Base Re-index ───────────────────────────────────────────────────

class ReindexRequest(BaseModel):
    provider: str | None = Field(None, pattern="^(ollama|openai|voyage)$")
    model: str | None = Field(None, min_length=1, max_length=100)


@router.post("/reindex")
async def reindex_knowledge_base(
    body: ReindexRequest = ReindexRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """
    Re-embed all documents through the active (or specified) embedding provider.

    Streams Server-Sent Events (SSE):
      data: {"status": "running", "processed": N, "total": M, "doc_title": "..."}
      data: {"status": "done", "processed": N, "total": M}
      data: {"status": "error", "detail": "..."}

    Automatically:
      1. Detects target dimension from provider/model
      2. ALTERs the pgvector column if dimension changed
      3. Deletes all existing chunks
      4. Re-embeds every ready document
      5. Updates system_settings llm.embedding_dimension + llm.kb_needs_reindex
    """
    from sqlalchemy import select, text
    from models.db.settings import SystemSetting
    from models.db.document import Document

    async def _stream():
        import json

        def _event(data: dict) -> str:
            return f"data: {json.dumps(data)}\n\n"

        try:
            # Resolve provider + model
            async def _read(key: str, default: str) -> str:
                row = (await db.execute(
                    select(SystemSetting).where(SystemSetting.key == key)
                )).scalar_one_or_none()
                return str(row.value) if row and row.value else default

            provider = body.provider or await _read("llm.embedding_provider", "ollama")
            model = body.model or await _read("llm.embedding_model", "nomic-embed-text")

            target_dim = get_provider_dimension(provider, model)
            current_dim_str = await _read("llm.embedding_dimension", "768")
            current_dim = int(current_dim_str)

            # ── Step 1: ALTER column if dimension changed ─────────────────────
            if target_dim != current_dim:
                yield _event({
                    "status": "running",
                    "phase": "alter_schema",
                    "detail": f"Changing vector dimension from {current_dim} to {target_dim}…",
                    "processed": 0,
                    "total": 0,
                })
                # Drop existing index first (pgvector requires this for ALTER)
                await db.execute(text(
                    "DROP INDEX IF EXISTS ix_document_chunks_embedding"
                ))
                # ALTER the column — USING NULL resets existing vectors to NULL
                await db.execute(text(
                    f"ALTER TABLE document_chunks "
                    f"ALTER COLUMN embedding TYPE vector({target_dim}) USING NULL"
                ))
                await db.commit()

            # ── Step 2: Delete all existing chunks ────────────────────────────
            chunk_repo = DocumentChunkRepository(db)
            deleted = await chunk_repo.delete_all_chunks()
            await db.commit()

            # ── Step 3: Get all ready document IDs ────────────────────────────
            doc_ids = await chunk_repo.get_all_document_ids_ready()
            total = len(doc_ids)

            if total == 0:
                # Update settings and exit early
                await _update_settings(db, provider, model, target_dim, current_user.id)
                await db.commit()
                yield _event({"status": "done", "processed": 0, "total": 0})
                return

            # ── Step 4: Build embedding service ───────────────────────────────
            try:
                embedding_svc = await get_embedding_service_for_db(db)
            except RuntimeError as exc:
                yield _event({"status": "error", "detail": str(exc)})
                return

            # ── Step 5: Re-embed each document ────────────────────────────────
            doc_repo = DocumentRepository(db)
            ingestion_svc = DocumentIngestionService(db=db, embedding_svc=embedding_svc)

            processed = 0
            for doc_id in doc_ids:
                doc = await doc_repo.get_active(doc_id)
                if doc is None:
                    continue
                try:
                    await ingestion_svc.reembed(doc_id)
                    await db.commit()
                    processed += 1
                    yield _event({
                        "status": "running",
                        "processed": processed,
                        "total": total,
                        "doc_title": doc.title,
                    })
                except Exception as exc:
                    logger.exception("Re-index failed for doc %s", doc_id)
                    yield _event({
                        "status": "error",
                        "detail": f"Failed on '{doc.title}': {exc}",
                        "processed": processed,
                        "total": total,
                    })
                    return

            # ── Step 6: Recreate vector index + update settings ───────────────
            await db.execute(text(
                f"CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding "
                f"ON document_chunks USING ivfflat (embedding vector_cosine_ops)"
            ))
            await _update_settings(db, provider, model, target_dim, current_user.id)
            await db.commit()

            yield _event({"status": "done", "processed": processed, "total": total})

        except Exception as exc:
            logger.exception("Re-index stream error")
            import json
            yield f"data: {json.dumps({'status': 'error', 'detail': str(exc)})}\n\n"

    async def _update_settings(db, provider: str, model: str, dim: int, user_id) -> None:
        from sqlalchemy import select
        from models.db.settings import SystemSetting

        async def _upsert(key: str, value: str) -> None:
            row = (await db.execute(
                select(SystemSetting).where(SystemSetting.key == key)
            )).scalar_one_or_none()
            if row is None:
                db.add(SystemSetting(key=key, value=value, updated_by=user_id))
            else:
                row.value = value
                row.updated_by = user_id
            await db.flush()

        await _upsert("llm.embedding_provider", provider)
        await _upsert("llm.embedding_model", model)
        await _upsert("llm.embedding_dimension", str(dim))
        await _upsert("llm.kb_needs_reindex", "false")

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
