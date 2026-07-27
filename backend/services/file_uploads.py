"""Store user-uploaded files in the generated_files store.

Uploads land next to agent-generated artifacts and are served by /api/files/.
Names get an 8-hex prefix so uploads never collide or overwrite each other.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def generated_files_dir() -> Path:
    from services.agent.tools import _GENERATED_FILES_DIR

    return _GENERATED_FILES_DIR


def store_upload(raw: bytes, original_name: str | None) -> tuple[str, str]:
    """Write bytes to the generated_files store. Returns (safe_name, display_name)."""
    display = Path(original_name or "attachment").name or "attachment"
    cleaned = re.sub(r"[^\w.\-]", "_", display).strip("._") or "attachment"
    safe_name = f"{uuid.uuid4().hex[:8]}_{cleaned}"
    target_dir = generated_files_dir()
    target_dir.mkdir(exist_ok=True)
    (target_dir / safe_name).write_bytes(raw)
    return safe_name, display
