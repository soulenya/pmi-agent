"""Conversation auto-backup (Phase 5).

Append-only, tamper-evident snapshots of every chat conversation. Each run:
  1. Serializes all conversations + messages to canonical JSON.
  2. Chains it to the previous backup (SHA-256 hash chain, like the audit log)
     and signs it with an HMAC over a server secret held in the OS keyring.
  3. Writes the signed file to the local backup folder (~/.pmi-agent/backups).
  4. Uploads a copy to the configured Google Drive folder (if connected).

A small ledger (stored in SystemSetting) records each backup's sequence +
hashes so the whole chain can be verified later. No new DB table / migration.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.conversation import Conversation, Message
from models.db.settings import SystemSetting

logger = logging.getLogger("main")

# ── Settings keys ─────────────────────────────────────────────────────────
ENABLED_KEY = "backup.enabled"
HOUR_KEY = "backup.hour"
DRIVE_FOLDER_KEY = "backup.drive_folder_id"
LEDGER_KEY = "backup.ledger"
LAST_RUN_KEY = "backup.last_run"

DEFAULT_ENABLED = False
DEFAULT_HOUR = 2
DEFAULT_DRIVE_FOLDER = "1I57fln_8vYkChX40vPV5pAjAu7Ue-hOG"

_GENESIS_HASH = "0" * 64
_FORMAT_VERSION = 1
_CONTENT_KEYS = (
    "format_version", "sequence", "created_at", "reason",
    "conversation_count", "message_count", "conversations",
)


def backup_dir() -> Path:
    """Return (creating if needed) the local backup folder."""
    d = Path(settings.storage_root).expanduser().parent / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── SystemSetting helpers ─────────────────────────────────────────────────
async def _get(db: AsyncSession, key: str, default):
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return row.value if row is not None and row.value is not None else default


async def _set(db: AsyncSession, key: str, value, user_id=None) -> None:
    # Deep-copy containers so the JSONB column is reliably flagged dirty and
    # only plain JSON-serializable data is stored.
    if isinstance(value, (list, dict)):
        value = json.loads(json.dumps(value, default=str))
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        db.add(SystemSetting(key=key, value=value, updated_by=user_id))
    else:
        row.value = value
        row.updated_by = user_id
    await db.flush()


async def _get_for(db: AsyncSession, owner_id, key: str, default):
    """This person's answer for *key*, falling back to the install-wide value."""
    fallback = await _get(db, key, default)
    if owner_id is None:
        return fallback
    from services import user_settings

    return await user_settings.get(db, owner_id, key, fallback)


async def get_config(db: AsyncSession, owner_id=None) -> dict:
    """On the hub each person keeps their own schedule and Drive folder — a
    backup lands in the Drive of whoever it belongs to."""
    return {
        "enabled": bool(await _get_for(db, owner_id, ENABLED_KEY, DEFAULT_ENABLED)),
        "hour": int(await _get_for(db, owner_id, HOUR_KEY, DEFAULT_HOUR)),
        "drive_folder_id": str(
            await _get_for(db, owner_id, DRIVE_FOLDER_KEY, DEFAULT_DRIVE_FOLDER) or ""
        ),
    }


async def set_config(
    db: AsyncSession,
    *,
    enabled: bool | None = None,
    hour: int | None = None,
    drive_folder_id: str | None = None,
    user_id=None,
    owner_id=None,
) -> dict:
    if owner_id is not None:
        from services import user_settings

        if enabled is not None:
            await user_settings.set_value(db, owner_id, ENABLED_KEY, bool(enabled))
        if hour is not None:
            await user_settings.set_value(
                db, owner_id, HOUR_KEY, max(0, min(23, int(hour)))
            )
        if drive_folder_id is not None:
            await user_settings.set_value(
                db, owner_id, DRIVE_FOLDER_KEY, str(drive_folder_id).strip()
            )
        await db.commit()
        return await get_config(db, owner_id)
    if enabled is not None:
        await _set(db, ENABLED_KEY, bool(enabled), user_id)
    if hour is not None:
        await _set(db, HOUR_KEY, max(0, min(23, int(hour))), user_id)
    if drive_folder_id is not None:
        await _set(db, DRIVE_FOLDER_KEY, str(drive_folder_id).strip(), user_id)
    await db.commit()
    return await get_config(db)


