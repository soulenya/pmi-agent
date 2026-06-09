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
    "https://www.googleapis.com/auth/drive.file",
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
        """Open a URL from a no-console process using platform-specific fallbacks."""
        _log(f"Opening URL (first 80 chars): {url[:80]}")
        import sys as _sys
        if _sys.platform == "darwin":
            # macOS: hand the URL to the default browser via `open`.
            try:
                import subprocess as _sp
                _sp.Popen(["open", url])
                _log("Browser opened via open")
                return True
            except Exception as e:
                _log(f"open failed: {e}")
            try:
                import webbrowser as _wb
                if _wb.open(url):
                    _log("Browser opened via webbrowser")
                    return True
            except Exception as e:
                _log(f"webbrowser failed: {e}")
            _log("All browser-open attempts failed")
            return False
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


def gmail_get_attachments(message_id: str) -> list[dict]:
    """Return downloadable file attachments for a Gmail message.

    Each item: ``{filename, mime_type, attachment_id, size, data (bytes)}``.
    Inline parts without a filename are skipped. Used by the daily assistant
    scan to auto-import meeting-summary attachments into the Knowledge Base.
    """
    svc = _build("gmail", "v1")
    msg = svc.users().messages().get(userId="me", id=message_id, format="full").execute()
    out: list[dict] = []

    def _walk(part: dict) -> None:
        filename = part.get("filename") or ""
        body = part.get("body", {}) or {}
        att_id = body.get("attachmentId")
        if filename and att_id:
            att = (
                svc.users()
                .messages()
                .attachments()
                .get(userId="me", messageId=message_id, id=att_id)
                .execute()
            )
            data = att.get("data", "")
            raw = base64.urlsafe_b64decode(data + "==") if data else b""
            out.append({
                "filename": filename,
                "mime_type": part.get("mimeType", ""),
                "attachment_id": att_id,
                "size": body.get("size", 0),
                "data": raw,
            })
        for child in part.get("parts", []) or []:
            _walk(child)

    _walk(msg.get("payload", {}))
    return out



# ── Drive ─────────────────────────────────────────────────────────────────

