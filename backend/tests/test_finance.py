"""Money, read-only: who may see it, what a sync brings from the bank, what Gerry is shown."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import ssl
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from main import app
from models.db.finance import BankAccount, BankTransaction
from models.db.user import User
from routers.finance import router as finance_router
from services import finance as svc
from services.agent.finance_tools import execute_read_bank
from services.auth.service import hash_password
from services.bank import usbank

# PMI's brand keeps this off until the bank grants production access; the routes are tested regardless.
if not any(getattr(r, "path", "") == "/finance/access" for r in app.routes):
    app.include_router(finance_router)


@dataclass
class _Ctx:
    db: AsyncSession
    user_id: uuid.UUID


def _tx(day: str, way: str, amount: str, description: str, ref: str, **detail) -> dict:
    return {"transactionDate": day, "debitCreditIndicator": way, "amount": amount, "currency": "USD",
            "transactionType": "ACH", "transactionDescription": description, "bankReferenceNumber": ref, **detail}


class _Bank:
    """U.S. Bank's sandbox, as it answered on 2026-11-20, cut down to two accounts."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.refuses = ""
        self.transactions = {
            "acct-ops": [
                _tx("2026-11-10", "debit", "1250.5", "ACH Debit(s)", "111", achTransactionDetails={"companyName": "ACME SUPPLY"}),
                # Two identical lines on one day are two payments, not one.
                _tx("2026-11-12", "debit", "40", "Wire fee", ""),
                _tx("2026-11-12", "debit", "40", "Wire fee", ""),
                _tx("2026-11-14", "credit", "9000", "Incoming wire", "222",
                    wiresTransactionDetails={"originator": "RIVERSIDE EMS", "beneficiary": "US"}),
            ],
            "acct-payroll": [],
        }

    async def __call__(self, method: str, url: str, **kw) -> httpx.Response:
        self.calls.append((method, url, kw))
        if url.endswith("/oauth2/client-credentials/v2/token"):
            assert kw["auth"] == ("key", "secret") and kw["data"] == {"grant_type": "client_credentials"}
            return httpx.Response(200, json={"tokenType": "BearerToken", "expiresIn": "899", "accessToken": "tok"})
        assert kw["headers"]["Authorization"] == "Bearer tok" and kw["headers"]["Correlation-ID"]
        # What the sandbox enforces: a page size only ever with a page number.
        assert kw["params"]["pageNumber"] == "1" and kw["params"]["pageSize"]
        meta = {"pageNumber": 1, "pageCount": 1}
        if url.endswith("/accounts"):
            return httpx.Response(200, json={"pageMeta": meta, "accounts": [
                {"accountID": "acct-ops", "accountName": "Operating", "accountNumber": "103676561400",
                 "bankName": "U.S. Bank", "accountType": "DDA", "currency": "USD"},
                {"accountID": "acct-payroll", "accountName": "Payroll", "accountNumber": "103676569988",
                 "bankName": "U.S. Bank", "accountType": "DDA", "currency": "USD"},
            ]})
        if url.endswith("/accounts/previous-day"):
            assert kw["json"] == {"accountsInquiry": {"accountID": ["acct-ops", "acct-payroll"]}}
            return httpx.Response(200, json={"pageMeta": meta, "accountsSummaryPreviousDay": [
                {"accountID": "acct-ops", "ledgerBalance": "52010.25", "accessibleBalance": "50000", "balanceAsOfDate": "2026-11-19"},
                {"accountID": "acct-payroll", "ledgerBalance": "8000", "accessibleBalance": "8000", "balanceAsOfDate": "2026-11-19"},
            ]})
        account = url.split("/accounts/")[1].split("/")[0]
        assert len(kw["params"]["startDate"]) == 10 and len(kw["params"]["endDate"]) == 10
        if account == self.refuses:
            return httpx.Response(400, json={"errors": [{"message": "Resource Not Found", "details": []}]})
        return httpx.Response(200, json={"pageMeta": meta, "transactions": self.transactions[account]})


@pytest.fixture
def bank(monkeypatch) -> _Bank:
    fake = _Bank()
    monkeypatch.setattr(usbank, "_send", fake)
    monkeypatch.setattr(usbank, "credentials", lambda: ("key", "secret"))
    monkeypatch.setattr(usbank, "_tokens", {})
    monkeypatch.setattr(settings, "usbank_environment", "sandbox")
    return fake