async def _get_ledger(db: AsyncSession, owner_id=None) -> list[dict]:
    """The backup chain. On the hub each person has their own, so one person's
    backups never appear in another's history."""
    if owner_id is not None:
        from services import user_settings

        raw = await user_settings.get(db, owner_id, LEDGER_KEY, "")
        if not raw:
            return []
        try:
            val = json.loads(raw)
        except ValueError:
            return []
        return val if isinstance(val, list) else []
    val = await _get(db, LEDGER_KEY, [])
    return val if isinstance(val, list) else []


async def _set_ledger(db: AsyncSession, ledger: list[dict], owner_id=None, user_id=None) -> None:
    if owner_id is not None:
        from services import user_settings

        await user_settings.set_value(db, owner_id, LEDGER_KEY, json.dumps(ledger))
        return
    await _set(db, LEDGER_KEY, ledger, user_id)


async def list_backups(db: AsyncSession, owner_id=None) -> list[dict]:
    """Ledger entries, newest first."""
    return list(reversed(await _get_ledger(db, owner_id)))


# ── Tamper-evidence ───────────────────────────────────────────────────────
def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _record_hash(sequence: int, created_at: str, content_hash: str, previous_hash: str) -> str:
    return _sha256(_canonical({
        "sequence": sequence,
        "created_at": created_at,
        "content_hash": content_hash,
        "previous_hash": previous_hash,
    }))


def _sign(record_hash: str) -> str:
    key = settings.jwt_secret.encode("utf-8")
    return hmac.new(key, record_hash.encode("utf-8"), hashlib.sha256).hexdigest()


def _s(value) -> str | None:
    return None if value is None else str(value)


