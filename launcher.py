"""
Little Gerry — silent launcher.

* Shows a branded splash screen while all services start
* Runs backend, frontend, Docker, and Ollama with no visible terminal windows
* Sits in the system tray; double-click = open app, right-click = Stop / Open
* Errors are logged to backend/logs/launcher.log
"""
from __future__ import annotations

import datetime
import json
import os
import shutil
import subprocess
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
VENV_PYTHON  = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"

HEALTH_URL    = "http://127.0.0.1:8000/health"
APP_URL       = "http://localhost:5173"
NO_WIN        = subprocess.CREATE_NO_WINDOW
CONTROL_FILE  = BACKEND_DIR / "logs" / "launcher_cmd.txt"

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


def _run(cmd: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=cwd, shell=True,
        capture_output=True, creationflags=NO_WIN,
    )


def _kill_port(port: int) -> None:
    r = _run(f'netstat -aon | findstr ":{port} "')
    for line in r.stdout.decode(errors="ignore").splitlines():
        parts = line.split()
        if len(parts) >= 5 and f":{port}" in parts[1]:
            _run(f"taskkill /f /pid {parts[4]}")


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


def _spawn_detached(args):
    """
    Launch a fully independent child process that survives this launcher exiting.

    Critically uses CREATE_BREAKAWAY_FROM_JOB: when the launcher (pythonw.exe) is
    running inside a Windows Job Object with kill-on-close (which can happen
    depending on how it was started), a plain detached child would JOIN that job
    and be killed the instant this process calls os._exit(0) — before it could do
    any work. Breaking away from the job lets the updater run to completion.
    Falls back to a plain detached spawn if the job forbids breakaway.
    """
    DETACHED = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    CREATE_BREAKAWAY_FROM_JOB = 0x01000000
    try:
        return subprocess.Popen(
            args,
            creationflags=DETACHED | CREATE_BREAKAWAY_FROM_JOB,
            close_fds=True,
        )
    except OSError:
        return subprocess.Popen(args, creationflags=DETACHED, close_fds=True)


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

        asset = next(
            (a for a in data.get("assets", []) if a.get("name") == "LittleGerry_Setup.exe"),
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
        target = Path(tempfile.gettempdir()) / "LittleGerry_Setup_update.exe"
        with urllib.request.urlopen(dl_req, timeout=300) as r, open(target, "wb") as out:
            shutil.copyfileobj(r, out)

        _set_status("Installing update...", 0)
        apply_script = ROOT / "scripts" / "apply_update.ps1"
        _spawn_detached(
            [
                "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", str(apply_script),
                "-Installer", str(target),
                "-AppDir", str(ROOT),
            ]
        )
        return True
    except Exception:
        _log_error()
        return False


def _auto_update() -> None:
    """
    Pull the latest code from GitHub at launch so updates reach every user
    automatically. Safety guards:
      * skips silently if this isn't a git checkout,
      * skips if the working tree is dirty (protects developer machines with
        uncommitted changes from a destructive reset),
      * only runs the heavier dependency install when the code actually changed.
    Database migrations run later, after PostgreSQL is up.
    """
    if not (ROOT / ".git").exists():
        return
    try:
        _set_status("Checking for updates...", 0)

        # Don't clobber local work (dev machines / in-progress edits).
        dirty = _run("git status --porcelain", cwd=str(ROOT)).stdout.decode(errors="ignore").strip()
        if dirty:
            return

        _run("git fetch origin", cwd=str(ROOT))
        local = _run("git rev-parse HEAD", cwd=str(ROOT)).stdout.decode(errors="ignore").strip()
        remote = _run("git rev-parse origin/master", cwd=str(ROOT)).stdout.decode(errors="ignore").strip()
        if not local or not remote or local == remote:
            return  # already current

        _set_status("Installing the latest update...", 0)
        _run("git reset --hard origin/master", cwd=str(ROOT))
        # Refresh dependencies to match the new code.
        _run("uv sync", cwd=str(BACKEND_DIR))
        _run("npm install --silent", cwd=str(FRONTEND_DIR))
        _set_status("Update installed.", 0)
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

        # 1. Docker
        _set_status("Checking Docker...", 1)
        if _run("docker info").returncode != 0:
            _set_status("Starting Docker...", 1)
            # Try Windows service (harmless if it fails) and launch Desktop.exe simultaneously
            _run("sc start com.docker.service")
            desktop_exe = r"C:\Program Files\Docker\Docker\Docker Desktop.exe"
            if Path(desktop_exe).exists():
                subprocess.Popen([desktop_exe], creationflags=NO_WIN)
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
            creationflags=NO_WIN,
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
            creationflags=NO_WIN,
            shell=True,
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

def _stop_all() -> None:
    for p in _procs:
        try:
            p.terminate()
        except Exception:
            pass
    _kill_port(8000)
    _kill_port(5173)
    _run("docker stop pmi_postgres")


# ── control-file command handler (called from poll thread) ──────────────────

def _handle_control_cmd(cmd: str) -> None:
    global _skip_close_confirm
    if cmd == "restart":
        threading.Thread(target=_restart_services, daemon=True).start()
    elif cmd == "stop":
        _skip_close_confirm = True
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

    win = webview.create_window(
        "Little Gerry",
        html=loading_html,
        width=1440,
        height=900,
        min_size=(900, 600),
        background_color="#000000",
        text_select=True,  # allow selecting/copying text (pywebview disables it by default)
    )
    _win_ref = win

    def _on_closing() -> bool | None:
        """Return False to cancel the close; return None to allow it."""
        global _skip_close_confirm
        if _skip_close_confirm:
            return None  # tray already confirmed — allow
        import ctypes
        IDYES = 6
        result = ctypes.windll.user32.MessageBoxW(
            0,
            "Shut down Little Gerry and stop all services?\n\n"
            "This will close the backend, frontend, database, and Ollama.",
            "Little Gerry — Confirm Exit",
            0x24,  # MB_YESNO | MB_ICONQUESTION
        )
        if result != IDYES:
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

    icon = _make_tray(win)
    global _icon_ref
    _icon_ref = icon
    threading.Thread(target=_poll_control_file, daemon=True).start()
    icon.run_detached(setup=lambda i: setattr(i, "visible", True))

    # gui="winforms" is the most stable Windows backend (WinForms + Edge WebView2)
    webview.start(_after_start, win, gui="winforms", debug=False)

    # Reached here only when the window is closed
    _stop_all()
    icon.stop()
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        _log_error()
