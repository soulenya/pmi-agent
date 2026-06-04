"""
Google Workspace integration service.

Handles OAuth token lifecycle and provides read methods for
Gmail, Drive, Calendar, and Contacts plus write methods
(used only after explicit user approval via the proposals API).
"""
from __future__ import annotations

import base64
import email.mime.text
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

_BACKEND = Path(__file__).parent.parent
CREDS_FILE = _BACKEND / "google_credentials.json"
TOKEN_FILE  = _BACKEND / "google_token.json"

_auth_status: str = "disconnected"
_auth_lock = threading.Lock()


# ── credential helpers ────────────────────────────────────────────────────

def get_credentials():
    """Return valid Credentials or None."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    if not TOKEN_FILE.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            TOKEN_FILE.write_text(creds.to_json())
        except Exception:
            return None
    return creds if (creds and creds.valid) else None


def get_status() -> dict:
    creds = get_credentials()
    if creds:
        import json
        token_data = json.loads(TOKEN_FILE.read_text())
        return {
            "connected": True,
            "status": "connected",
            "email": token_data.get("id_token", {}) if isinstance(token_data.get("id_token"), dict) else "",
        }
    with _auth_lock:
        status = _auth_status
    result: dict = {"connected": False, "status": status}
    if status.startswith("error:"):
        result["error"] = status[6:]
    return result


def start_auth_flow() -> None:
    """Kick off InstalledAppFlow in a background thread — opens browser automatically."""
    global _auth_status
    with _auth_lock:
        if _auth_status == "pending":
            return
        _auth_status = "pending"

    _LOG_FILE = _BACKEND / "logs" / "google_auth.log"

    def _log(msg: str) -> None:
        try:
            _LOG_FILE.parent.mkdir(exist_ok=True)
            import datetime as _dt
            with open(_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(f"{_dt.datetime.now()}: {msg}\n")
        except Exception:
            pass

    def _open_url(url: str, *a, **kw) -> bool:
        """Open a URL from pythonw.exe (no console) using multiple fallbacks."""
        _log(f"Opening URL (first 80 chars): {url[:80]}")
        # 1. os.startfile — passes URL to Windows shell (default browser handler)
        try:
            import os as _os2
            _os2.startfile(url)
            _log("Browser opened via os.startfile")
            return True
        except Exception as e:
            _log(f"os.startfile failed: {e}")
        # 2. cmd /c start — explicit shell command, always works on Windows
        try:
            import subprocess as _sp
            _sp.Popen(
                ["cmd", "/c", "start", "", url],
                creationflags=_sp.CREATE_NO_WINDOW,
                shell=False,
            )
            _log("Browser opened via cmd /c start")
            return True
        except Exception as e:
            _log(f"cmd /c start failed: {e}")
        # 3. rundll32 — last resort
        try:
            import subprocess as _sp
            _sp.Popen(
                ["rundll32", "url.dll,FileProtocolHandler", url],
                creationflags=_sp.CREATE_NO_WINDOW,
            )
            _log("Browser opened via rundll32")
            return True
        except Exception as e:
            _log(f"rundll32 failed: {e}")
        _log("All browser-open attempts failed")
        return False

    def _run() -> None:
        global _auth_status
        import traceback as _tb
        try:
            _log("Auth thread started")
            import webbrowser
            from google_auth_oauthlib.flow import InstalledAppFlow

            # Patch all webbrowser open variants so run_local_server uses our
            # reliable opener regardless of which method it calls internally.
            webbrowser.open = _open_url
            webbrowser.open_new = _open_url
            webbrowser.open_new_tab = _open_url
            _log("webbrowser patched")

            if not CREDS_FILE.exists():
                raise FileNotFoundError(f"google_credentials.json not found at {CREDS_FILE}")

            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            _log("Flow created, calling run_local_server...")
            # prompt='consent' forces Google to show ALL scopes every time,
            # bypassing the server-side consent cache from previous partial grants.
            creds = flow.run_local_server(port=0, open_browser=True, prompt="consent")
            _log("run_local_server returned — writing token")
            TOKEN_FILE.write_text(creds.to_json())
            with _auth_lock:
                _auth_status = "connected"
            _log("Auth complete — status = connected")
        except Exception as exc:
            err = str(exc)
            _log(f"EXCEPTION: {err}\n{_tb.format_exc()}")
            with _auth_lock:
                _auth_status = f"error:{err}"

    threading.Thread(target=_run, daemon=True).start()


def revoke() -> None:
    global _auth_status
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()
    with _auth_lock:
        _auth_status = "disconnected"


def _require_creds():
    creds = get_credentials()
    if not creds:
        raise RuntimeError("Google account not connected. Please authenticate first.")
    return creds


def _build(service: str, version: str):
    from googleapiclient.discovery import build
    return build(service, version, credentials=_require_creds())


# ── Gmail ─────────────────────────────────────────────────────────────────

def gmail_search(query: str, max_results: int = 10) -> list[dict]:
    svc = _build("gmail", "v1")
    resp = svc.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    msgs = resp.get("messages", [])
    out = []
    for m in msgs:
        detail = svc.users().messages().get(
            userId="me", id=m["id"], format="metadata",
            metadataHeaders=["From", "To", "Subject", "Date"],
        ).execute()
        headers = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
        out.append({
            "id": m["id"],
            "from": headers.get("From", ""),
            "to": headers.get("To", ""),
            "subject": headers.get("Subject", ""),
            "date": headers.get("Date", ""),
            "snippet": detail.get("snippet", ""),
        })
    return out


def gmail_get_message(message_id: str) -> dict:
    svc = _build("gmail", "v1")
    m = svc.users().messages().get(userId="me", id=message_id, format="full").execute()
    headers = {h["name"]: h["value"] for h in m.get("payload", {}).get("headers", [])}
    return {
        "id": message_id,
        "from": headers.get("From", ""),
        "to": headers.get("To", ""),
        "subject": headers.get("Subject", ""),
        "date": headers.get("Date", ""),
        "body": _extract_body(m.get("payload", {})),
    }


def _extract_body(payload: dict) -> str:
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
    if mime.startswith("multipart/"):
        for part in payload.get("parts", []):
            text = _extract_body(part)
            if text:
                return text
    return payload.get("snippet", "")


def gmail_send(to: str, subject: str, body: str) -> dict:
    svc = _build("gmail", "v1")
    msg = email.mime.text.MIMEText(body)
    msg["to"] = to
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    result = svc.users().messages().send(userId="me", body={"raw": raw}).execute()
    return {"message_id": result["id"], "status": "sent"}


# ── Drive ─────────────────────────────────────────────────────────────────

def drive_search(query: str, max_results: int = 10) -> list[dict]:
    svc = _build("drive", "v3")
    resp = svc.files().list(
        q=f"fullText contains '{query}' and trashed=false",
        pageSize=max_results,
        fields="files(id,name,mimeType,modifiedTime,webViewLink,owners)",
    ).execute()
    return [
        {
            "id": f["id"],
            "name": f["name"],
            "type": f.get("mimeType", ""),
            "modified": f.get("modifiedTime", ""),
            "url": f.get("webViewLink", ""),
            "owner": (f.get("owners") or [{}])[0].get("displayName", ""),
        }
        for f in resp.get("files", [])
    ]


def drive_list_folder(folder_id: str = "root", max_results: int = 50) -> list[dict]:
    """List the direct children (files and folders) of a Drive folder."""
    svc = _build("drive", "v3")
    resp = svc.files().list(
        q=f"'{folder_id}' in parents and trashed=false",
        pageSize=max_results,
        orderBy="folder,name",
        fields="files(id,name,mimeType,modifiedTime,webViewLink)",
    ).execute()
    items = []
    for f in resp.get("files", []):
        mime = f.get("mimeType", "")
        is_folder = mime == "application/vnd.google-apps.folder"
        items.append({
            "id": f["id"],
            "name": f["name"],
            "type": "folder" if is_folder else mime,
            "modified": f.get("modifiedTime", ""),
            "url": f.get("webViewLink", ""),
        })
    return items


def drive_get_content(file_id: str) -> dict:
    svc = _build("drive", "v3")
    meta = svc.files().get(fileId=file_id, fields="id,name,mimeType,webViewLink").execute()
    mime = meta.get("mimeType", "")
    content = ""

    export_map = {
        "application/vnd.google-apps.document":     "text/plain",
        "application/vnd.google-apps.spreadsheet":  "text/csv",
        "application/vnd.google-apps.presentation": "text/plain",
    }
    if mime in export_map:
        raw = svc.files().export(fileId=file_id, mimeType=export_map[mime]).execute()
        content = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
    elif mime.startswith("text/"):
        raw = svc.files().get_media(fileId=file_id).execute()
        content = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)

    return {
        "id": file_id,
        "name": meta.get("name", ""),
        "type": mime,
        "url": meta.get("webViewLink", ""),
        "content": content[:10_000],
    }


# ── Calendar ──────────────────────────────────────────────────────────────

def calendar_events(days_behind: int = 0, days_ahead: int = 7) -> list[dict]:
    svc = _build("calendar", "v3")
    now = datetime.now(timezone.utc)
    resp = svc.events().list(
        calendarId="primary",
        timeMin=(now - timedelta(days=days_behind)).isoformat(),
        timeMax=(now + timedelta(days=days_ahead)).isoformat(),
        maxResults=50, singleEvents=True, orderBy="startTime",
    ).execute()
    out = []
    for e in resp.get("items", []):
        start = e.get("start", {})
        end   = e.get("end", {})
        out.append({
            "id": e.get("id", ""),
            "title": e.get("summary", "(No title)"),
            "start": start.get("dateTime", start.get("date", "")),
            "end":   end.get("dateTime", end.get("date", "")),
            "location": e.get("location", ""),
            "description": (e.get("description") or "")[:500],
            "attendees": [a.get("email", "") for a in e.get("attendees", [])],
            "url": e.get("htmlLink", ""),
        })
    return out


def calendar_create_event(
    title: str, start: str, end: str,
    description: str = "", location: str = "", attendees: list[str] | None = None,
) -> dict:
    svc = _build("calendar", "v3")
    body: dict[str, Any] = {
        "summary": title,
        "start": {"dateTime": start, "timeZone": "UTC"},
        "end":   {"dateTime": end,   "timeZone": "UTC"},
        "description": description,
        "location": location,
        "attendees": [{"email": e} for e in (attendees or [])],
    }
    event = svc.events().insert(calendarId="primary", body=body).execute()
    return {"id": event["id"], "url": event.get("htmlLink", ""), "status": "created"}


# ── Contacts ──────────────────────────────────────────────────────────────

def contacts_search(query: str, max_results: int = 10) -> list[dict]:
    svc = _build("people", "v1")
    resp = svc.people().searchContacts(
        query=query,
        readMask="names,emailAddresses,phoneNumbers,organizations",
        pageSize=max_results,
    ).execute()
    out = []
    for r in resp.get("results", []):
        p = r.get("person", {})
        names  = p.get("names", [])
        emails = p.get("emailAddresses", [])
        phones = p.get("phoneNumbers", [])
        orgs   = p.get("organizations", [])
        out.append({
            "name":    names[0].get("displayName", "")  if names  else "",
            "email":   emails[0].get("value", "")       if emails else "",
            "phone":   phones[0].get("value", "")       if phones else "",
            "company": orgs[0].get("name", "")          if orgs   else "",
        })
    return out


# ── Sheets ────────────────────────────────────────────────────────────────

def sheets_read(spreadsheet_id: str, range_: str = "Sheet1") -> dict:
    """Read values from a Google Sheet range (e.g. 'Sheet1!A1:Z100')."""
    svc = _build("sheets", "v4")
    result = svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=range_,
    ).execute()
    rows = result.get("values", [])
    return {
        "spreadsheet_id": spreadsheet_id,
        "range": result.get("range", range_),
        "rows": rows,
        "row_count": len(rows),
    }


def sheets_get_metadata(spreadsheet_id: str) -> dict:
    """Get sheet names and basic metadata for a spreadsheet."""
    svc = _build("sheets", "v4")
    meta = svc.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="spreadsheetId,properties.title,sheets.properties",
    ).execute()
    return {
        "id": meta.get("spreadsheetId", ""),
        "title": meta.get("properties", {}).get("title", ""),
        "sheets": [
            s["properties"]["title"]
            for s in meta.get("sheets", [])
        ],
    }


# ── Tasks ─────────────────────────────────────────────────────────────────

def tasks_list(max_results: int = 25, show_completed: bool = False) -> list[dict]:
    """List tasks across all Google Task lists (default: incomplete only)."""
    svc = _build("tasks", "v1")
    lists_resp = svc.tasklists().list(maxResults=10).execute()
    out: list[dict] = []
    for lst in lists_resp.get("items", []):
        tasks_resp = svc.tasks().list(
            tasklist=lst["id"],
            maxResults=max_results,
            showCompleted=show_completed,
            showHidden=False,
        ).execute()
        for t in tasks_resp.get("items", []):
            out.append({
                "id": t["id"],
                "title": t.get("title", ""),
                "list": lst.get("title", ""),
                "due": t.get("due", ""),
                "notes": t.get("notes", ""),
                "status": t.get("status", ""),
            })
    return out
