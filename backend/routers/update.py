"""Update router — checks GitHub for new commits and triggers self-update."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/update", tags=["update"])

GITHUB_REPO = "soulenya/pmi-agent"
GITHUB_API  = f"https://api.github.com/repos/{GITHUB_REPO}/commits/master"

# Resolve project root (two levels up from this file: routers/ -> backend/ -> project/)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def _local_commit() -> str:
    """Return the short SHA of the current local HEAD."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(_PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        return "unknown"


# ── Schemas ───────────────────────────────────────────────────────────────────

class UpdateStatus(BaseModel):
    current_sha:  str
    latest_sha:   str
    latest_message: str
    latest_date:  str
    up_to_date:   bool


class UpdateResult(BaseModel):
    success: bool
    message: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/check", response_model=UpdateStatus)
async def check_for_update(_=Depends(require_admin)) -> UpdateStatus:
    """Compare local HEAD against the latest commit on GitHub master."""
    current = _local_commit()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                GITHUB_API,
                headers={"Accept": "application/vnd.github+json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"GitHub unreachable: {exc}")

    latest_sha     = data["sha"][:7]
    latest_message = data["commit"]["message"].split("\n")[0]
    latest_date    = data["commit"]["committer"]["date"]

    return UpdateStatus(
        current_sha=current,
        latest_sha=latest_sha,
        latest_message=latest_message,
        latest_date=latest_date,
        up_to_date=(current == latest_sha),
    )


@router.post("/apply", response_model=UpdateResult)
async def apply_update(_=Depends(require_admin)) -> UpdateResult:
    """
    Run the update PowerShell script in the background.
    The backend process will be replaced when the script restarts services —
    the client should poll /health until the API comes back up.
    """
    update_script = _PROJECT_ROOT / "scripts" / "update.ps1"
    if not update_script.exists():
        raise HTTPException(status_code=500, detail="update.ps1 not found")

    try:
        if sys.platform == "win32":
            subprocess.Popen(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy", "Bypass",
                    "-File", str(update_script),
                    "-ProjectRoot", str(_PROJECT_ROOT),
                ],
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
                close_fds=True,
            )
        else:
            subprocess.Popen(
                ["bash", str(update_script.with_suffix(".sh")), str(_PROJECT_ROOT)],
                start_new_session=True,
                close_fds=True,
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return UpdateResult(
        success=True,
        message="Update started. The application will restart in a few minutes.",
    )


# ── Service control (restart / stop / pull) ───────────────────────────────────
# These endpoints write a command to a control file that the launcher polls.

_CONTROL_FILE = _PROJECT_ROOT / "backend" / "logs" / "launcher_cmd.txt"


def _write_launcher_cmd(cmd: str) -> None:
    _CONTROL_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CONTROL_FILE.write_text(cmd, encoding="utf-8")


class ServiceResult(BaseModel):
    success: bool
    message: str


@router.post("/restart", response_model=ServiceResult)
async def restart_services(_=Depends(require_admin)) -> ServiceResult:
    """Tell the launcher to restart all services without closing the window."""
    _write_launcher_cmd("restart")
    return ServiceResult(success=True, message="Restart command sent. Services will be back shortly.")


@router.post("/stop", response_model=ServiceResult)
async def stop_services(_=Depends(require_admin)) -> ServiceResult:
    """Tell the launcher to stop all services and exit."""
    _write_launcher_cmd("stop")
    return ServiceResult(success=True, message="Stop command sent.")


@router.post("/pull", response_model=ServiceResult)
async def pull_update(_=Depends(require_admin)) -> ServiceResult:
    """Pull the latest code from GitHub without restarting services."""
    _write_launcher_cmd("update")
    return ServiceResult(success=True, message="Update pull started. Check the status bar for progress.")


@router.post("/pull-restart", response_model=ServiceResult)
async def pull_and_restart(_=Depends(require_admin)) -> ServiceResult:
    """Pull the latest code from GitHub then restart all services."""
    _write_launcher_cmd("update_restart")
    return ServiceResult(success=True, message="Update & restart started. Services will be back shortly.")
