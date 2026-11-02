"""
Little Gerry — installer signature verification for the self-updater.

Installed copies download the newest release installer and run it with
administrator rights. Before anything runs, the file must prove it was signed
by us: on Windows an Authenticode signature whose signer certificate matches a
thumbprint pinned in brand/brand.json (``windows.cert_thumbprints``); on macOS a
Developer ID Installer signature whose Apple Team ID is pinned
(``macos.team_ids``). Without pins the check falls back to the certificate's
name (``windows.cert_cn`` / any Apple-issued Developer ID), which still rules
out an unsigned or self-made file but not a different legitimate developer.

Standard library only: launcher.py runs on whatever Python the installer found,
and backend/routers/update.py loads this file by path from the project root.
Both the launcher and the apply scripts call it, so a release that reaches the
installer has been checked twice.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Verdict:
    ok: bool
    reason: str
    signer: str = ""
    pinned: bool = True

    def describe(self) -> str:
        if not self.ok:
            return self.reason
        return f"{self.reason} ({self.signer}{'' if self.pinned else ', not pinned'})"


def expected_from_brand(brand: dict) -> tuple[list[str], list[str], str]:
    """(windows thumbprints, apple team ids, windows certificate CN) from brand.json."""
    win = brand.get("windows") or {}
    mac = brand.get("macos") or {}
    thumbs = [
        re.sub(r"[^0-9A-F]", "", str(t).upper())
        for t in (win.get("cert_thumbprints") or [])
        if isinstance(t, str) and t.strip()
    ]
    teams = [t.strip().upper() for t in (mac.get("team_ids") or []) if isinstance(t, str) and t.strip()]
    cn = str(win.get("cert_cn") or brand.get("publisher") or "").strip()
    return [t for t in thumbs if t], teams, cn


# ── Windows ───────────────────────────────────────────────────────────────────

_PS_SIGNATURE = (
    "$s = Get-AuthenticodeSignature -LiteralPath '{path}'; "
    "@{{ status = [string]$s.Status; message = [string]$s.StatusMessage; "
    "thumbprint = [string]$s.SignerCertificate.Thumbprint; "
    "subject = [string]$s.SignerCertificate.Subject }} | ConvertTo-Json -Compress"
)

# Get-AuthenticodeSignature reports UnknownError with this message on a PC that
# has not imported our self-signed root. The signature itself has still been
# checked against the file (a tampered file reports HashMismatch), so a pinned
# thumbprint is enough there.
_UNTRUSTED_ROOT = "not trusted"


def read_authenticode(path: Path) -> dict:
    ps_path = str(Path(path).resolve()).replace("'", "''")
    cmd = [
        "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-Command", _PS_SIGNATURE.format(path=ps_path),
    ]
    # Windows PowerShell can't load Microsoft.PowerShell.Security when it
    # inherits PowerShell 7's PSModulePath (e.g. launched from a pwsh shell);
    # let it rebuild the default.
    env = {k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"}
    kwargs: dict = {"env": env}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, **kwargs)
    if out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError(f"Get-AuthenticodeSignature failed: {out.stderr.strip()[:300]}")
    sig = json.loads(out.stdout.strip().splitlines()[-1])
    if not sig.get("status") and out.stderr.strip():
        raise RuntimeError(f"Get-AuthenticodeSignature failed: {out.stderr.strip()[:300]}")
    return sig


def evaluate_windows(sig: dict, thumbprints: list[str], cert_cn: str) -> Verdict:
    status = str(sig.get("status") or "")
    message = str(sig.get("message") or "")
    thumb = re.sub(r"[^0-9A-F]", "", str(sig.get("thumbprint") or "").upper())
    subject = str(sig.get("subject") or "")

    trusted = status == "Valid"
    untrusted_root = status == "UnknownError" and _UNTRUSTED_ROOT in message.lower()
    if not (trusted or untrusted_root):
        return Verdict(False, f"Authenticode status {status or 'unknown'}: {message or 'no signature'}")
    if not thumb:
        return Verdict(False, "signed, but no signer certificate was reported")

    if thumbprints:
        if thumb in thumbprints:
            return Verdict(True, "signer thumbprint matches brand.json", thumb)
        return Verdict(
            False,
            f"signer thumbprint {thumb} is not one of the pinned certificates "
            f"({', '.join(thumbprints)})",
            thumb,
        )

    if not trusted:
        return Verdict(False, "no pinned thumbprint in brand.json and the signer's root is not trusted on this PC", thumb)
    if cert_cn and not re.search(rf"(^|,\s*)CN={re.escape(cert_cn)}(,|$)", subject):
        return Verdict(False, f"signer is '{subject}', expected CN={cert_cn}", thumb)
    return Verdict(True, "trusted signature; name matches brand.json", thumb, pinned=False)


# ── macOS ─────────────────────────────────────────────────────────────────────

_APPLE_DEV_STATUS = "signed by a developer certificate issued by apple"
_INSTALLER_IDENTITY = re.compile(r"Developer ID Installer:\s*.+?\(([A-Z0-9]{10})\)")


def read_pkgutil(path: Path) -> str:
    out = subprocess.run(
        ["/usr/sbin/pkgutil", "--check-signature", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    # pkgutil exits 1 for "no signature" but still prints a Status line.
    return (out.stdout or "") + (out.stderr or "")


def evaluate_macos(output: str, team_ids: list[str]) -> Verdict:
    m = re.search(r"Status:\s*(.+)", output)
    status = (m.group(1).strip() if m else "").lower()
    if not status.startswith(_APPLE_DEV_STATUS):
        return Verdict(False, f"pkgutil status: {status or 'no signature'}")
    ident = _INSTALLER_IDENTITY.search(output)
    if not ident:
        return Verdict(False, "signed, but not with a Developer ID Installer certificate")
    team = ident.group(1)
    if team_ids:
        if team in team_ids:
            return Verdict(True, "Developer ID team matches brand.json", team)
        return Verdict(False, f"Developer ID team {team} is not one of the pinned teams ({', '.join(team_ids)})", team)
    return Verdict(True, "Apple-issued Developer ID Installer signature", team, pinned=False)


# ── Entry point ───────────────────────────────────────────────────────────────

def verify_installer(path: Path, brand: dict) -> Verdict:
    """Check a downloaded installer. Never raises; a failure to run the platform
    tool is a refusal, because the file would otherwise run as administrator."""
    thumbs, teams, cn = expected_from_brand(brand)
    try:
        if not Path(path).is_file():
            return Verdict(False, f"{path} does not exist")
        if sys.platform == "win32":
            return evaluate_windows(read_authenticode(Path(path)), thumbs, cn)
        if sys.platform == "darwin":
            return evaluate_macos(read_pkgutil(Path(path)), teams)
        return Verdict(False, f"installer verification is not supported on {sys.platform}")
    except Exception as exc:  # noqa: BLE001 — any failure must refuse the install
        return Verdict(False, f"could not verify the installer: {exc}")