async def _person(db: AsyncSession, client, email: str, role: str = "user") -> tuple[User, dict[str, str]]:
    user = User(email=email, display_name=email.split("@")[0].title(),
                hashed_password=hash_password("TestPassword1!"), role=role, is_active=True)
    db.add(user)
    await db.flush()
    resp = await client.post("/auth/login", json={"email": email, "password": "TestPassword1!"})
    return user, {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_a_sync_copies_accounts_balances_and_transactions_once(db_session: AsyncSession, bank: _Bank):
    first = await svc.sync_bank(db_session)
    assert first == {"environment": "sandbox", "accounts": 2, "new_transactions": 4, "skipped": []}

    ops = (await db_session.execute(select(BankAccount).where(BankAccount.external_id == "acct-ops"))).scalar_one()
    # Only the last four digits of the account number are kept.
    assert (ops.name, ops.last4, float(ops.available_balance), float(ops.ledger_balance)) == ("Operating", "1400", 50000.0, 52010.25)
    assert ops.balance_as_of.isoformat() == "2026-11-19" and "103676561400" not in str(ops.__dict__)

    rows = await svc.list_transactions(db_session)
    assert [(r["posted_on"], r["amount"], r["counterparty"]) for r in rows] == [
        ("2026-11-14", 9000.0, "RIVERSIDE EMS"), ("2026-11-12", -40.0, ""), ("2026-11-12", -40.0, ""),
        ("2026-11-10", -1250.5, "ACME SUPPLY"),
    ]

    bank.transactions["acct-ops"].append(_tx("2026-11-18", "debit", "300", "Card payment", "333"))
    again = await svc.sync_bank(db_session)
    assert again["new_transactions"] == 1
    assert (await db_session.execute(select(func.count()).select_from(BankTransaction))).scalar_one() == 5
    # One sign-in served every call: the token was reused, not requested per request.
    assert sum(1 for _, url, _ in bank.calls if url.endswith("/token")) == 1

    # The bank refusing one account (it does, for accounts with nothing to report) does not lose the others.
    bank.refuses = "acct-payroll"
    bank.transactions["acct-ops"].append(_tx("2026-11-19", "credit", "75", "Refund", "444"))
    third = await svc.sync_bank(db_session)
    assert third["new_transactions"] == 1
    assert third["skipped"] == [
        {"account": "Payroll …9988", "reason": "U.S. Bank refused the request (400): Resource Not Found"}
    ]


@pytest.mark.asyncio
async def test_only_the_finance_list_sees_money_and_only_the_list_changes_itself(client, db_session: AsyncSession, bank: _Bank):
    admin, admin_h = await _person(db_session, client, "admin@pmi.local", "admin")
    _, viewer_h = await _person(db_session, client, "morgan@pmi.local")
    _, other_h = await _person(db_session, client, "sam@pmi.local")
    await svc.sync_bank(db_session)

    # Nobody is on the list yet: nobody sees anything, and only an administrator can start the list.
    assert (await client.get("/finance/bank/accounts", headers=admin_h)).status_code == 403
    assert (await client.put("/finance/viewers", headers=other_h, json={"emails": ["sam@pmi.local"]})).status_code == 403
    unknown = await client.put("/finance/viewers", headers=admin_h, json={"emails": ["nobody@pmi.local"]})
    assert unknown.status_code == 400 and "nobody@pmi.local" in unknown.json()["detail"]
    started = await client.put("/finance/viewers", headers=admin_h, json={"emails": [" Morgan@PMI.local "]})
    assert started.json() == {"can_view": False, "can_manage": False, "viewers": []}

    # The administrator left themselves off: they can no longer see it or put themselves on.
    assert (await client.get("/finance/bank/transactions", headers=admin_h)).status_code == 403
    assert (await client.put("/finance/viewers", headers=admin_h, json={"emails": ["admin@pmi.local"]})).status_code == 403
    assert (await client.post("/finance/bank/sync", headers=other_h)).status_code == 403
    assert (await client.get("/finance/overview", headers=other_h)).status_code == 403

    accounts = await client.get("/finance/bank/accounts", headers=viewer_h)
    assert accounts.status_code == 200 and [a["name"] for a in accounts.json()] == ["Operating", "Payroll"]
    found = await client.get("/finance/bank/transactions", headers=viewer_h, params={"q": "acme"})
    assert [t["amount"] for t in found.json()] == [-1250.5]
    mine = (await client.get("/finance/access", headers=viewer_h)).json()
    assert mine["can_view"] and mine["can_manage"] and mine["viewers"] == ["morgan@pmi.local"]
    assert mine["environment"] == "sandbox" and mine["last_synced"]
    assert (await client.get("/finance/access", headers=other_h)).json()["viewers"] == []


@pytest.mark.asyncio
async def test_gerry_reports_test_data_as_test_data_and_tells_others_nothing(db_session: AsyncSession, bank: _Bank, monkeypatch):
    monkeypatch.setattr(settings, "hub_mode", True)
    viewer = User(email="morgan@pmi.local", display_name="Morgan", hashed_password="x", role="admin", is_active=True)
    other = User(email="sam@pmi.local", display_name="Sam", hashed_password="x", role="admin", is_active=True)
    db_session.add_all([viewer, other])
    await db_session.flush()
    await svc.set_viewers(db_session, viewer, ["morgan@pmi.local"])

    out = await execute_read_bank(_Ctx(db_session, viewer.id), {})  # nothing read yet: it reads the bank first
    assert out.startswith("NOTE: this is U.S. Bank SANDBOX TEST DATA, not the company's real accounts.")
    assert "- Operating …1400 (DDA): available 50,000.00 USD, ledger 52,010.25 USD, as of 2026-11-19" in out
    assert "Total available: 58,000.00 USD." in out
    assert "- 2026-11-14 | +9,000.00 USD | ACH | Incoming wire | RIVERSIDE EMS | Operating …1400" in out

    searched = await execute_read_bank(_Ctx(db_session, viewer.id), {"search": "acme"})
    assert 'Transactions matching "acme": 1.' in searched and "-1,250.50 USD" in searched

    refused = await execute_read_bank(_Ctx(db_session, other.id), {})
    assert refused == f"Error: {svc.NOT_ALLOWED}" and "Operating" not in refused


@pytest.mark.asyncio
async def test_the_bank_saying_no_is_reported_in_its_own_words(monkeypatch):
    async def refuse(method, url, **kw):
        if url.endswith("/token"):
            return httpx.Response(200, json={"expiresIn": "899", "accessToken": "tok"})
        return httpx.Response(400, json={"errors": [{"message": "Invalid request.", "details": [
            {"AttributeName": "startDate", "reason": "Field values incorrectly formatted."}]}]})

    monkeypatch.setattr(usbank, "_send", refuse)
    monkeypatch.setattr(usbank, "credentials", lambda: ("key", "secret"))
    monkeypatch.setattr(usbank, "_tokens", {})
    monkeypatch.setattr(settings, "usbank_environment", "sandbox")
    with pytest.raises(usbank.BankError, match=r"\(400\): Invalid request\. \[startDate: Field values incorrectly formatted\.\]"):
        await usbank.accounts()

    # The live environments need the company's certificate; without one this says so instead of trying.
    monkeypatch.setattr(settings, "usbank_environment", "production")
    with pytest.raises(usbank.BankUnavailable, match="certificate and private key"):
        await usbank.accounts()


def _certificate(name: str, issuer=None, *, ca: bool = False, usage=None, ip: str | None = None):
    """A certificate and its key, signed by ``issuer`` (itself, when there is none)."""
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    signer_cert, signer_key = issuer or (None, key)
    now = datetime.now(timezone.utc)
    builder = (
        x509.CertificateBuilder().subject_name(subject).issuer_name(signer_cert.subject if signer_cert else subject)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, key_cert_sign=ca, crl_sign=ca, content_commitment=False,
                                     key_encipherment=False, data_encipherment=False, key_agreement=False,
                                     encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(signer_key.public_key()), critical=False)
    )
    if usage:
        builder = builder.add_extension(x509.ExtendedKeyUsage([usage]), critical=False)
    if ip:
        builder = builder.add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(ip))]), critical=False)
    return builder.sign(signer_key, hashes.SHA256()), key


