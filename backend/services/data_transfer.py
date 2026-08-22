"""Whole-install export and restore.

Everything the user has built lives in two places: the PostgreSQL volume
(conversations, tasks, workrooms, settings, document metadata and the pgvector
embeddings) and the encrypted document files under STORAGE_ROOT. An uninstall
takes the database volume with it, so this module packs both into one portable
``.lgbackup`` archive and puts them back.

Document bytes are DECRYPTED on export and re-encrypted with the destination
machine's key on import. The Fernet key therefore never leaves the OS keyring,
and an archive still restores onto a machine that has never seen it. Secrets
that are Fernet-encrypted inside the database (Google tokens, Odoo API keys)
cannot survive that move, so they are dropped on a foreign restore and the user
reconnects.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

ARCHIVE_SUFFIX = ".lgbackup"
FORMAT_VERSION = 1

# Bumping this is what tells an older build to refuse an archive it can't read.
_MANIFEST_NAME = "manifest.json"
_DB_MEMBER = "database.dump"
_DOCS_PREFIX = "documents/"
_ATTACHMENTS_PREFIX = "chat-attachments/"
_GENERATED_PREFIX = "generated-files/"

_CONTAINER = "pmi_postgres"
_DB_NAME = "pmi_dev"
_DB_SUPERUSER = "pmi"

# A restore replaces the whole database, so keep the outgoing one for a while.
_PRE_RESTORE_KEEP = 3

_SAFE_NAME = re.compile(r"^[A-Za-z0-9._ -]+$")


class DataTransferError(RuntimeError):
    """Raised for any failure the user should see verbatim."""


# ── locations ────────────────────────────────────────────────────────────────

def storage_root() -> Path:
    root = Path(settings.storage_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def attachments_dir() -> Path:
    return storage_root() / "chat-attachments"


def generated_dir() -> Path:
    from services.file_uploads import generated_files_dir

    return generated_files_dir()


def archive_dir() -> Path:
    """Where produced archives are written, alongside the other backups."""
    d = storage_root().parent / "exports"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _fernet() -> Fernet:
    return Fernet(settings.fernet_key)


def _key_fingerprint() -> str:
    """Identify the local Fernet key without revealing it."""
    return hashlib.sha256(settings.fernet_key.encode()).hexdigest()[:32]


# ── docker / pg helpers ──────────────────────────────────────────────────────

def _docker_ready() -> bool:
    try:
        out = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", _CONTAINER],
            capture_output=True, text=True, timeout=20, check=False,
        )
        return out.returncode == 0 and out.stdout.strip() == "true"
    except Exception:
        return False


def _require_docker() -> None:
    if not _docker_ready():
        raise DataTransferError(
            "The database container isn't running. Start Little Gerry and try again."
        )


def _dump_database(dest: Path) -> None:
    """Write a pg_dump custom-format archive of the whole database to *dest*."""
    _require_docker()
    with dest.open("wb") as fh:
        proc = subprocess.run(
            ["docker", "exec", "-i", _CONTAINER,
             "pg_dump", "-U", _DB_SUPERUSER, "-d", _DB_NAME, "-Fc", "--no-owner", "--no-acl"],
            stdout=fh, stderr=subprocess.PIPE, timeout=1800, check=False,
        )
    if proc.returncode != 0 or dest.stat().st_size == 0:
        detail = (proc.stderr or b"").decode(errors="replace").strip()[:400]
        raise DataTransferError(f"Database export failed. {detail}")


def _restore_database(src: Path) -> None:
    """Replace the current database with the dump at *src*."""
    _require_docker()
    with src.open("rb") as fh:
        proc = subprocess.run(
            ["docker", "exec", "-i", _CONTAINER,
             "pg_restore", "-U", _DB_SUPERUSER, "-d", _DB_NAME,
             "--clean", "--if-exists", "--no-owner", "--no-acl"],
            stdin=fh, capture_output=True, timeout=3600, check=False,
        )
    # pg_restore reports non-zero for benign "does not exist" notices during
    # --clean, so only a missing table count is a real failure.
    if proc.returncode != 0:
        detail = (proc.stderr or b"").decode(errors="replace")
        fatal = [ln for ln in detail.splitlines() if "error:" in ln.lower()
                 and "does not exist" not in ln.lower()]
        if fatal:
            raise DataTransferError("Restore failed. " + " ".join(fatal)[:400])


# ── archive naming ───────────────────────────────────────────────────────────

def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M")


def safe_archive_path(filename: str) -> Path:
    """Resolve *filename* inside the export directory, rejecting traversal."""
    name = os.path.basename(filename or "")
    if not name.endswith(ARCHIVE_SUFFIX) or not _SAFE_NAME.match(name):
        raise DataTransferError("That isn't a Little Gerry backup file name.")
    path = (archive_dir() / name).resolve()
    if path.parent != archive_dir().resolve() or not path.is_file():
        raise DataTransferError("Backup file not found.")
    return path


def list_archives() -> list[dict[str, Any]]:
    out = []
    for p in sorted(archive_dir().glob(f"*{ARCHIVE_SUFFIX}"), reverse=True):
        try:
            st = p.stat()
        except OSError:
            continue
        out.append({
            "filename": p.name,
            "bytes": st.st_size,
            "created_at": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
        })
    return out


# ── summary ──────────────────────────────────────────────────────────────────

def _dir_stats(d: Path, pattern: str = "*") -> tuple[int, int]:
    count = total = 0
    if not d.is_dir():
        return 0, 0
    for p in d.glob(pattern):
        if p.is_file():
            count += 1
            total += p.stat().st_size
    return count, total


async def summarise(db: AsyncSession) -> dict[str, Any]:
    """What an export would contain, for the Settings screen."""
    counts: dict[str, int] = {}
    for label, table in (
        ("conversations", "conversations"),
        ("messages", "messages"),
        ("documents", "documents"),
        ("tasks", "tasks"),
    ):
        try:
            res = await db.execute(text(f"SELECT count(*) FROM {table}"))  # noqa: S608 — fixed literals
            counts[label] = int(res.scalar() or 0)
        except Exception:
            counts[label] = 0

    doc_files, doc_bytes = _dir_stats(storage_root(), "*.enc")
    att_files, att_bytes = _dir_stats(attachments_dir())
    gen_files, gen_bytes = _dir_stats(generated_dir())

    db_bytes = 0
    try:
        res = await db.execute(text("SELECT pg_database_size(current_database())"))
        db_bytes = int(res.scalar() or 0)
    except Exception:
        pass

    return {
        "counts": counts,
        "database_bytes": db_bytes,
        "document_files": doc_files + att_files,
        "document_bytes": doc_bytes + att_bytes,
        "generated_files": gen_files,
        "generated_bytes": gen_bytes,
        "docker_running": _docker_ready(),
        "directory": str(archive_dir()),
        "archives": list_archives(),
    }


# ── export ───────────────────────────────────────────────────────────────────

def _add_decrypted(zf: zipfile.ZipFile, src: Path, member: str, fernet: Fernet) -> bool:
    """Decrypt *src* into the archive. Returns False if it can't be read."""
    try:
        zf.writestr(member, fernet.decrypt(src.read_bytes()))
        return True
    except (InvalidToken, OSError):
        logger.warning("Skipping unreadable encrypted file: %s", src.name)
        return False


