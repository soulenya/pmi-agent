"""update_verify.py — the signature gate on downloaded installers.

The module lives at the project root (shared with launcher.py); loaded by path
the same way routers/update.py does. Platform tools are not run here: the pure
evaluators are exercised with captured outputs.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("update_verify", _ROOT / "update_verify.py")
uv = importlib.util.module_from_spec(_spec)
sys.modules.setdefault("update_verify", uv)
_spec.loader.exec_module(uv)

PMI_THUMB = "5C5867DBC82E529223641F7D857BA61F68B654C1"
PMI_SUBJECT = "CN=Precisian Medical Instruments, O=Precisian Medical Instruments, OU=Little Gerry"
BRAND = {
    "publisher": "Precisian Medical Instruments",
    "windows": {"cert_cn": "Precisian Medical Instruments", "cert_thumbprints": [PMI_THUMB.lower()]},
    "macos": {"team_ids": ["u562ksfm7b"]},
}


def _sig(status="Valid", message="", thumbprint=PMI_THUMB, subject=PMI_SUBJECT):
    return {"status": status, "message": message, "thumbprint": thumbprint, "subject": subject}


def test_expected_from_brand_normalises_case_and_spacing():
    thumbs, teams, cn = uv.expected_from_brand(
        {"windows": {"cert_cn": "X", "cert_thumbprints": ["5c 58 67", "", None]}, "macos": {"team_ids": [" abc "]}}
    )
    assert thumbs == ["5C5867"]
    assert teams == ["ABC"]
    assert cn == "X"


def test_expected_from_brand_without_pins():
    thumbs, teams, cn = uv.expected_from_brand({"publisher": "Acme"})
    assert thumbs == [] and teams == [] and cn == "Acme"


# ── Windows ───────────────────────────────────────────────────────────────────

def test_windows_valid_and_pinned():
    thumbs, _, cn = uv.expected_from_brand(BRAND)
    v = uv.evaluate_windows(_sig(), thumbs, cn)
    assert v.ok and v.pinned and v.signer == PMI_THUMB


def test_windows_pinned_accepts_untrusted_root_on_pc_without_trust_bat():
    thumbs, _, cn = uv.expected_from_brand(BRAND)
    msg = "A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider."
    v = uv.evaluate_windows(_sig(status="UnknownError", message=msg), thumbs, cn)
    assert v.ok


def test_windows_pinned_rejects_other_signer_even_if_chain_trusted():
    thumbs, _, cn = uv.expected_from_brand(BRAND)
    v = uv.evaluate_windows(_sig(thumbprint="AA" * 20, subject="CN=Someone Else"), thumbs, cn)
    assert not v.ok and "not one of the pinned" in v.reason


def test_windows_rejects_unsigned_hash_mismatch_and_not_signed():
    thumbs, _, cn = uv.expected_from_brand(BRAND)
    for status in ("NotSigned", "HashMismatch", "NotTrusted", "Incompatible", ""):
        v = uv.evaluate_windows(_sig(status=status, thumbprint="", subject=""), thumbs, cn)
        assert not v.ok, status


def test_windows_unknown_error_without_untrusted_root_message_is_refused():
    thumbs, _, cn = uv.expected_from_brand(BRAND)
    v = uv.evaluate_windows(_sig(status="UnknownError", message="The timestamp signature is invalid."), thumbs, cn)
    assert not v.ok


def test_windows_no_pins_falls_back_to_trusted_chain_and_cn():
    brand = {"windows": {"cert_cn": "Precisian Medical Instruments"}}
    thumbs, _, cn = uv.expected_from_brand(brand)
    ok = uv.evaluate_windows(_sig(), thumbs, cn)
    assert ok.ok and not ok.pinned
    wrong_cn = uv.evaluate_windows(_sig(subject="CN=Precisian Medical Instruments Ltd, O=X"), thumbs, cn)
    assert not wrong_cn.ok
    untrusted = uv.evaluate_windows(_sig(status="UnknownError", message="... not trusted ..."), thumbs, cn)
    assert not untrusted.ok


# ── macOS ─────────────────────────────────────────────────────────────────────

PKGUTIL_OK = """Package "LittleGerry.pkg":
   Status: signed by a developer certificate issued by Apple for distribution
   Notarization: trusted by the Apple notary service
   Signed with a trusted timestamp on: 2026-11-02 01:40:11 +0000
   Certificate Chain:
    1. Developer ID Installer: Morgan Keane (U562KSFM7B)
       Expires: 2027-02-01 20:08:56 +0000
       SHA256 Fingerprint:
           AA BB
    2. Developer ID Certification Authority
    3. Apple Root CA
"""


def test_macos_pinned_team_ok():
    _, teams, _ = uv.expected_from_brand(BRAND)
    v = uv.evaluate_macos(PKGUTIL_OK, teams)
    assert v.ok and v.pinned and v.signer == "U562KSFM7B"


def test_macos_other_team_refused():
    v = uv.evaluate_macos(PKGUTIL_OK.replace("U562KSFM7B", "ZZZZZZZZZZ"), ["U562KSFM7B"])
    assert not v.ok and "not one of the pinned" in v.reason


def test_macos_unsigned_or_untrusted_refused():
    for status in ("no signature", "signed by untrusted certificate", "signed Apple Development"):
        out = PKGUTIL_OK.replace("signed by a developer certificate issued by Apple for distribution", status)
        assert not uv.evaluate_macos(out, ["U562KSFM7B"]).ok, status
    assert not uv.evaluate_macos("", ["U562KSFM7B"]).ok


def test_macos_application_identity_is_not_an_installer_identity():
    out = PKGUTIL_OK.replace("Developer ID Installer", "Developer ID Application")
    assert not uv.evaluate_macos(out, ["U562KSFM7B"]).ok


def test_macos_no_pins_accepts_any_apple_developer_id():
    v = uv.evaluate_macos(PKGUTIL_OK, [])
    assert v.ok and not v.pinned


# ── Entry point ───────────────────────────────────────────────────────────────

def test_verify_installer_missing_file_is_refused(tmp_path):
    v = uv.verify_installer(tmp_path / "nope.exe", BRAND)
    assert not v.ok


def test_verify_installer_tool_failure_is_refused(tmp_path, monkeypatch):
    f = tmp_path / "x.exe"
    f.write_bytes(b"MZ")
    monkeypatch.setattr(uv.sys, "platform", "win32")
    monkeypatch.setattr(uv, "read_authenticode", lambda p: (_ for _ in ()).throw(RuntimeError("powershell missing")))
    v = uv.verify_installer(f, BRAND)
    assert not v.ok and "could not verify" in v.reason


def test_verify_installer_unknown_platform_refused(tmp_path, monkeypatch):
    f = tmp_path / "x.bin"
    f.write_bytes(b"x")
    monkeypatch.setattr(uv.sys, "platform", "linux")
    assert not uv.verify_installer(f, BRAND).ok
