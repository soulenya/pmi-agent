"""
Little Gerry — silent launcher.

* Shows a branded splash screen while all services start
* Runs backend, frontend, Docker, and Ollama with no visible terminal windows
* Sits in the system tray; double-click = open app, right-click = Stop / Open
* Errors are logged to backend/logs/launcher.log
"""
from __future__ import annotations

import datetime
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


# ── helpers ──────────────────────────────────────────────────────────────────

def _set_status(text: str, step: int | None = None) -> None:
    global _status_text, _status_step
    _status_text = text
    if step is not None:
        _status_step = step


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


# ── splash screen (tkinter, runs on main thread) ──────────────────────────────

def _show_splash() -> None:
    import tkinter as tk
    from tkinter import ttk

    root = tk.Tk()
    root.overrideredirect(True)       # no title bar / chrome
    root.configure(bg="#000000")
    root.attributes("-topmost", True)

    W, H = 520, 300
    sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
    root.geometry(f"{W}x{H}+{(sw - W) // 2}+{(sh - H) // 2}")

    # Logo
    try:
        from PIL import Image, ImageTk
        logo    = Image.open(LOGO_PATH).resize((170, 170), Image.LANCZOS)
        photo   = ImageTk.PhotoImage(logo)
        lbl     = tk.Label(root, image=photo, bg="#000000", bd=0)
        lbl.image = photo
        lbl.place(x=20, y=65)
    except Exception:
        pass

    # Title
    tk.Label(root, text="Little Gerry",
             font=("Segoe UI", 30, "bold"), fg="#FFFFFF", bg="#000000"
             ).place(x=210, y=68)

    # Subtitle
    tk.Label(root, text="PMI Agent",
             font=("Segoe UI", 13), fg="#CC0000", bg="#000000"
             ).place(x=213, y=118)

    # Red divider
    tk.Frame(root, bg="#CC0000", width=285, height=1).place(x=210, y=150)

    # Status label
    status_var = tk.StringVar(value="Initializing...")
    tk.Label(root, textvariable=status_var,
             font=("Segoe UI", 9), fg="#888888", bg="#000000"
             ).place(x=213, y=162)

    # Progress bar styled red
    style = ttk.Style()
    style.theme_use("clam")
    style.configure("LG.Horizontal.TProgressbar",
                    foreground="#CC0000", background="#CC0000",
                    troughcolor="#1a1a1a", bordercolor="#000000",
                    lightcolor="#CC0000", darkcolor="#CC0000")
    pb = ttk.Progressbar(root, style="LG.Horizontal.TProgressbar",
                         length=285, mode="determinate", maximum=7)
    pb.place(x=210, y=195)

    # Copyright
    tk.Label(root, text="\u00a9 Precisian Medical Instruments",
             font=("Segoe UI", 7), fg="#333333", bg="#000000"
             ).place(x=213, y=272)

    def poll() -> None:
        status_var.set(_status_text)
        pb["value"] = max(0, _status_step)
        if _ready.is_set():
            root.after(400, root.destroy)   # brief flash of "Ready!"
        else:
            root.after(200, poll)

    root.after(200, poll)
    root.mainloop()


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
    import webview

    threading.Thread(target=_start_services, daemon=True).start()
    _show_splash()          # blocks until _ready fires

    # Create the native app window (Edge WebView2)
    win = webview.create_window(
        "Little Gerry",
        APP_URL,
        width=1440,
        height=900,
        min_size=(900, 600),
        background_color="#000000",
    )

    # Start system tray in background (run_detached doesn't block)
    icon = _make_tray(win)
    icon.run_detached(setup=lambda i: setattr(i, "visible", True))

    # Start pywebview — blocks on main thread until the window is closed
    webview.start(gui="edgechromium", debug=False)

    # Window closed — clean up everything
    _stop_all()
    icon.stop()
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        _log_error()