def create_export() -> dict[str, Any]:
    """Build a portable archive of the whole install. Returns its metadata."""
    _require_docker()
    dest = archive_dir() / f"little-gerry_{_timestamp()}{ARCHIVE_SUFFIX}"
    fernet = _fernet()
    skipped = 0

    with tempfile.TemporaryDirectory() as tmp:
        dump = Path(tmp) / "db.dump"
        _dump_database(dump)

        partial = dest.with_suffix(".partial")
        try:
            with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
                zf.write(dump, _DB_MEMBER)

                docs = 0
                for p in storage_root().glob("*.enc"):
                    # STORAGE_ROOT/{doc_id}{ext}.enc -> documents/{doc_id}{ext}
                    if _add_decrypted(zf, p, _DOCS_PREFIX + p.name[:-4], fernet):
                        docs += 1
                    else:
                        skipped += 1

                attachments = 0
                for p in attachments_dir().glob("*.enc"):
                    if _add_decrypted(zf, p, _ATTACHMENTS_PREFIX + p.name[:-4], fernet):
                        attachments += 1
                    else:
                        skipped += 1

                generated = 0
                for p in generated_dir().glob("*"):
                    if p.is_file():
                        zf.write(p, _GENERATED_PREFIX + p.name)
                        generated += 1

                manifest = {
                    "format_version": FORMAT_VERSION,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "app_version": _app_version(),
                    "fernet_fingerprint": _key_fingerprint(),
                    "documents": docs,
                    "attachments": attachments,
                    "generated_files": generated,
                    "skipped_files": skipped,
                }
                zf.writestr(_MANIFEST_NAME, json.dumps(manifest, indent=2))

            partial.replace(dest)
        except Exception:
            partial.unlink(missing_ok=True)
            raise

    st = dest.stat()
    logger.info("Export written: %s (%s bytes)", dest.name, st.st_size)
    return {
        "filename": dest.name,
        "path": str(dest),
        "bytes": st.st_size,
        "created_at": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
        "skipped_files": skipped,
    }