# ── Serialization ─────────────────────────────────────────────────────────
async def _collect_conversations(db: AsyncSession, owner_id=None) -> list[dict]:
    stmt = select(Conversation).order_by(Conversation.created_at)
    if owner_id is not None:
        stmt = stmt.where(Conversation.user_id == owner_id)
    convs = (await db.execute(stmt)).scalars().all()
    out: list[dict] = []
    for c in convs:
        msgs = (
            await db.execute(
                select(Message)
                .where(Message.conversation_id == c.id)
                .order_by(Message.created_at)
            )
        ).scalars().all()
        out.append({
            "id": str(c.id),
            "user_id": str(c.user_id),
            "title": c.title,
            "agent_type": _s(c.agent_type),
            "is_pinned": bool(c.is_pinned),
            "is_archived": bool(c.is_archived),
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            "messages": [
                {
                    "id": str(m.id),
                    "role": _s(m.role),
                    "content": m.content,
                    "agent_type": _s(m.agent_type),
                    "model_name": m.model_name,
                    "model_provider": m.model_provider,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in msgs
            ],
        })
    return out


# ── Run + verify ──────────────────────────────────────────────────────────
async def run_backup(
    db: AsyncSession, *, reason: str = "scheduled", user_id=None, owner_id=None
) -> dict:
    """Produce one signed, chained conversation backup. Returns the ledger
    entry plus the local path and Drive info.

    *owner_id* limits the backup to one person's conversations and writes to
    their own ledger and their own Drive. The hub always passes it — a single
    file holding everyone's chats, uploaded to one person's Drive, would hand
    every conversation to whoever owned that folder.
    """
    conversations = await _collect_conversations(db, owner_id)
    ledger = await _get_ledger(db, owner_id)
    sequence = (int(ledger[-1].get("sequence", 0)) + 1) if ledger else 1
    previous_hash = ledger[-1].get("record_hash", _GENESIS_HASH) if ledger else _GENESIS_HASH
    created_at = datetime.now(timezone.utc).isoformat()

    content = {
        "format_version": _FORMAT_VERSION,
        "sequence": sequence,
        "created_at": created_at,
        "reason": reason,
        "conversation_count": len(conversations),
        "message_count": sum(len(c["messages"]) for c in conversations),
        "conversations": conversations,
    }
    content_hash = _sha256(_canonical(content))
    record_hash = _record_hash(sequence, created_at, content_hash, previous_hash)
    signature = _sign(record_hash)

    document = {
        **content,
        "previous_hash": previous_hash,
        "content_hash": content_hash,
        "record_hash": record_hash,
        "signature": signature,
        "signature_alg": "HMAC-SHA256",
    }
    blob = json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    owner_tag = f"_{str(owner_id)[:8]}" if owner_id is not None else ""
    filename = f"conversations_{stamp}{owner_tag}_seq{sequence:04d}.json"
    local_path = backup_dir() / filename
    local_path.write_bytes(blob)

    # Best-effort upload to the configured Drive folder.
    drive_info: dict | None = None
    config = await get_config(db, owner_id)
    folder_id = config["drive_folder_id"] or None
    try:
        from services.google_service import drive_upload_bytes, get_credentials

        if get_credentials():
            res = drive_upload_bytes(
                blob, filename, mime_type="application/json", folder_id=folder_id
            )
            drive_info = {"id": res.get("id", ""), "url": res.get("url", "")}
    except Exception:
        logger.exception("Conversation backup: Drive upload failed (kept local copy)")

    entry = {
        "sequence": sequence,
        "created_at": created_at,
        "reason": reason,
        "filename": filename,
        "content_hash": content_hash,
        "record_hash": record_hash,
        "previous_hash": previous_hash,
        "conversation_count": content["conversation_count"],
        "message_count": content["message_count"],
        "drive_file_id": (drive_info or {}).get("id", ""),
        "drive_url": (drive_info or {}).get("url", ""),
    }
    ledger.append(entry)
    await _set_ledger(db, ledger, owner_id, user_id)
    await db.commit()
    logger.info(
        "Conversation backup #%d written (%d conversations, %d messages, drive=%s)",
        sequence, entry["conversation_count"], entry["message_count"], bool(drive_info),
    )
    return {**entry, "local_path": str(local_path), "drive": drive_info}


async def verify(db: AsyncSession, owner_id=None) -> dict:
    """Re-walk the backup chain and confirm every link, hash, and signature.
    Returns ``{ok, checked, problems}``."""
    ledger = await _get_ledger(db, owner_id)
    problems: list[str] = []
    prev = _GENESIS_HASH
    for entry in ledger:
        seq = entry.get("sequence")
        fname = entry.get("filename", "")
        path = backup_dir() / Path(fname).name

        if entry.get("previous_hash") != prev:
            problems.append(f"#{seq}: broken chain link (previous_hash mismatch)")
        expected_record = _record_hash(
            seq, entry.get("created_at", ""), entry.get("content_hash", ""),
            entry.get("previous_hash", ""),
        )
        if expected_record != entry.get("record_hash"):
            problems.append(f"#{seq}: ledger record hash mismatch")

        if not path.exists():
            problems.append(f"#{seq}: local file missing ({fname})")
        else:
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
                content = {k: doc[k] for k in _CONTENT_KEYS}
                if _sha256(_canonical(content)) != entry.get("content_hash"):
                    problems.append(f"#{seq}: file content was modified (hash mismatch)")
                if doc.get("record_hash") != entry.get("record_hash"):
                    problems.append(f"#{seq}: file record hash mismatch")
                if not hmac.compare_digest(
                    str(doc.get("signature", "")), _sign(str(entry.get("record_hash", "")))
                ):
                    problems.append(f"#{seq}: invalid signature")
            except Exception as exc:
                problems.append(f"#{seq}: unreadable file ({exc})")

        prev = entry.get("record_hash", prev)

    return {"ok": not problems, "checked": len(ledger), "problems": problems}


def read_backup_file(filename: str) -> bytes | None:
    """Read a backup file by name (path-traversal safe). None if missing."""
    safe = Path(filename).name
    path = backup_dir() / safe
    if safe != filename or not path.exists() or not path.is_file():
        return None
    return path.read_bytes()