def drive_search(query: str, max_results: int = 10) -> list[dict]:
    svc = _build("drive", "v3")
    resp = svc.files().list(
        q=f"fullText contains '{query}' and trashed=false",
        pageSize=max_results,
        fields="files(id,name,mimeType,modifiedTime,webViewLink,owners)",
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
        corpora="allDrives",
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


def drive_upload_file(
    local_path: str,
    name: str | None = None,
    folder_id: str | None = None,
) -> dict:
    """Upload a local file to the user's Google Drive and return its metadata.

    Requires the ``drive.file`` scope (granted on connect). ``name`` overrides the
    Drive filename; ``folder_id`` places the file inside a folder. Returns
    ``{id, name, url}`` where ``url`` is the shareable webViewLink.
    """
    import mimetypes
    from googleapiclient.http import MediaFileUpload

    p = Path(local_path)
    if not p.is_file():
        raise RuntimeError(f"Local file not found: {local_path}")

    drive_name = name or p.name
    mime_type = mimetypes.guess_type(p.name)[0] or "application/octet-stream"

    metadata: dict[str, Any] = {"name": drive_name}
    if folder_id:
        metadata["parents"] = [folder_id]

    svc = _build("drive", "v3")
    media = MediaFileUpload(str(p), mimetype=mime_type, resumable=False)
    created = svc.files().create(
        body=metadata,
        media_body=media,
        fields="id,name,webViewLink",
        supportsAllDrives=True,
    ).execute()
    return {
        "id": created.get("id", ""),
        "name": created.get("name", drive_name),
        "url": created.get("webViewLink", ""),
    }


def drive_search_by_name(name_contains: str, max_results: int = 25) -> list[dict]:
    """Find Drive files whose name contains ``name_contains`` (newest first).

    Used by the daily assistant scan to locate Gemini meeting-notes Docs, which
    Google names like ``"<Meeting> - <date> - Notes by Gemini"``.
    """
    svc = _build("drive", "v3")
    safe = name_contains.replace("\\", "\\\\").replace("'", "\\'")
    resp = svc.files().list(
        q=f"name contains '{safe}' and trashed=false",
        pageSize=max_results,
        orderBy="modifiedTime desc",
        fields="files(id,name,mimeType,modifiedTime,webViewLink,owners)",
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
        corpora="allDrives",
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
    """List the direct children (files and folders) of a Drive folder, including shared drives.

    When ``drive_id`` is supplied the caller is navigating the ROOT of a shared
    drive.  The Google Drive API requires ``corpora='drive'`` + ``driveId`` in
    that case; the regular ``'{id}' in parents`` query returns nothing.
    """
    svc = _build("drive", "v3")

    # Shared-drive root: use corpora='drive' mode
    if drive_id:
        resp = svc.files().list(
            corpora="drive",
            driveId=drive_id,
            q=f"'{folder_id}' in parents and trashed=false",
            pageSize=max_results,
            orderBy="folder,name",
            fields="files(id,name,mimeType,modifiedTime,webViewLink)",
            includeItemsFromAllDrives=True,
            supportsAllDrives=True,
        ).execute()
    else:
        resp = svc.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            pageSize=max_results,
            orderBy="folder,name",
            fields="files(id,name,mimeType,modifiedTime,webViewLink)",
            includeItemsFromAllDrives=True,
            supportsAllDrives=True,
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


def drive_list_shared_drives(max_results: int = 20) -> list[dict]:
    """List all shared/team drives the user has access to."""
    svc = _build("drive", "v3")
    resp = svc.drives().list(
        pageSize=max_results,
        fields="drives(id,name)",
    ).execute()
    return [
        {"id": d["id"], "name": d["name"], "type": "shared_drive"}
        for d in resp.get("drives", [])
    ]


def drive_get_content(file_id: str) -> dict:
    svc = _build("drive", "v3")
    meta = svc.files().get(
        fileId=file_id,
        fields="id,name,mimeType,webViewLink,modifiedTime",
        supportsAllDrives=True,
    ).execute()
    mime = meta.get("mimeType", "")
    content = ""
    raw_file_bytes: bytes | None = None
    file_extension = ""

    export_map = {
        "application/vnd.google-apps.document":     "text/plain",
        "application/vnd.google-apps.spreadsheet":  "text/csv",
        "application/vnd.google-apps.presentation": "text/plain",
    }
    if mime in export_map:
        raw = svc.files().export(fileId=file_id, mimeType=export_map[mime]).execute()
        content = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
    elif mime.startswith("text/") or mime in ("application/json",):
        raw = svc.files().get_media(fileId=file_id).execute()
        content = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
    elif mime == "application/pdf":
        # Return the raw PDF bytes (for the import path to extract via PyMuPDF,
        # identical to uploads) and also extract text here with PyMuPDF for the
        # agent reader and update-sync. pypdf (used previously) silently returned
        # empty text on many PDFs, so Drive imports failed where the identical
        # uploaded file worked.
        raw_bytes = svc.files().get_media(fileId=file_id).execute()
        if isinstance(raw_bytes, bytes):
            raw_file_bytes = raw_bytes
            file_extension = ".pdf"
            try:
                import fitz  # PyMuPDF
                with fitz.open(stream=raw_bytes, filetype="pdf") as pdf:
                    content = "\n\n".join(
                        t for t in (page.get_text() for page in pdf) if t.strip()
                    )
            except Exception:
                content = ""
    elif mime in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    ):
        # Uploaded Word docs are NOT Google-native, so files().export() returns
        # 403 fileNotExportable. Return the raw bytes for the import path to parse
        # with python-docx (identical to the upload path) and also extract text
        # here for the agent reader and update-sync.
        raw_bytes = svc.files().get_media(fileId=file_id).execute()
        if isinstance(raw_bytes, bytes):
            raw_file_bytes = raw_bytes
            file_extension = ".docx"
            try:
                import io
                import docx
                document = docx.Document(io.BytesIO(raw_bytes))
                parts = [p.text for p in document.paragraphs if p.text.strip()]
                # Include table cell text, common in cover letters/forms.
                for table in document.tables:
                    for row in table.rows:
                        for cell in row.cells:
                            if cell.text.strip():
                                parts.append(cell.text)
                content = "\n".join(parts)
            except Exception:
                content = ""

    return {
        "id": file_id,
        "name": meta.get("name", ""),
        "type": mime,
        "url": meta.get("webViewLink", ""),
        "modified": meta.get("modifiedTime", ""),
        "content": content[:10_000],
        "raw_bytes": raw_file_bytes,
        "extension": file_extension,
    }


def drive_download_bytes(file_id: str) -> dict:
    """Download a Drive file's raw bytes for storage in the regulatory file store.

    Google-native files (Docs/Sheets/Slides) are exported to their Office
    equivalents (.docx/.xlsx/.pptx); everything else is downloaded as-is via
    get_media. Returns ``{name, mime_type, extension, content (bytes),
    modified, url}``. The returned ``name`` already carries the right extension.
    """
    svc = _build("drive", "v3")
    meta = svc.files().get(
        fileId=file_id,
        fields="id,name,mimeType,webViewLink,modifiedTime",
        supportsAllDrives=True,
    ).execute()
    mime = meta.get("mimeType", "")
    name = meta.get("name", "file")

    # Google-native → export to an Office format
    google_export = {
        "application/vnd.google-apps.document": (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".docx",
        ),
        "application/vnd.google-apps.spreadsheet": (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".xlsx",
        ),
        "application/vnd.google-apps.presentation": (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".pptx",
        ),
    }

    if mime in google_export:
        out_mime, ext = google_export[mime]
        raw = svc.files().export(fileId=file_id, mimeType=out_mime).execute()
        if not name.lower().endswith(ext):
            name = f"{name}{ext}"
        content = raw if isinstance(raw, bytes) else str(raw).encode("utf-8")
        result_mime = out_mime
    else:
        raw = svc.files().get_media(fileId=file_id).execute()
        content = raw if isinstance(raw, bytes) else str(raw).encode("utf-8")
        result_mime = mime
        ext = ""
        if "." in name:
            ext = name[name.rfind("."):]

    return {
        "name": name,
        "mime_type": result_mime,
        "extension": ext.lower(),
        "content": content,
        "modified": meta.get("modifiedTime", ""),
        "url": meta.get("webViewLink", ""),
    }


def drive_get_metadata(file_id: str) -> dict | None:
    """Fetch lightweight Drive file metadata for update detection.

    Returns ``{id, name, mimeType, modifiedTime, trashed, url}`` or ``None`` if
    the file no longer exists (404) / is otherwise inaccessible.  This is a
    cheap metadata-only call (no content download) suitable for polling.
    """
    from googleapiclient.errors import HttpError

    svc = _build("drive", "v3")
    try:
        meta = svc.files().get(
            fileId=file_id,
            fields="id,name,mimeType,modifiedTime,trashed,webViewLink",
            supportsAllDrives=True,
        ).execute()
    except HttpError as exc:
        if getattr(exc, "resp", None) is not None and exc.resp.status in (404, 403):
            return None
        raise
    return {
        "id": meta.get("id", file_id),
        "name": meta.get("name", ""),
        "mimeType": meta.get("mimeType", ""),
        "modified": meta.get("modifiedTime", ""),
        "trashed": bool(meta.get("trashed", False)),
        "url": meta.get("webViewLink", ""),
    }


# ── Calendar ──────────────────────────────────────────────────────────────

def calendar_events(days_behind: int = 0, days_ahead: int = 7) -> list[dict]:
    svc = _build("calendar", "v3")
    now = datetime.now(timezone.utc)
    resp = svc.events().list(
        calendarId="primary",
        timeMin=(now - timedelta(days=days_behind)).isoformat(),
        timeMax=(now + timedelta(days=days_ahead)).isoformat(),
        maxResults=500, singleEvents=True, orderBy="startTime",
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