def _app_version() -> str:
    try:
        return (Path(__file__).resolve().parents[2] / "VERSION").read_text().strip()
    except Exception:
        return "unknown"


# ── import ───────────────────────────────────────────────────────────────────

def _safe_member(name: str, prefix: str) -> str | None:
    """Return the bare filename for an archive member, or None if unsafe."""
    if not name.startswith(prefix):
        return None
    rest = name[len(prefix):]
    if not rest or "/" in rest or "\\" in rest or rest.startswith("."):
        return None
    if not _SAFE_NAME.match(rest):
        return None
    return rest


def read_manifest(archive: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(archive) as zf:
            raw = zf.read(_MANIFEST_NAME)
    except KeyError:
        raise DataTransferError("That file isn't a Little Gerry backup.") from None
    except zipfile.BadZipFile:
        raise DataTransferError("That file is not a readable backup archive.") from None
    try:
        manifest = json.loads(raw)
    except ValueError:
        raise DataTransferError("The backup's manifest is damaged.") from None
    if int(manifest.get("format_version", 0)) > FORMAT_VERSION:
        raise DataTransferError(
            "That backup was made by a newer version of Little Gerry. Update, then restore."
        )
    return manifest


def _prune_pre_restore() -> None:
    saves = sorted(archive_dir().glob(f"pre-restore_*{ARCHIVE_SUFFIX}"), reverse=True)
    for old in saves[_PRE_RESTORE_KEEP:]:
        old.unlink(missing_ok=True)


def restore_export(archive: Path) -> dict[str, Any]:
    """Replace the install's data with the contents of *archive*.

    The current database is dumped first so a bad restore is recoverable.
    """
    _require_docker()
    manifest = read_manifest(archive)

    safety = archive_dir() / f"pre-restore_{_timestamp()}{ARCHIVE_SUFFIX}"
    with tempfile.TemporaryDirectory() as tmp:
        previous = Path(tmp) / "previous.dump"
        _dump_database(previous)
        with zipfile.ZipFile(safety, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            zf.write(previous, _DB_MEMBER)
            zf.writestr(_MANIFEST_NAME, json.dumps({
                "format_version": FORMAT_VERSION,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "app_version": _app_version(),
                "fernet_fingerprint": _key_fingerprint(),
                "note": "Database only — taken automatically before a restore.",
            }, indent=2))
        _prune_pre_restore()

        with zipfile.ZipFile(archive) as zf:
            db_member = Path(tmp) / "restore.dump"
            with zf.open(_DB_MEMBER) as src, db_member.open("wb") as out:
                shutil.copyfileobj(src, out)
            _restore_database(db_member)

            fernet = _fernet()
            restored = {"documents": 0, "attachments": 0, "generated_files": 0}
            for member in zf.namelist():
                if (name := _safe_member(member, _DOCS_PREFIX)):
                    target = storage_root() / f"{name}.enc"
                    target.write_bytes(fernet.encrypt(zf.read(member)))
                    restored["documents"] += 1
                elif (name := _safe_member(member, _ATTACHMENTS_PREFIX)):
                    attachments_dir().mkdir(parents=True, exist_ok=True)
                    target = attachments_dir() / f"{name}.enc"
                    target.write_bytes(fernet.encrypt(zf.read(member)))
                    restored["attachments"] += 1
                elif (name := _safe_member(member, _GENERATED_PREFIX)):
                    d = generated_dir()
                    d.mkdir(parents=True, exist_ok=True)
                    (d / name).write_bytes(zf.read(member))
                    restored["generated_files"] += 1

    foreign = manifest.get("fernet_fingerprint") != _key_fingerprint()
    if foreign:
        _drop_undecryptable_secrets()

    logger.info("Restore complete from %s (foreign_key=%s)", archive.name, foreign)
    return {
        "restored": restored,
        "reconnect_required": foreign,
        "safety_copy": safety.name,
        "created_at": manifest.get("created_at"),
        "app_version": manifest.get("app_version"),
    }


def _drop_undecryptable_secrets() -> None:
    """Clear DB rows encrypted with a Fernet key this machine doesn't have."""
    sql = (
        "TRUNCATE google_credentials, google_sync_state; "
        "TRUNCATE odoo_connections;"
    )
    proc = subprocess.run(
        ["docker", "exec", "-i", _CONTAINER, "psql", "-U", _DB_SUPERUSER, "-d", _DB_NAME, "-c", sql],
        capture_output=True, timeout=120, check=False,
    )
    if proc.returncode != 0:
        logger.warning("Could not clear foreign-key secrets: %s",
                       (proc.stderr or b"").decode(errors="replace")[:300])
