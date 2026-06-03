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
import subprocess
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

HEALTH_URL = "http://127.0.0.1:8000/health"
APP_URL    = "http://localhost:5173"
NO_WIN     = subprocess.CREATE_NO_WINDOW

_procs: list[subprocess.Popen] = []
_status_text = "Initializing..."
_status_step = 0
_ready       = threading.Event()
_win_ref     = None          # set to webview.Window once created


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
                f"if(f)f.style.width='{min(max(_status_step,0),7)/7*100:.0f}%';"
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

def _start_services() -> None:
    try:
        # 1. Docker
        _set_status("Checking Docker...", 1)
        if _run("docker info").returncode != 0:
            _set_status("Starting Docker...", 1)
            _run("sc start com.docker.service")
            for _ in range(20):
                time.sleep(3)
                if _run("docker info").returncode == 0:
                    break

        # 2. PostgreSQL
        _set_status("Starting PostgreSQL...", 2)
        r     = _run('docker inspect --format "{{.State.Status}}" pmi_postgres')
        state = r.stdout.decode(errors="ignore").strip().strip('"')
        if state == "running":
            pass
        elif state == "exited":
            _run("docker start pmi_postgres")
            time.sleep(3)
        else:
            _run("docker compose up -d --remove-orphans", cwd=str(ROOT))
            time.sleep(8)

        # 3. Ollama
        _set_status("Starting Ollama...", 3)
        if "ollama.exe" not in _run("tasklist").stdout.decode(errors="ignore").lower():
            subprocess.Popen(
                ["powershell", "-WindowStyle", "Hidden", "-Command",
                 "Start-Process ollama -ArgumentList serve -WindowStyle Hidden"],
                creationflags=NO_WIN,
            )
            time.sleep(2)

        # 4. Backend
        _set_status("Starting backend...", 4)
        _kill_port(8000)
        time.sleep(0.5)
        _procs.append(subprocess.Popen(
            [str(VENV_PYTHON), "-m", "uvicorn", "main:app",
             "--host", "127.0.0.1", "--port", "8000"],
            cwd=str(BACKEND_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=NO_WIN,
        ))

        # 5. Frontend
        _set_status("Starting frontend...", 5)
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
        _set_status("Waiting for app...", 6)
        for _ in range(40):
            if _health_ok():
                break
            time.sleep(1)

        _set_status("Ready!", 7)
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
    _run("taskkill /f /im ollama.exe")
    _run('taskkill /f /im "ollama app.exe"')


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
        if win:
            try:
                win.destroy()
            except Exception:
                pass
        _stop_all()
        icon.stop()
        os._exit(0)

    return pystray.Icon(
        "LittleGerry", icon_img, "Little Gerry",
        pystray.Menu(
            pystray.MenuItem("Little Gerry", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open App", on_open, default=True),
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
    )
    _win_ref = win

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
