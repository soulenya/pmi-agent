"""Update router — checks GitHub for new releases and triggers self-update.

Two deployment shapes are supported:

* **Installed copies** (no ``.git`` directory) check the private repo's GitHub
  *Releases* using the read-only token baked into the installer and compare the
  ``VERSION`` file against the latest release tag — exactly like the launcher's
  auto-update on startup.
* **Developer checkouts** (``.git`` present) compare the local HEAD against the
  latest commit on ``master`` and update via ``git pull``.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/update", tags=["update"])

GITHUB_REPO         = "soulenya/pmi-agent"
GITHUB_API          = f"https://api.github.com/repos/{GITHUB_REPO}/commits/master"
GITHUB_RELEASES_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

# Resolve project root (two levels up from this file: routers/ -> backend/ -> project/)
_PROJECT_ROOT     = Path(__file__).resolve().parent.parent.parent
VERSION_FILE      = _PROJECT_ROOT / "VERSION"
UPDATE_TOKEN_FILE = _PROJECT_ROOT / "update_token.txt"


def _is_installed() -> bool:
    """True for installed copies (no git checkout); False for developer checkouts."""
    return not (_PROJECT_ROOT / ".git").exists()


def _update_token() -> str | None:
    """Return the read-only GitHub token baked into the installer, if present."""
    try:
        if not UPDATE_TOKEN_FILE.exists():
            return None
        token = UPDATE_TOKEN_FILE.read_text(encoding="utf-8").strip()
        if not token or token.startswith("PASTE_"):
            return None
        return token
    except Exception:
        return None


def _github_headers(accept: str = "application/vnd.github+json") -> dict[str, str]:
    """Base GitHub API headers, with auth when an update token is available."""
    headers = {
        "Accept": accept,
        "User-Agent": "LittleGerry-Updater",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = _update_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _parse_version(text: str) -> tuple[int, int, int]:
    """Parse a version string like 'v1.2.3' or '1.2.3' into a comparable tuple."""
    cleaned = (text or "").strip().lstrip("vV")
    nums: list[int] = []
    for part in cleaned.split(".")[:3]:
        digits = "".join(ch for ch in part if ch.isdigit())
        nums.append(int(digits) if digits else 0)
    while len(nums) < 3:
        nums.append(0)
    return (nums[0], nums[1], nums[2])


def _version_str(version: tuple[int, int, int]) -> str:
    return ".".join(str(n) for n in version)


def _local_version() -> tuple[int, int, int]:
    """Return the installed version from the VERSION file."""
    try:
        return _parse_version(VERSION_FILE.read_text(encoding="utf-8"))
    except Exception:
        return (0, 0, 0)


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
    """Compare the installed build against the latest available on GitHub.

    Installed copies compare ``VERSION`` against the latest release tag; developer
    checkouts compare the local HEAD against the latest commit on ``master``.
    """
    if _is_installed():
        return await _check_release()
    return await _check_commit()


async def _check_release() -> UpdateStatus:
    """Installed-copy check: latest GitHub Release vs the local VERSION file."""
    local = _local_version()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(GITHUB_RELEASES_API, headers=_github_headers())
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"GitHub unreachable: {exc}")

    latest = _parse_version(data.get("tag_name", "0.0.0"))
    latest_message = (data.get("name") or data.get("tag_name") or "").strip()
    latest_date    = data.get("published_at", "")

    return UpdateStatus(
        current_sha=_version_str(local),
        latest_sha=_version_str(latest),
        latest_message=latest_message,
        latest_date=latest_date,
        up_to_date=(latest <= local),
    )


async def _check_commit() -> UpdateStatus:
    """Developer-checkout check: local HEAD vs the latest commit on master."""
    current = _local_commit()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(GITHUB_API, headers=_github_headers())
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
    Install the latest update.

    Installed copies download the latest signed installer from the private repo's
    GitHub Releases and hand off to ``apply_update.ps1`` (stop → silent install →
    relaunch). Developer checkouts run ``update.ps1`` (git pull → deps → migrate →
    restart). Either way the backend is replaced when services restart — the
    client should poll ``/health`` until the API comes back up.
    """
    if _is_installed():
        return await _apply_release()
    return _apply_git()


async def _apply_release() -> UpdateResult:
    """Installed-copy apply: download the signed installer and run apply_update.ps1."""
    if sys.platform != "win32":
        raise HTTPException(status_code=500, detail="Installed updates are only supported on Windows")

    token = _update_token()
    if not token:
        raise HTTPException(status_code=500, detail="No update token available to download the release")

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(GITHUB_RELEASES_API, headers=_github_headers())
            resp.raise_for_status()
            data = resp.json()

            asset = next(
                (a for a in data.get("assets", []) if a.get("name") == "LittleGerry_Setup.exe"),
                None,
            )
            if not asset:
                raise HTTPException(status_code=502, detail="Installer asset not found in latest release")

            target = Path(tempfile.gettempdir()) / "LittleGerry_Setup_update.exe"
            async with client.stream(
                "GET",
                asset["url"],
                headers=_github_headers("application/octet-stream"),
            ) as dl:
                dl.raise_for_status()
                with open(target, "wb") as out:
                    async for chunk in dl.aiter_bytes():
                        out.write(chunk)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not download update: {exc}")

    apply_script = _PROJECT_ROOT / "scripts" / "apply_update.ps1"
    if not apply_script.exists():
        raise HTTPException(status_code=500, detail="apply_update.ps1 not found")

    try:
        subprocess.Popen(
            [
                "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", str(apply_script),
                "-Installer", str(target),
                "-AppDir", str(_PROJECT_ROOT),
            ],
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return UpdateResult(
        success=True,
        message="Update downloaded. The application will close, install the update, and reopen automatically.",
    )


def _apply_git() -> UpdateResult:
    """Developer-checkout apply: run the git-based update script."""
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
