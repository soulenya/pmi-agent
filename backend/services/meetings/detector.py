"""
Detect whether a video-call / meeting is currently active on this machine.

Two complementary signals:
  1. **In-call processes** — apps that spawn a helper process ONLY while in a
     meeting (e.g. Zoom's ``CptHost.exe``). The mere presence of Zoom/Teams in
     the tray is NOT a meeting, so we look for these call-specific processes.
  2. **Window titles** (Windows) — browser-based calls (Google Meet, Zoom web,
     Teams web) and native call windows expose a recognizable title while the
     call is on screen.

On non-Windows we can't read window titles cheaply, so we fall back to native
meeting-app processes as a best-effort detect-only signal.
"""

from __future__ import annotations

import logging
import re
import sys

import psutil

logger = logging.getLogger(__name__)

# Helper processes that exist ONLY during an active call → strong signal.
_INCALL_PROCESS_NAMES: dict[str, str] = {
    "cpthost.exe": "Zoom",        # Zoom in-meeting host
    "aomhost64.exe": "Zoom",      # Zoom meeting host (older builds)
}

# Native meeting apps. Used as a weak/best-effort signal on non-Windows only,
# since on Windows these often sit idle in the tray (not in a call).
_APP_PROCESS_NAMES: dict[str, str] = {
    "zoom.exe": "Zoom",
    "zoom.us": "Zoom",
    "zoom": "Zoom",
    "ms-teams.exe": "Microsoft Teams",
    "msteams.exe": "Microsoft Teams",
    "teams.exe": "Microsoft Teams",
    "microsoft teams": "Microsoft Teams",
    "webex.exe": "Webex",
    "webexmta.exe": "Webex",
    "ciscowebexstart.exe": "Webex",
}

# Window-title patterns that indicate a call is on screen (case-insensitive).
_TITLE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Zoom", re.compile(r"zoom meeting", re.I)),
    ("Google Meet", re.compile(r"google meet|meet\.google\.com|^meet\s*[-–]", re.I)),
    ("Microsoft Teams", re.compile(
        r"\|\s*microsoft teams|microsoft teams.*(meeting|call)|(meeting|call).*microsoft teams",
        re.I,
    )),
    ("Webex", re.compile(r"cisco webex|webex meeting", re.I)),
]


def _running_process_names() -> set[str]:
    names: set[str] = set()
    for proc in psutil.process_iter(["name"]):
        name = proc.info.get("name")
        if name:
            names.add(name.lower())
    return names


def _window_titles() -> list[str]:
    """Visible top-level window titles (Windows only; empty elsewhere)."""
    if sys.platform != "win32":
        return []
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        titles: list[str] = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def _callback(hwnd, _lparam):  # noqa: ANN001
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            if buf.value:
                titles.append(buf.value)
            return True

        user32.EnumWindows(_callback, 0)
        return titles
    except Exception as exc:                    # noqa: BLE001
        logger.debug("Window enumeration failed: %s", exc)
        return []


def detect_active_meeting() -> str | None:
    """Return the platform label of an active meeting, or None if none detected."""
    names = _running_process_names()

    # 1. Strong in-call process signal.
    for proc_name, label in _INCALL_PROCESS_NAMES.items():
        if proc_name in names:
            return label

    # 2. Window titles (in-call browser/native windows).
    for title in _window_titles():
        for label, pattern in _TITLE_PATTERNS:
            if pattern.search(title):
                return label

    # 3. Best-effort fallback where titles aren't available (non-Windows).
    if sys.platform != "win32":
        for proc_name, label in _APP_PROCESS_NAMES.items():
            if proc_name in names:
                return label

    return None
