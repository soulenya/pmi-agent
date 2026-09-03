"""
Little Gerry — silent launcher.

* Shows a branded splash screen while all services start
* Runs backend, frontend, Docker, and Ollama with no visible terminal windows
* Sits in the system tray; double-click = open app, right-click = Stop / Open
* Errors are logged to backend/logs/launcher.log
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
from pathlib import Path

ROOT         = Path(__file__).parent
BACKEND_DIR  = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
LOGO_PATH    = ROOT / "Spaceman on Black BG.png"

# ── platform abstraction ─────────────────────────────────────────────────────
IS_WINDOWS = (os.name == "nt")
IS_MAC     = (sys.platform == "darwin")

if IS_WINDOWS:
    VENV_PYTHON = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
else:
    VENV_PYTHON = BACKEND_DIR / ".venv" / "bin" / "python"

# Per-platform release asset + apply-update script used by the installed-copy
# auto-updater (see _auto_update_release / _launch_updater).
if IS_WINDOWS:
    UPDATE_ASSET_NAME  = "LittleGerry_Setup.exe"
    UPDATE_TARGET_NAME = "LittleGerry_Setup_update.exe"
    APPLY_SCRIPT       = ROOT / "scripts" / "apply_update.ps1"
elif IS_MAC:
    UPDATE_ASSET_NAME  = "LittleGerry.pkg"
    UPDATE_TARGET_NAME = "LittleGerry_update.pkg"
    APPLY_SCRIPT       = ROOT / "scripts" / "apply_update.sh"
else:
    UPDATE_ASSET_NAME  = ""
    UPDATE_TARGET_NAME = "LittleGerry_update.bin"
    APPLY_SCRIPT       = ROOT / "scripts" / "apply_update.sh"

HEALTH_URL    = "http://127.0.0.1:8000/health"
APP_URL       = "http://localhost:5173"
CONTROL_FILE  = BACKEND_DIR / "logs" / "launcher_cmd.txt"
WINDOW_STATE_FILE = BACKEND_DIR / "logs" / "window_state.json"


def _load_window_state() -> dict:
    """Window geometry saved on the last close (empty dict if none/invalid)."""
    try:
        data = json.loads(WINDOW_STATE_FILE.read_text(encoding="utf-8"))
        w, h = int(data["width"]), int(data["height"])
        x, y = int(data["x"]), int(data["y"])
        if w < 900 or h < 600:
            return {}
        # Drop positions captured while minimized (Windows reports -32000).
        if x < -10000 or y < -10000:
            return {"width": w, "height": h}
        return {"width": w, "height": h, "x": x, "y": y}
    except Exception:
        return {}


def _save_window_state(win) -> None:
    """Persist current window geometry so the next launch restores it."""
    try:
        x, y, w, h = win.x, win.y, win.width, win.height
        if w < 200 or h < 200 or x < -10000 or y < -10000:
            return  # minimized / bogus geometry — keep the previous state
        WINDOW_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        WINDOW_STATE_FILE.write_text(
            json.dumps({"x": x, "y": y, "width": w, "height": h}),
            encoding="utf-8",
        )
    except Exception:
        pass


def _no_window_kwargs() -> dict:
    """Popen/run kwargs that hide a console window on Windows (no-op elsewhere)."""
    if IS_WINDOWS:
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {}


# Auto-update (installed copies pull signed installers from the private repo's
# Releases using a read-only token baked in at build time).
GITHUB_RELEASES_API = "https://api.github.com/repos/soulenya/pmi-agent/releases/latest"
VERSION_FILE        = ROOT / "VERSION"
UPDATE_TOKEN_FILE   = ROOT / "update_token.txt"

_procs: list[subprocess.Popen] = []
_status_text = "Initializing..."
_status_step = 0
_ready       = threading.Event()
_win_ref     = None          # set to webview.Window once created
_icon_ref    = None          # set to pystray.Icon once created
_skip_close_confirm = False  # set True by tray "Stop" to skip second dialog
_browser_win = None          # second window used by the in-app research browser
_browser_lock = threading.Lock()
_browser_actions: list[str] = []   # button presses from the in-page floating bar
_browser_following = [False]       # so an injected bar renders the right label


# ── helpers ──────────────────────────────────────────────────────────────────

def _set_status(text: str, step: int | None = None) -> None:
    global _status_text, _status_step, _win_ref
    _status_text = text
    if step is not None:
        _status_step = step
    # Push update into the pywebview loading page
    if _win_ref is not None:
        try:
            _win_ref.evaluate_js(
                f"var s=document.getElementById('s'),f=document.getElementById('f');"
                f"if(s)s.textContent={json.dumps(text)};"
                f"if(f)f.style.width='{min(max(_status_step,0),6)/6*100:.0f}%';"
            )
        except Exception:
            pass


def _run(cmd: str, cwd: str | None = None, timeout: float | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd, cwd=cwd, shell=True,
            capture_output=True, timeout=timeout, **_no_window_kwargs(),
        )
    except subprocess.TimeoutExpired:
        # Treat a timeout like a failed command — callers only inspect
        # returncode/stdout, and this keeps shutdown from ever blocking.
        return subprocess.CompletedProcess(cmd, 124, b"", b"")
    except Exception:
        return subprocess.CompletedProcess(cmd, 1, b"", b"")


def _kill_port(port: int) -> None:
    if IS_WINDOWS:
        r = _run(f'netstat -aon | findstr ":{port} "', timeout=10)
        for line in r.stdout.decode(errors="ignore").splitlines():
            parts = line.split()
            if len(parts) >= 5 and f":{port}" in parts[1]:
                _run(f"taskkill /f /pid {parts[4]}", timeout=10)
    else:
        # macOS / Unix: find the PID(s) bound to the port and kill them.
        r = _run(f"lsof -ti tcp:{port}", timeout=10)
        for pid in r.stdout.decode(errors="ignore").split():
            if pid.strip():
                _run(f"kill -9 {pid.strip()}", timeout=10)



def _health_ok() -> bool:
    try:
        urllib.request.urlopen(HEALTH_URL, timeout=3)
        return True
    except Exception:
        return False


def _log_error() -> None:
    try:
        log_dir = BACKEND_DIR / "logs"
        log_dir.mkdir(exist_ok=True)
        with open(log_dir / "launcher.log", "a", encoding="utf-8") as f:
            f.write(f"\n--- {datetime.datetime.now()} ---\n")
            traceback.print_exc(file=f)
    except Exception:
        pass


# ── service startup (runs in background thread) ───────────────────────────────

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


def _local_version() -> tuple[int, int, int]:
    try:
        return _parse_version(VERSION_FILE.read_text(encoding="utf-8"))
    except Exception:
        return (0, 0, 0)


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


# Failed-update loop breaker: the apply script ALWAYS relaunches the app (so a
# failed install never leaves Gerry permanently down), but if the install fails
# repeatedly (e.g. the user declines the UAC elevation prompt) the relaunched
# old version would immediately re-download and retry forever. The launcher
# records every attempt here; the apply script deletes the marker on a
# successful install. Two failed attempts at the same version within 24h stops
# auto-retrying and starts the current version instead.
UPDATE_MARKER_FILE = BACKEND_DIR / "logs" / "update_attempt.json"


def _load_update_marker() -> dict:
    try:
        return json.loads(UPDATE_MARKER_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _record_update_attempt(version_str: str) -> None:
    try:
        marker = _load_update_marker()
        attempts = marker.get("attempts", 0) + 1 if marker.get("version") == version_str else 1
        UPDATE_MARKER_FILE.parent.mkdir(parents=True, exist_ok=True)
        UPDATE_MARKER_FILE.write_text(
            json.dumps({
                "version": version_str,
                "attempts": attempts,
                "last_attempt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }),
            encoding="utf-8",
        )
    except Exception:
        _log_error()


def _too_many_failed_attempts(version_str: str) -> bool:
    marker = _load_update_marker()
    if marker.get("version") != version_str or marker.get("attempts", 0) < 2:
        return False
    try:
        last = datetime.datetime.fromisoformat(marker.get("last_attempt", ""))
        age_h = (datetime.datetime.now(datetime.timezone.utc) - last).total_seconds() / 3600
    except Exception:
        age_h = 0.0
    return age_h < 24


def _launch_updater(apply_script: Path, target: Path) -> None:
    """
    Hand off to the platform's apply-update script as a process that OUTLIVES
    this launcher so it can replace files after we exit.

    macOS / Unix: there is no kill-on-close Job Object, so a detached session
    (start_new_session=True → setsid) reliably survives the parent's os._exit().

    Windows: the launcher (pythonw.exe) frequently runs inside a Windows Job
    Object with kill-on-close semantics. A child created with subprocess.Popen —
    even with DETACHED_PROCESS or CREATE_BREAKAWAY_FROM_JOB — joins (or fails to
    break out of) that job and is killed the instant this process calls
    os._exit(0), before apply_update.ps1 can run (its log file is never even
    created — confirmed in the field and in a controlled kill-on-close-job repro).
    os.startfile() uses ShellExecute, so the new process is created by the shell
    (Explorer) — parented OUTSIDE our job — and runs in the interactive desktop
    (so the installer's UAC prompt can appear). This is the launch method that
    reliably survives. Fallbacks keep older behaviour if ShellExecute fails.
    """
    if not IS_WINDOWS:
        try:
            subprocess.Popen(
                ["/bin/bash", str(apply_script), str(target), str(ROOT)],
                start_new_session=True, close_fds=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception:
            _log_error()
        return

    ps_args = (
        f'-NoProfile -ExecutionPolicy Bypass '
        f'-File "{apply_script}" -Installer "{target}" -AppDir "{ROOT}"'
    )
    try:
        # show_cmd=0 (SW_HIDE) hides the PowerShell host window; the installer's
        # UAC consent prompt still appears on the secure desktop.
        os.startfile("powershell.exe", arguments=ps_args, show_cmd=0)
        return
    except Exception:
        _log_error()

    # Fallback: detached spawn with job breakaway (best-effort).
    DETACHED = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    CREATE_BREAKAWAY_FROM_JOB = 0x01000000
    args = [
        "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", str(apply_script),
        "-Installer", str(target),
        "-AppDir", str(ROOT),
    ]
    try:
        subprocess.Popen(
            args,
            creationflags=DETACHED | CREATE_BREAKAWAY_FROM_JOB,
            close_fds=True,
        )
    except OSError:
        subprocess.Popen(args, creationflags=DETACHED, close_fds=True)


def _auto_update_release() -> bool:
    """
    Installed-copy updater: check the private repo's GitHub Releases for a newer
    signed installer. If one exists, download it and hand off to apply_update.ps1,
    then signal the caller to exit so files can be replaced.

    Returns True when an update is being applied (caller MUST exit immediately).
    Skips silently on dev checkouts (handled by git via _auto_update) or when no
    update token is present.
    """
    if (ROOT / ".git").exists():
        return False  # developer checkout — uses the git update path instead
    token = _update_token()
    if not token:
        return False
    if not UPDATE_ASSET_NAME:
        return False  # unsupported platform for installed-copy updates
    try:
        _set_status("Checking for updates...", 0)
        req = urllib.request.Request(
            GITHUB_RELEASES_API,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "LittleGerry-Updater",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        latest = _parse_version(data.get("tag_name", "0.0.0"))
        if latest <= _local_version():
            return False  # already current

        version_str = ".".join(map(str, latest))
        if _too_many_failed_attempts(version_str):
            last_err = str(_load_update_marker().get("last_error") or "")
            if "Application Control" in last_err:
                hint = (
                    "Windows Smart App Control is blocking the installer - turn it "
                    "off under Windows Security > App & browser control > Smart App "
                    "Control, then run 'Update Little Gerry'."
                )
            else:
                hint = "Run 'Update Little Gerry' to retry."
            _set_status(
                f"Update {version_str} couldn't be installed automatically - "
                f"starting the current version. {hint}",
                0,
            )
            return False

        asset = next(
            (a for a in data.get("assets", []) if a.get("name") == UPDATE_ASSET_NAME),
            None,
        )
        if not asset:
            return False

        _set_status(f"Downloading update {'.'.join(map(str, latest))}...", 0)
        dl_req = urllib.request.Request(
            asset["url"],
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/octet-stream",
                "User-Agent": "LittleGerry-Updater",
            },
        )
        target = Path(tempfile.gettempdir()) / UPDATE_TARGET_NAME
        # A leftover installer from a previous failed attempt can still be
        # locked (running installer, antivirus scan) - PermissionError on open
        # crashed the launcher in the field. Remove it, or fall back to a
        # unique name.
        try:
            if target.exists():
                target.unlink()
        except OSError:
            target = target.with_name(f"{target.stem}_{os.getpid()}{target.suffix}")
        with urllib.request.urlopen(dl_req, timeout=300) as r, open(target, "wb") as out:
            shutil.copyfileobj(r, out)

        _set_status("Installing update...", 0)
        _record_update_attempt(version_str)
        _launch_updater(APPLY_SCRIPT, target)
        return True
    except Exception:
        _log_error()
        return False


def _auto_update() -> None:
    """
    Pull the latest code from GitHub at launch so updates reach every user
    automatically. Safety guards:
      * skips silently if this isn't a git checkout,
      * skips unless the checkout is on ``master`` — the reset below would
        otherwise throw away committed work on a development branch,
      * skips if the working tree is dirty (protects developer machines with
        uncommitted changes from a destructive reset),
      * only runs the heavier dependency install when the code actually changed.
    Database migrations run later, after PostgreSQL is up.
    """
    if not (ROOT / ".git").exists():
        return
    try:
        _set_status("Checking for updates...", 0)

        branch = _run(
            "git rev-parse --abbrev-ref HEAD", cwd=str(ROOT)
        ).stdout.decode(errors="ignore").strip()
        if branch != "master":
            return

        # Don't clobber local work (dev machines / in-progress edits).
        dirty = _run("git status --porcelain", cwd=str(ROOT)).stdout.decode(errors="ignore").strip()
        if dirty:
            return

        _run("git fetch origin", cwd=str(ROOT), timeout=120)
        local = _run("git rev-parse HEAD", cwd=str(ROOT)).stdout.decode(errors="ignore").strip()
        remote = _run("git rev-parse origin/master", cwd=str(ROOT)).stdout.decode(errors="ignore").strip()
        if not local or not remote or local == remote:
            return  # already current

        _set_status("Installing the latest update...", 0)
        _run("git reset --hard origin/master", cwd=str(ROOT))
        # Refresh dependencies to match the new code.
        _run("uv sync", cwd=str(BACKEND_DIR), timeout=300)
        _run("npm install --silent", cwd=str(FRONTEND_DIR), timeout=300)
        _set_status("Update installed.", 0)
    except Exception:
        _log_error()


def _sync_dependencies() -> None:
    """Reconcile the venv and node_modules with the current code.

    Both commands reach the network, and `npm install` on a slow line can sit
    for many minutes without a single byte of progress. Startup used to wait on
    that with no bound, so a bad connection left the splash on "Checking
    dependencies..." forever. Skip the work entirely unless the manifests
    actually changed, and never wait more than a few minutes when they have —
    stale dependencies cost a feature, a hung launcher costs the whole app.
    """
    manifests = [BACKEND_DIR / "pyproject.toml", FRONTEND_DIR / "package.json"]
    try:
        digest = hashlib.sha256()
        for path in manifests:
            digest.update(path.read_bytes())
        stamp_path = BACKEND_DIR / "logs" / "deps.stamp"
        stamp = digest.hexdigest()
        if stamp_path.exists() and stamp_path.read_text(encoding="utf-8").strip() == stamp:
            return
    except Exception:
        _log_error()
        stamp_path, stamp = None, None

    ok = True
    for cmd, cwd in (("uv sync", BACKEND_DIR), ("npm install --silent", FRONTEND_DIR)):
        if _run(cmd, cwd=str(cwd), timeout=300).returncode != 0:
            ok = False

    if ok and stamp_path is not None:
        try:
            stamp_path.parent.mkdir(exist_ok=True)
            stamp_path.write_text(stamp, encoding="utf-8")
        except Exception:
            _log_error()


def _start_services() -> None:
    try:
        # 0. Auto-update from GitHub (skipped on a dirty working tree, e.g. dev machines)
        # 0a. Installed copies: download + apply a newer signed installer, then exit.
        if _auto_update_release():
            os._exit(0)
        # 0b. Developer checkouts: pull the latest code via git.
        _auto_update()

        # 0c. Always reconcile dependencies with the current code. Installer-based
        # updates replace the code but never touched the Python venv or node_modules,
        # so a release that adds a dependency would silently break (e.g. the ddgs
        # search package). Both commands are fast no-ops when already in sync.
        _set_status("Checking dependencies...", 0)
        _sync_dependencies()

        # 1. Docker
        _set_status("Checking Docker...", 1)
        if _run("docker info").returncode != 0:
            _set_status("Starting Docker...", 1)
            if IS_WINDOWS:
                # Try Windows service (harmless if it fails) and launch Desktop.exe
                _run("sc start com.docker.service")
                desktop_exe = r"C:\Program Files\Docker\Docker\Docker Desktop.exe"
                if Path(desktop_exe).exists():
                    subprocess.Popen([desktop_exe], **_no_window_kwargs())
            elif IS_MAC:
                _run("open -a Docker")
            for _ in range(30):
                time.sleep(3)
                if _run("docker info").returncode == 0:
                    break

        # 2. PostgreSQL — always use compose so the container is recreated if deleted
        _set_status("Starting PostgreSQL...", 2)
        # Self-heal: a leftover `pmi_postgres` container from another project (e.g. a
        # dev checkout) would block compose with a name conflict. If this project
        # doesn't already own the container, remove any stray one before bringing ours up.
        if not _run("docker compose ps -q postgres", cwd=str(ROOT)).stdout.strip():
            _run("docker rm -f pmi_postgres", cwd=str(ROOT))
        _run("docker compose up -d", cwd=str(ROOT))
        # Wait up to 30 s for postgres to accept connections
        for _ in range(10):
            chk = _run("docker exec pmi_postgres pg_isready -U pmi -d pmi_dev")
            if chk.returncode == 0:
                break
            time.sleep(3)

        # 2b. Apply any pending database migrations (cheap no-op when up to date)
        _set_status("Updating database...", 2)
        try:
            _run(f'"{VENV_PYTHON}" -m alembic upgrade head', cwd=str(BACKEND_DIR))
        except Exception:
            _log_error()

        # 3. Backend
        _set_status("Starting backend...", 3)
        _kill_port(8000)
        time.sleep(0.5)
        (BACKEND_DIR / "logs").mkdir(exist_ok=True)
        _backend_log = open(BACKEND_DIR / "logs" / "backend_stderr.log", "w", encoding="utf-8")
        _procs.append(subprocess.Popen(
            [str(VENV_PYTHON), "-m", "uvicorn", "main:app",
             "--host", "127.0.0.1", "--port", "8000"],
            cwd=str(BACKEND_DIR),
            stdout=_backend_log,
            stderr=_backend_log,
            **_no_window_kwargs(),
        ))

        # 4. Frontend
        _set_status("Starting frontend...", 4)
        _kill_port(5173)
        time.sleep(0.5)
        _procs.append(subprocess.Popen(
            "npm run dev",
            cwd=str(FRONTEND_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=True,
            **_no_window_kwargs(),
        ))

        # Wait for backend health-check
        _set_status("Waiting for app...", 5)
        for _ in range(40):
            if _health_ok():
                break
            time.sleep(1)

        _set_status("Ready!", 6)
        time.sleep(0.5)

    except Exception:
        _log_error()
        _set_status("Error — see logs/launcher.log", -1)
        time.sleep(3)

    _ready.set()


# ── stop all ─────────────────────────────────────────────────────────────────

def _force_exit_after(seconds: float) -> None:
    """Safety net so the user never has to force quit.

    Teardown can briefly block (most often a sluggish ``docker stop`` on
    macOS). We start this watchdog right before shutdown begins; if the normal
    ``os._exit(0)`` hasn't fired within the grace period, this one does.
    """
    def _kill() -> None:
        time.sleep(seconds)
        os._exit(0)
    threading.Thread(target=_kill, daemon=True).start()


def _stop_all() -> None:
    for p in _procs:
        try:
            p.terminate()
        except Exception:
            pass
    _kill_port(8000)
    _kill_port(5173)
    # Bounded so a slow/unresponsive Docker can't hang shutdown. ``-t 3`` gives
    # Postgres a 3 s grace period; the outer timeout caps the whole call.
    _run("docker stop -t 3 pmi_postgres", timeout=15)



# ── control-file command handler (called from poll thread) ──────────────────

def _handle_control_cmd(cmd: str) -> None:
    global _skip_close_confirm
    if cmd == "restart":
        threading.Thread(target=_restart_services, daemon=True).start()
    elif cmd == "stop":
        _skip_close_confirm = True
        _force_exit_after(12)  # guarantee exit even if teardown blocks
        if _win_ref:
            try:
                _win_ref.destroy()
            except Exception:
                pass
        _stop_all()
        if _icon_ref:
            try:
                _icon_ref.stop()
            except Exception:
                pass
        os._exit(0)
    elif cmd == "update":
        threading.Thread(target=_do_update, daemon=True).start()
    elif cmd == "update_restart":
        threading.Thread(target=_do_update_restart, daemon=True).start()


def _poll_control_file() -> None:
    """Background thread: watches for backend-written commands."""
    while True:
        time.sleep(1)
        try:
            if CONTROL_FILE.exists():
                cmd = CONTROL_FILE.read_text(encoding="utf-8").strip()
                try:
                    CONTROL_FILE.unlink(missing_ok=True)
                except Exception:
                    pass
                if cmd:
                    _handle_control_cmd(cmd)
        except Exception:
            _log_error()


# ── restart / update helpers ─────────────────────────────────────────────────

def _restart_services() -> None:
    """Stop everything (except the window) and bring services back up."""
    _set_status("Restarting — stopping services...", 0)
    for p in _procs:
        try:
            p.terminate()
        except Exception:
            pass
    _procs.clear()
    _kill_port(8000)
    _kill_port(5173)
    _run("docker stop pmi_postgres")
    time.sleep(1)
    _start_services()


def _do_update() -> None:
    """Pull latest code from GitHub. Does not restart services."""
    _set_status("Updating — pulling latest code...", 0)
    try:
        result = _run("git pull --ff-only", cwd=str(ROOT))
        msg = result.stdout.decode(errors="ignore").strip() or "Already up to date."
        _set_status(f"Update complete: {msg[:60]}", 0)
    except Exception:
        _log_error()
        _set_status("Update failed — see logs/launcher.log", -1)
    time.sleep(3)
    # Clear the splash text (app is still running)
    _set_status("", 0)


def _do_update_restart() -> None:
    """Pull latest code then restart all services."""
    _set_status("Updating — pulling latest code...", 0)
    try:
        result = _run("git pull --ff-only", cwd=str(ROOT))
        msg = result.stdout.decode(errors="ignore").strip() or "Already up to date."
        _set_status(f"Update pulled: {msg[:60]}", 0)
        time.sleep(1)
    except Exception:
        _log_error()
        _set_status("Update failed — see logs/launcher.log", -1)
        time.sleep(3)
        return
    _restart_services()


# ── system tray ──────────────────────────────────────────────────────────────

def _make_tray(win=None):
    from PIL import Image, ImageDraw
    import pystray

    try:
        icon_img = Image.open(LOGO_PATH).resize((64, 64), Image.LANCZOS)
    except Exception:
        icon_img = Image.new("RGB", (64, 64), (0, 0, 0))
        ImageDraw.Draw(icon_img).ellipse([8, 8, 56, 56], fill=(200, 200, 200))

    def on_open(_icon, _item) -> None:
        if win:
            try:
                win.show()
            except Exception:
                pass

    def on_stop(icon, _item) -> None:
        global _skip_close_confirm
        _skip_close_confirm = True   # bypass the close dialog — user already confirmed via tray
        if win:
            try:
                win.destroy()
            except Exception:
                pass
        _stop_all()
        icon.stop()
        os._exit(0)

    def on_restart(_icon, _item) -> None:
        """Stop all services, then restart them without closing the window."""
        threading.Thread(target=_restart_services, daemon=True).start()

    def on_update(_icon, _item) -> None:
        """Pull latest code from GitHub (no restart)."""
        threading.Thread(target=_do_update, daemon=True).start()

    def on_update_restart(_icon, _item) -> None:
        """Pull latest code then restart all services."""
        threading.Thread(target=_do_update_restart, daemon=True).start()

    return pystray.Icon(
        "LittleGerry", icon_img, "Little Gerry",
        pystray.Menu(
            pystray.MenuItem("Little Gerry", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open App", on_open, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Restart Services", on_restart),
            pystray.MenuItem("Update", on_update),
            pystray.MenuItem("Update & Restart", on_update_restart),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Stop All Services", on_stop),
        ),
    )


# ── entry point ───────────────────────────────────────────────────────────────

# Runs inside the browsed page. Picks the densest article-ish container, drops
# chrome and scripts, and returns readable text — WebView2 has already executed
# the page's JavaScript, so this sees what the user sees.
_EXTRACT_JS = r"""
(function () {
  try {
    var best = null, bestLen = 0;
    var cands = document.querySelectorAll(
      'article, main, [role="main"], #content, .content, .post, .article, .entry-content'
    );
    for (var i = 0; i < cands.length; i++) {
      var len = (cands[i].innerText || '').trim().length;
      if (len > bestLen) { bestLen = len; best = cands[i]; }
    }
    var root = (bestLen > 400 && best) ? best : document.body;
    if (!root) return { url: location.href, title: document.title || '', text: '' };
    var clone = root.cloneNode(true);
    var junk = clone.querySelectorAll(
      'script,style,noscript,nav,aside,footer,header,form,iframe,svg,button,' +
      '[aria-hidden="true"],[role="navigation"],[role="banner"],[role="contentinfo"]'
    );
    for (var j = 0; j < junk.length; j++) { junk[j].remove(); }
    var text = (clone.innerText || '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { url: location.href, title: document.title || '', text: text.slice(0, 200000) };
  } catch (e) {
    var fallback = document.body ? (document.body.innerText || '') : '';
    return {
      url: location.href, title: document.title || '',
      text: fallback.slice(0, 200000), error: String(e)
    };
  }
})()
"""

# Floating action bar drawn on top of whatever site is loaded. Injected after
# every navigation because a page load wipes it. Buttons only queue a request —
# the React app polls for it and does the actual work, since it is the side that
# holds the login token.
_TOOLBAR_JS = r"""
(function () {
  if (window.__lgBar) return true;
  var wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:2147483647',
    'display:flex', 'gap:6px', 'padding:6px',
    'background:rgba(17,17,20,0.92)', 'border:1px solid rgba(255,255,255,0.16)',
    'border-radius:10px', 'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
    'font:500 12px/1.2 system-ui,Segoe UI,sans-serif', 'color:#fff',
    'opacity:0.45', 'transition:opacity .15s'
  ].join(';');
  wrap.onmouseenter = function () { wrap.style.opacity = '1'; };
  wrap.onmouseleave = function () { wrap.style.opacity = '0.45'; };

  function send(action) {
    try { window.pywebview.api.browser_action(action); } catch (e) { /* bridge not ready */ }
  }
  function button(label, action, toggles) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = [
      'all:unset', 'cursor:pointer', 'padding:6px 10px', 'border-radius:6px',
      'background:rgba(255,255,255,0.10)', 'white-space:nowrap'
    ].join(';');
    b.onmouseover = function () { b.style.background = 'rgba(255,255,255,0.22)'; };
    b.onmouseout = function () { b.style.background = b.dataset.on === '1'
      ? 'rgba(96,165,250,0.55)' : 'rgba(255,255,255,0.10)'; };
    b.onclick = function () {
      if (toggles) {
        b.dataset.on = b.dataset.on === '1' ? '0' : '1';
        b.textContent = b.dataset.on === '1' ? 'Gerry is watching' : 'Browse with Gerry';
        b.style.background = b.dataset.on === '1'
          ? 'rgba(96,165,250,0.55)' : 'rgba(255,255,255,0.10)';
      }
      send(action);
    };
    return b;
  }

  var watch = button('Browse with Gerry', 'follow', true);
  if (window.__lgFollowing) {
    watch.dataset.on = '1';
    watch.textContent = 'Gerry is watching';
    watch.style.background = 'rgba(96,165,250,0.55)';
  }
  wrap.appendChild(watch);
  wrap.appendChild(button('Ask Gerry', 'ask', false));
  wrap.appendChild(button('Save to KB', 'kb', false));
  wrap.appendChild(button('Pin', 'pin', false));
  wrap.appendChild(button('Canvas', 'canvas', false));
  (document.body || document.documentElement).appendChild(wrap);
  window.__lgBar = wrap;
  return true;
})()
"""


class _JsApi:
    """JavaScript bridge exposed to the React app as ``window.pywebview.api``."""

    # ── research browser ──────────────────────────────────────────────────
    # A second webview window the user drives themselves. Little Gerry renders
    # the address bar, tabs and bookmarks in the main window and steers this one
    # through the methods below; nothing here navigates on its own.

    @staticmethod
    def _safe_url(url: str) -> str:
        """Return a normalised http(s) URL, or '' if it is not one."""
        if not isinstance(url, str):
            return ""
        url = url.strip()
        if not url:
            return ""
        if not url.startswith(("http://", "https://")):
            url = "https://" + url.lstrip("/")
        return url if url.startswith(("http://", "https://")) else ""

    def browser_open(self, url: str = "") -> dict:
        """Show the research browser, navigating to ``url`` if given."""
        global _browser_win
        import webview

        target = self._safe_url(url) or "https://duckduckgo.com"
        try:
            with _browser_lock:
                if _browser_win is None:
                    def _closed() -> None:
                        global _browser_win
                        _browser_win = None

                    _browser_win = webview.create_window(
                        "Research — Little Gerry",
                        url=target,
                        width=1180,
                        height=880,
                        min_size=(600, 400),
                        text_select=True,
                        js_api=self,
                    )
                    _browser_win.events.closed += _closed
                    _browser_win.events.loaded += self._inject_toolbar
                    return {"ok": True, "url": target, "title": ""}
                _browser_win.load_url(target)
                _browser_win.show()
            return {"ok": True, "url": target, "title": ""}
        except Exception:
            _log_error()
            return {"ok": False, "error": "Could not open the research browser."}

    def _inject_toolbar(self) -> None:
        try:
            if _browser_win is not None:
                _browser_win.evaluate_js(
                    f"window.__lgFollowing={'true' if _browser_following[0] else 'false'};"
                    + _TOOLBAR_JS
                )
        except Exception:
            _log_error()

    # ── requests raised from the floating bar ────────────────────────────

    def browser_action(self, action: str) -> bool:
        """Queue a button press from the in-page bar for the React app to run."""
        if action in ("ask", "kb", "pin", "canvas", "follow"):
            _browser_actions.append(action)
        return True

    def browser_take_actions(self) -> list:
        """Hand over queued button presses and clear the queue."""
        pending, _browser_actions[:] = list(_browser_actions), []
        return pending

    def browser_set_following(self, following: bool) -> bool:
        _browser_following[0] = bool(following)
        return True

    def browser_navigate(self, url: str) -> dict:
        target = self._safe_url(url)
        if not target:
            return {"ok": False, "error": "That does not look like a web address."}
        if _browser_win is None:
            return self.browser_open(target)
        try:
            _browser_win.load_url(target)
            return {"ok": True, "url": target}
        except Exception:
            _log_error()
            return {"ok": False, "error": "Could not open that page."}

    def _browser_js(self, script: str):
        if _browser_win is None:
            return None
        try:
            return _browser_win.evaluate_js(script)
        except Exception:
            _log_error()
            return None

    def browser_back(self) -> bool:
        self._browser_js("history.back()")
        return True

    def browser_forward(self) -> bool:
        self._browser_js("history.forward()")
        return True

    def browser_reload(self) -> bool:
        self._browser_js("location.reload()")
        return True

    def browser_state(self) -> dict:
        """Where the browser currently is, for the address bar and tab strip."""
        if _browser_win is None:
            return {"open": False, "url": "", "title": ""}
        try:
            url = _browser_win.get_current_url() or ""
        except Exception:
            url = ""
        title = self._browser_js("document.title") or ""
        return {"open": True, "url": url, "title": title}

    def browser_fit(
        self, left: float, top: float, width: float, height: float,
        view_w: float, view_h: float,
    ) -> bool:
        """Park the browser window over a rectangle of the main window's page.

        The caller works in CSS pixels inside its own viewport; pywebview works
        in logical pixels around the outer window frame. Comparing the main
        window's frame size with the viewport size the caller reports gives the
        exact width of the title bar and borders, which both windows share — so
        no guessing and nothing to get wrong at fractional DPI scaling.

        The browser's own frame is placed inside the rectangle, title bar
        included, so its buttons never sit over the address bar above it.
        """
        if _browser_win is None or _win_ref is None:
            return False
        try:
            frame_w, frame_h = _win_ref.width, _win_ref.height
            chrome_w = max(0, frame_w - int(view_w))
            chrome_h = max(0, frame_h - int(view_h))
            border = chrome_w // 2
            title = max(0, chrome_h - border)

            _browser_win.move(int(_win_ref.x + border + left), int(_win_ref.y + title + top))
            _browser_win.resize(int(width), int(height))
            return True
        except Exception:
            _log_error()
            return False

    def browser_hide(self) -> bool:
        """Tuck the window away when the user moves to another part of the app."""
        if _browser_win is None:
            return False
        try:
            _browser_win.hide()
            return True
        except Exception:
            _log_error()
            return False

    def browser_show(self) -> bool:
        if _browser_win is None:
            return False
        try:
            _browser_win.show()
            return True
        except Exception:
            _log_error()
            return False

    def browser_capture(self) -> dict:
        """Read the rendered page — this is the only way content leaves the browser."""
        if _browser_win is None:
            return {"ok": False, "error": "The research browser is not open."}
        result = self._browser_js(_EXTRACT_JS)
        if not isinstance(result, dict):
            return {"ok": False, "error": "Could not read that page."}
        return {
            "ok": True,
            "url": result.get("url") or "",
            "title": result.get("title") or "",
            "text": result.get("text") or "",
        }

    def browser_close(self) -> bool:
        global _browser_win
        with _browser_lock:
            win, _browser_win = _browser_win, None
        if win is not None:
            try:
                win.destroy()
            except Exception:
                _log_error()
        return True

    def open_external(self, url: str) -> bool:
        """Open a URL in the user's default system browser.

        The embedded webview has no navigation chrome, so the frontend routes
        every external link here instead of navigating the app window.
        """
        try:
            if not isinstance(url, str):
                return False
            if not (url.startswith("http://") or url.startswith("https://")):
                return False  # only real web links — never file:// or scripts
            import webbrowser
            webbrowser.open(url)
            return True
        except Exception:
            _log_error()
            return False

    def save_file(self, filename: str, b64_data: str, open_after: bool = False) -> str:
        """Save attachment bytes to the user's Downloads folder; optionally open it.

        The embedded webview does not handle ``<a download>`` / ``window.open``
        for blob URLs, so the React app fetches the (authenticated) attachment
        bytes itself and hands them here as base64. Returns the saved path on
        success, or '' on failure.
        """
        try:
            import base64 as _b64
            import re as _re

            if not isinstance(filename, str) or not isinstance(b64_data, str):
                return ""

            # Accept a bare base64 string or a full data: URL.
            if "," in b64_data and b64_data.strip().lower().startswith("data:"):
                b64_data = b64_data.split(",", 1)[1]

            raw = _b64.b64decode(b64_data + "=" * (-len(b64_data) % 4))

            # Sanitize the filename — basename only, no traversal/odd chars.
            name = os.path.basename(filename or "attachment")
            name = _re.sub(r'[\\/:*?"<>|\r\n]+', "_", name).strip() or "attachment"

            downloads = Path.home() / "Downloads"
            downloads.mkdir(parents=True, exist_ok=True)

            # Avoid clobbering an existing file: append " (n)" before the extension.
            target = downloads / name
            if target.exists():
                stem, ext = os.path.splitext(name)
                i = 1
                while True:
                    candidate = downloads / f"{stem} ({i}){ext}"
                    if not candidate.exists():
                        target = candidate
                        break
                    i += 1

            target.write_bytes(raw)

            if open_after:
                try:
                    if IS_WINDOWS:
                        os.startfile(str(target))  # noqa: S606
                    elif IS_MAC:
                        subprocess.Popen(["open", str(target)])
                    else:
                        subprocess.Popen(["xdg-open", str(target)])
                except Exception:
                    _log_error()

            return str(target)
        except Exception:
            _log_error()
            return ""


def main() -> None:
    global _win_ref
    import webview

    # Build loading-page HTML (inline — no external files needed)
    # Embed logo as base64 so it works inside inline HTML (file:// is blocked by WebView2)
    logo_tag = ""
    if LOGO_PATH.exists():
        import base64
        logo_b64 = base64.b64encode(LOGO_PATH.read_bytes()).decode()
        logo_tag = (
            f'<img src="data:image/png;base64,{logo_b64}" '
            'style="width:150px;height:150px;object-fit:contain;display:block;" />'
        )
    loading_html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#000;display:flex;align-items:center;justify-content:center;
     height:100vh;font-family:'Segoe UI',system-ui,sans-serif;
     overflow:hidden;user-select:none;-webkit-user-select:none}}
.wrap{{display:flex;align-items:center;gap:32px}}
.text{{color:#fff}}
h1{{font-size:34px;font-weight:700;line-height:1}}
.sub{{color:#CC0000;font-size:14px;margin-top:7px}}
.div{{width:285px;height:1px;background:#CC0000;margin:14px 0 10px}}
#s{{color:#666;font-size:10px;margin-bottom:9px}}
.bar{{width:285px;height:3px;background:#1a1a1a;border-radius:2px;overflow:hidden}}
#f{{height:100%;background:#CC0000;width:0%;transition:width .35s ease}}
.copy{{position:fixed;bottom:14px;width:100%;text-align:center;color:#222;font-size:9px}}
</style></head>
<body>
<div class="wrap">
  <div class="logo">{logo_tag}</div>
  <div class="text">
    <h1>Little Gerry</h1>
    <div class="sub">PMI Agent</div>
    <div class="div"></div>
    <div id="s">Initializing...</div>
    <div class="bar"><div id="f"></div></div>
  </div>
</div>
<div class="copy">&copy; Precisian Medical Instruments</div>
</body></html>"""

    # Restore the window size/position from the last run (centered 1440x900 default).
    state = _load_window_state()
    if "x" in state:
        try:
            screens = webview.screens
            min_x = min(s.x for s in screens)
            min_y = min(s.y for s in screens)
            max_x = max(s.x + s.width for s in screens)
            max_y = max(s.y + s.height for s in screens)
            # If the saved position is fully off every screen (e.g. a monitor
            # was unplugged), fall back to centering instead.
            if not (min_x - 100 <= state["x"] <= max_x - 100 and min_y <= state["y"] <= max_y - 100):
                state.pop("x", None)
                state.pop("y", None)
        except Exception:
            state.pop("x", None)
            state.pop("y", None)

    win = webview.create_window(
        "Little Gerry",
        html=loading_html,
        width=state.get("width", 1440),
        height=state.get("height", 900),
        x=state.get("x"),
        y=state.get("y"),
        min_size=(900, 600),
        background_color="#000000",
        text_select=True,  # allow selecting/copying text (pywebview disables it by default)
        js_api=_JsApi(),   # exposes window.pywebview.api.open_external for system-browser links
    )
    _win_ref = win

    # Belt-and-braces: if any external link slips past the frontend handler,
    # pywebview should still open it in the system browser rather than navigating
    # the chrome-less app window.
    try:
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    except Exception:
        pass


    def _on_closing() -> bool | None:
        """Return False to cancel the close; return None to allow it."""
        global _skip_close_confirm
        _save_window_state(win)  # remember size/position for the next launch
        if _skip_close_confirm:
            return None  # tray already confirmed — allow
        message = (
            "Shut down Little Gerry and stop all services?\n\n"
            "This will close the backend, frontend, database, and Ollama."
        )
        title = "Little Gerry — Confirm Exit"
        if IS_WINDOWS:
            import ctypes
            IDYES = 6
            confirmed = ctypes.windll.user32.MessageBoxW(
                0, message, title, 0x24,  # MB_YESNO | MB_ICONQUESTION
            ) == IDYES
        else:
            # macOS / Unix: ask via the webview's native confirmation dialog.
            try:
                confirmed = bool(win.create_confirmation_dialog(title, message))
            except Exception:
                confirmed = True  # fall back to allowing the close
        if not confirmed:
            return False  # user chose No — cancel the close
        _skip_close_confirm = True  # prevent re-entry if destroy fires closing again
        return None  # allow close

    win.events.closing += _on_closing

    def _after_start(w) -> None:
        """Called by pywebview after the GUI is ready — start services in background."""
        threading.Thread(target=_boot, args=(w,), daemon=True).start()

    def _boot(w) -> None:
        _start_services()        # updates splash via _set_status → evaluate_js
        try:
            w.load_url(APP_URL)  # navigate to the React app
        except Exception:
            _log_error()

    # System tray: pystray's detached mode (run_detached) is Windows/X11 only.
    # The macOS (Cocoa) backend must own the main thread, which pywebview already
    # uses, so we skip the tray there. The window-close handler still stops every
    # service, and in-app Restart/Update commands arrive via the control file.
    icon = None
    global _icon_ref
    if IS_WINDOWS:
        icon = _make_tray(win)
        _icon_ref = icon
    threading.Thread(target=_poll_control_file, daemon=True).start()
    if icon is not None:
        icon.run_detached(setup=lambda i: setattr(i, "visible", True))

    # gui="winforms" is the most stable Windows backend (WinForms + Edge WebView2).
    # On macOS pywebview uses its native Cocoa/WebKit backend automatically.
    # private_mode=False keeps cookies on disk so a site the user signs into in
    # the research browser is still signed in next launch.
    store = Path.home() / ".pmi-agent" / "webview"
    try:
        store.mkdir(parents=True, exist_ok=True)
    except Exception:
        _log_error()
    if IS_WINDOWS:
        webview.start(
            _after_start, win, gui="winforms", debug=False,
            private_mode=False, storage_path=str(store),
        )
    else:
        webview.start(
            _after_start, win, debug=False,
            private_mode=False, storage_path=str(store),
        )

    # Reached here only when the window is closed
    _force_exit_after(12)  # guarantee exit even if teardown blocks
    _stop_all()
    if icon is not None:
        icon.stop()
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        _log_error()
