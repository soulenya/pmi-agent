"""
File templates — a shared "truth folder" dictating document structure by type.

Source of truth is a Google Drive FOLDER ("PMI Templates"). Every readable doc
in it (subfolders included — e.g. a permission-restricted Regulatory subfolder)
contributes templates:

  - A doc containing `## <type>` headings contributes one template per section.
  - A doc without `##` headings is a single template; its TYPE is the doc name
    (with any "template" suffix stripped — "Memo Template" → "memo").

Adding a template = dropping a new doc in the folder. Nothing else to edit.

Unlike the company context (injected every turn), templates are fetched
ON DEMAND via the get_file_template agent tool right before Gerry creates a
document — so the folder can grow without costing tokens on unrelated turns,
and edits take effect immediately, no release needed. The last good merged
copy is cached in a SystemSetting so templates still work offline.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.settings import SystemSetting

logger = logging.getLogger(__name__)

MAX_TEMPLATES_CHARS = 60_000  # merged cap (defensive; content is external)
MAX_PER_DOC_CHARS = 20_000
MAX_DOCS = 30
MAX_FOLDERS = 10

KEY_MD = "templates.file_md"
KEY_SYNCED_AT = "templates.synced_at"
KEY_DRIVE_FOLDER_ID = "templates.drive_folder_id"


async def _read_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return str(row.value) if row and row.value else default


async def _write_setting(db: AsyncSession, key: str, value: str) -> None:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        row = SystemSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    await db.flush()


async def get_drive_folder_id(db: AsyncSession) -> str:
    """Effective Drive folder ID: local SystemSetting override, else the default
    baked into the build (zero per-user setup)."""
    override = (await _read_setting(db, KEY_DRIVE_FOLDER_ID, "")).strip()
    if override:
        return override
    from config import settings as app_settings

    return (getattr(app_settings, "file_templates_drive_folder_id", "") or "").strip()


def _doc_name_to_type(name: str) -> str:
    """'Memo Template.docx' → 'Memo'; 'SOP template' → 'SOP'."""
    base = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", name)
    base = re.sub(r"\btemplates?\b", "", base, flags=re.IGNORECASE)
    return base.strip(" -_–—") or name


def _collect_folder_markdown(folder_id: str) -> str:
    """Read every doc in the templates folder (recursing into subfolders) and
    merge into one `## type`-sectioned markdown blob. Sync — run in executor."""
    from services.google_service import drive_get_content, drive_list_folder

    parts: list[str] = []
    queue: list[str] = [folder_id]
    seen_folders: set[str] = set()
    docs_read = 0
    while queue and len(seen_folders) < MAX_FOLDERS and docs_read < MAX_DOCS:
        fid = queue.pop(0)
        if fid in seen_folders:
            continue
        seen_folders.add(fid)
        for item in drive_list_folder(fid, max_results=100):
            if item["type"] == "folder":
                queue.append(item["id"])
                continue
            if docs_read >= MAX_DOCS:
                break
            try:
                data = drive_get_content(item["id"], max_chars=MAX_PER_DOC_CHARS)
            except Exception as exc:  # noqa: BLE001 — skip unreadable files
                logger.warning("File templates: could not read '%s': %s", item["name"], exc)
                continue
            content = (data.get("content") or "").strip()
            if not content:
                continue
            docs_read += 1
            if re.search(r"^##\s", content, flags=re.MULTILINE):
                parts.append(content)  # doc provides its own ## sections
            else:
                parts.append(f"## {_doc_name_to_type(item['name'])}\n{content}")
    return "\n\n".join(parts)[:MAX_TEMPLATES_CHARS]


async def _fetch_templates_md(db: AsyncSession) -> str:
    """Current merged templates markdown: live from the Drive folder when
    possible (refreshing the cache), else the cached copy. "" when nothing."""
    folder_id = await get_drive_folder_id(db)
    if folder_id:
        try:
            from services.google_service import get_credentials

            if get_credentials():
                content = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: _collect_folder_markdown(folder_id)
                )
                if content:
                    await _write_setting(db, KEY_MD, content)
                    await _write_setting(
                        db, KEY_SYNCED_AT, datetime.now(timezone.utc).isoformat()
                    )
                    return content
        except Exception as exc:  # noqa: BLE001 — Drive/network errors expected
            logger.warning("File templates: live Drive read failed (%s); using cache.", exc)
    return (await _read_setting(db, KEY_MD, "")).strip()


def _parse_sections(md: str) -> dict[str, str]:
    """Split the markdown into {heading: body} by `## ` headings (case kept)."""
    sections: dict[str, str] = {}
    current: str | None = None
    lines: list[str] = []
    for line in md.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            if current is not None:
                sections[current] = "\n".join(lines).strip()
            current = m.group(1)
            lines = []
        elif current is not None:
            lines.append(line)
    if current is not None:
        sections[current] = "\n".join(lines).strip()
    return sections


def _normalize(name: str) -> str:
    n = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()
    return n[:-1] if n.endswith("s") else n  # naive singular


async def get_file_template(db: AsyncSession, file_type: str) -> str:
    """Human/agent-readable result: the matching template section, or an honest
    explanation (no file configured / no such type + what IS available)."""
    md = await _fetch_templates_md(db)
    if not md:
        return (
            "No templates folder is configured (or it is empty/unreachable). "
            "Proceed with your best professional judgment for structure and format."
        )
    sections = _parse_sections(md)
    if not sections:
        return (
            "The templates folder has no usable templates yet. "
            "Proceed with your best professional judgment."
        )
    want = _normalize(file_type)
    for heading, body in sections.items():
        if _normalize(heading) == want and body:
            return (
                f"TEMPLATE for '{heading}' (from the shared templates folder — "
                f"follow this structure exactly):\n\n{body}"
            )
    available = ", ".join(sections.keys())
    return (
        f"No template found for '{file_type}'. Available template types: {available}. "
        "If none fits, proceed with your best professional judgment."
    )