def _pem(path, *certs, key=None, passphrase: bytes | None = None) -> str:
    data = b"".join(c.public_bytes(serialization.Encoding.PEM) for c in certs)
    if key is not None:
        lock = serialization.BestAvailableEncryption(passphrase) if passphrase else serialization.NoEncryption()
        data += key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, lock)
    path.write_bytes(data)
    return str(path)


@pytest.mark.asyncio
async def test_outside_the_sandbox_every_connection_presents_the_companys_certificate(tmp_path, monkeypatch):
    """A real handshake with a server that, like the bank's, turns away anyone without a certificate it trusts."""
    authority = _certificate("Test authority", ca=True)
    stranger_authority = _certificate("Some other authority", ca=True)
    server_cert, server_key = _certificate("bank", authority, usage=ExtendedKeyUsageOID.SERVER_AUTH, ip="127.0.0.1")
    client_cert, client_key = _certificate("PMI test client", authority, usage=ExtendedKeyUsageOID.CLIENT_AUTH)
    stranger_cert, stranger_key = _certificate("Stranger", stranger_authority, usage=ExtendedKeyUsageOID.CLIENT_AUTH)
    ca_file = _pem(tmp_path / "authority.pem", authority[0])
    chain = _pem(tmp_path / "chain.pem", client_cert, authority[0])
    key_file = _pem(tmp_path / "key.pem", key=client_key)
    locked_key = _pem(tmp_path / "locked.pem", key=client_key, passphrase=b"open sesame")

    seen: list[tuple[str, str, str, bytes, str]] = []

    async def bank(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = (await reader.readuntil(b"\r\n\r\n")).decode()
            method, target, _ = head.split("\r\n")[0].split(" ")
            size = re.search(r"content-length: (\d+)", head, re.I)
            body = await reader.readexactly(int(size.group(1))) if size else b""
            who = dict(pair[0] for pair in writer.get_extra_info("peercert")["subject"])["commonName"]
            seen.append((method, target.split("?")[0], head, body, who))
            answer = (
                {"tokenType": "BearerToken", "expiresIn": "899", "accessToken": "tok"} if target.endswith("/token")
                else {"pageMeta": {"pageNumber": 1, "pageCount": 1}, "accounts": [{"accountID": "a1", "accountName": "Operating"}]}
            )
            data = json.dumps(answer).encode()
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n"
                         + f"Content-Length: {len(data)}\r\n\r\n".encode() + data)
            await writer.drain()
        except (ssl.SSLError, asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            writer.close()

    demand = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    demand.load_cert_chain(_pem(tmp_path / "server.pem", server_cert, key=server_key))
    demand.load_verify_locations(cafile=ca_file)
    demand.verify_mode = ssl.CERT_REQUIRED
    server = await asyncio.start_server(bank, "127.0.0.1", 0, ssl=demand)
    port = server.sockets[0].getsockname()[1]

    def use(cert: str, key: str) -> None:
        monkeypatch.setattr(settings, "usbank_client_cert_file", cert)
        monkeypatch.setattr(settings, "usbank_client_key_file", key)
        monkeypatch.setattr(usbank, "_tokens", {})
        usbank._identity.cache_clear()

    monkeypatch.setattr(settings, "usbank_environment", "certification")
    monkeypatch.setattr(settings, "usbank_ca_file", ca_file)
    monkeypatch.setattr(settings, "usbank_token_url", "")
    monkeypatch.setattr(usbank, "_HOSTS", {**usbank._HOSTS, "certification": f"https://127.0.0.1:{port}"})
    monkeypatch.setattr(usbank, "credentials", lambda: ("key", "secret"))
    monkeypatch.setattr(usbank, "_keyring_get", lambda name: None)
    monkeypatch.delenv("USBANK_CLIENT_KEY_PASSWORD", raising=False)
    try:
        use(chain, key_file)
        assert [a["accountName"] for a in await usbank.accounts()] == ["Operating"]
        (method, path, head, body, who), (_, data_path, data_head, _, _) = seen
        # The sign-in is the sandbox's request at the bank's general address, on a connection the server tied to the certificate.
        assert (method, path, body, who) == ("POST", "/auth/oauth2/v1/token", b"grant_type=client_credentials", "PMI test client")
        assert "authorization: basic a2v5onnly3jlda==" in head.lower()  # key:secret
        assert data_path == "/commercial-banking/account-management/v2/accounts" and "authorization: bearer tok" in data_head.lower()

        # A certificate from an authority the bank does not trust gets nowhere.
        use(_pem(tmp_path / "stranger.pem", stranger_cert, stranger_authority[0]), _pem(tmp_path / "stranger-key.pem", key=stranger_key))
        with pytest.raises(usbank.BankUnavailable, match="Could not reach U.S. Bank"):
            await usbank.accounts()

        # A key locked with a passphrase nobody supplied is reported, not waited on at a terminal.
        use(chain, locked_key)
        with pytest.raises(usbank.BankUnavailable, match="could not be loaded"):
            await usbank.accounts()
        monkeypatch.setenv("USBANK_CLIENT_KEY_PASSWORD", "open sesame")
        use(chain, locked_key)
        assert len(await usbank.accounts()) == 1

        # No certificate set: said plainly, and the bank is not contacted at all.
        use("", "")
        before = len(seen)
        with pytest.raises(usbank.BankUnavailable, match="certificate and private key"):
            await usbank.accounts()
        assert len(seen) == before == 4
    finally:
        server.close()
        await server.wait_closed()
        usbank._identity.cache_clear()
