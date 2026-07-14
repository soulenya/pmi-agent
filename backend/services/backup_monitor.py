"""
Drive backup monitor — verifies the nightly rclone → GCS backup is current.

Architecture being monitored (owner's setup):
  - Source: "PMI Share Drive" (Google Workspace Shared Drive)
  - Destination: GCS bucket ``pmi-drive-backup`` (Nearline, versioned)
  - Engine: Cloud Run job + Cloud Scheduler, nightly ~2:00 AM ET, rclone copy

Ground truth for "is the backup current?" is bucket freshness: the newest
object write time in the bucket vs. the newest file edit in the Shared Drive.
This module reads the bucket with a dedicated READ-ONLY service-account key
(roles/storage.objectViewer on the bucket only) so Gerry can never modify the
backup. The Shared Drive side reuses the existing Google OAuth credentials.

Setup (one-time, per machine): place the service-account key JSON at
  %LOCALAPPDATA%/Little Gerry/gcs-backup-viewer.json
or set the ``backup.sa_key_path`` SystemSetting to its full path.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.settings import SystemSetting

logger = logging.getLogger(__name__)

KEY_BUCKET = "backup.gcs_bucket"
KEY_SA_PATH = "backup.sa_key_path"
KEY_DRIVE_NAME = "backup.shared_drive_name"
KEY_STALE_HOURS = "backup.stale_hours"

DEFAULT_BUCKET = "pmi-drive-backup"
DEFAULT_DRIVE_NAME = "PMI Share Drive"
DEFAULT_STALE_HOURS = 30  # nightly schedule + slack for DST/slow runs

_GCS_READONLY_SCOPE = "https://www.googleapis.com/auth/devstorage.read_only"


async def _read_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = (
        await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    ).scalar_one_or_none()
    return str(row.value) if row and row.value else default


def _default_key_paths() -> list[Path]:
    paths: list[Path] = []
    local_appdata = os.environ.get("LOCALAPPDATA")
    if local_appdata:
        paths.append(Path(local_appdata) / "Little Gerry" / "gcs-backup-viewer.json")
    # Dev/workspace fallback: backend directory.
    paths.append(Path(__file__).resolve().parent.parent / "gcs-backup-viewer.json")
    return paths


async def _find_sa_key(db: AsyncSession) -> Path | None:
    override = (await _read_setting(db, KEY_SA_PATH, "")).strip()
    if override:
        p = Path(override)
        return p if p.is_file() else None
    for p in _default_key_paths():
        if p.is_file():
            return p
    return None


def _gcs_bucket_stats(bucket: str, key_path: str) -> dict:
    """Count objects, total bytes, and the newest object write in the bucket."""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build as g_build

    creds = service_account.Credentials.from_service_account_file(
        key_path, scopes=[_GCS_READONLY_SCOPE]
    )
    svc = g_build("storage", "v1", credentials=creds, cache_discovery=False)
    count = 0
    total_bytes = 0
    newest = ""
    newest_name = ""
    token: str | None = None
    while True:
        resp = svc.objects().list(
            bucket=bucket,
            maxResults=1000,
            pageToken=token,
            fields="nextPageToken,items(name,size,updated)",
        ).execute()
        for obj in resp.get("items", []):
            count += 1
            total_bytes += int(obj.get("size", 0))
            updated = obj.get("updated", "")
            if updated > newest:
                newest = updated
                newest_name = obj.get("name", "")
        token = resp.get("nextPageToken")
        if not token:
            break
    return {
        "object_count": count,
        "total_bytes": total_bytes,
        "newest_updated": newest,
        "newest_name": newest_name,
    }


def _drive_source_stats(shared_drive_name: str) -> dict:
    """File count, newest edit, and per-file modified times for the Shared Drive."""
    from services.google_service import _build

    svc = _build("drive", "v3")
    drives = (
        svc.drives().list(pageSize=50, fields="drives(id,name)").execute()
    ).get("drives", [])
    match = next(
        (d for d in drives if d["name"].strip().lower() == shared_drive_name.strip().lower()),
        None,
    )
    if match is None:
        available = ", ".join(d["name"] for d in drives) or "none"
        raise ValueError(
            f"Shared drive '{shared_drive_name}' not found (available: {available})."
        )
    files: list[tuple[str, str]] = []  # (modifiedTime, name)
    token: str | None = None
    while True:
        resp = svc.files().list(
            corpora="drive",
            driveId=match["id"],
            q="trashed=false and mimeType != 'application/vnd.google-apps.folder'",
            pageSize=1000,
            pageToken=token,
            fields="nextPageToken,files(name,modifiedTime)",
            includeItemsFromAllDrives=True,
            supportsAllDrives=True,
        ).execute()
        files.extend(
            (f.get("modifiedTime", ""), f.get("name", "")) for f in resp.get("files", [])
        )
        token = resp.get("nextPageToken")
        if not token:
            break
    return {"drive_name": match["name"], "files": files}


def _parse_rfc3339(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fmt_local(dt: datetime) -> str:
    try:
        from zoneinfo import ZoneInfo

        local = dt.astimezone(ZoneInfo("America/New_York"))
        return local.strftime("%Y-%m-%d %I:%M %p ET")
    except Exception:  # noqa: BLE001 — tz database may be unavailable
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _fmt_age(hours: float) -> str:
    if hours < 1:
        return f"{int(hours * 60)} minutes ago"
    if hours < 48:
        return f"{hours:.1f} hours ago"
    return f"{hours / 24:.1f} days ago"


async def get_backup_status(db: AsyncSession) -> str:
    """Human-readable backup currency report. Never raises."""
    from services.google_service import get_credentials

    key_path = await _find_sa_key(db)
    if key_path is None:
        candidates = "\n".join(f"  - {p}" for p in _default_key_paths())
        return (
            "Backup check not configured on this machine: the read-only GCS "
            "service-account key was not found. Place gcs-backup-viewer.json at one "
            f"of:\n{candidates}\n(or set the backup.sa_key_path setting). The key "
            "needs only roles/storage.objectViewer on the backup bucket."
        )

    bucket = await _read_setting(db, KEY_BUCKET, DEFAULT_BUCKET)
    drive_name = await _read_setting(db, KEY_DRIVE_NAME, DEFAULT_DRIVE_NAME)
    try:
        stale_hours = float(await _read_setting(db, KEY_STALE_HOURS, str(DEFAULT_STALE_HOURS)))
    except ValueError:
        stale_hours = float(DEFAULT_STALE_HOURS)

    loop = asyncio.get_event_loop()
    try:
        bucket_stats = await loop.run_in_executor(
            None, lambda: _gcs_bucket_stats(bucket, str(key_path))
        )
    except Exception as exc:  # noqa: BLE001 — network/IAM errors are expected
        logger.warning("Backup bucket check failed for gs://%s: %s", bucket, exc)
        return (
            f"Could not read the backup bucket gs://{bucket}: {exc}\n"
            "Check that the service-account key is valid and has "
            "storage.objectViewer on the bucket."
        )

    drive_stats: dict | None = None
    drive_error = ""
    if get_credentials():
        try:
            drive_stats = await loop.run_in_executor(
                None, lambda: _drive_source_stats(drive_name)
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Backup source Drive check failed: %s", exc)
            drive_error = str(exc)
    else:
        drive_error = "Google account not connected — could not compare against live Drive."

    now = datetime.now(timezone.utc)
    gib = bucket_stats["total_bytes"] / (1024**3)
    lines = [f"DRIVE BACKUP STATUS (gs://{bucket}, checked just now)"]
    lines.append(
        f"- Backup bucket: {bucket_stats['object_count']:,} objects, {gib:.2f} GiB"
    )

    newest_backup = _parse_rfc3339(bucket_stats["newest_updated"] or "")
    if bucket_stats["object_count"] == 0:
        lines.append("- VERDICT: EMPTY — the bucket contains no objects. The backup has never run or is misconfigured.")
        return "\n".join(lines)
    if newest_backup is None:
        lines.append("- Could not determine the last backup write time.")
        return "\n".join(lines)

    backup_age_h = (now - newest_backup).total_seconds() / 3600
    lines.append(
        f"- Last backup write: {_fmt_local(newest_backup)} ({_fmt_age(backup_age_h)}) "
        f"— \"{bucket_stats['newest_name']}\""
    )

    if backup_age_h <= stale_hours:
        lines.append(
            f"- VERDICT: CURRENT — the nightly backup ran on schedule "
            f"(threshold: {stale_hours:.0f}h)."
        )
    else:
        lines.append(
            f"- VERDICT: STALE — no backup write in {_fmt_age(backup_age_h)} "
            f"(threshold: {stale_hours:.0f}h). Check the Cloud Run job "
            "'pmi-drive-backup' Executions tab for failed runs."
        )

    if drive_stats is not None:
        files = drive_stats["files"]
        newest_edit = max((m for m, _ in files), default="")
        newest_edit_dt = _parse_rfc3339(newest_edit)
        lines.append(
            f"- Source \"{drive_stats['drive_name']}\": {len(files):,} files"
            + (
                f"; newest edit {_fmt_local(newest_edit_dt)} ({_fmt_age((now - newest_edit_dt).total_seconds() / 3600)})"
                if newest_edit_dt
                else ""
            )
        )
        cutoff = bucket_stats["newest_updated"]
        changed = sorted(
            ((m, n) for m, n in files if m > cutoff),
            reverse=True,
        )
        if changed:
            sample = ", ".join(f"\"{n}\"" for _, n in changed[:5])
            more = f" (+{len(changed) - 5} more)" if len(changed) > 5 else ""
            lines.append(
                f"- {len(changed):,} file(s) modified since the last backup — will be "
                f"picked up on the next nightly run: {sample}{more}"
            )
        else:
            lines.append("- No Drive files modified since the last backup — fully up to date.")
    elif drive_error:
        lines.append(f"- Live Drive comparison unavailable: {drive_error}")

    return "\n".join(lines)
