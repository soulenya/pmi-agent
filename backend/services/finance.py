"""Money, read-only: who may see it, what the bank says, and what Gerry is shown.

Financial data is not for everyone on the hub. It is shown only to people on
the finance list, and the list is changed only by someone already on it (an
administrator sets it the first time, while it is empty). The same rule
guards the page, the routes and Gerry's tool.

The bank is the only source so far (``services/bank/usbank``). A sync copies
accounts, their last balances and their posted transactions into this
install's tables; nothing is ever sent to the bank but questions.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.finance import BankAccount, BankTransaction
from models.db.settings import SystemSetting
from models.db.user import User
from services import secret_store
from services.bank import usbank

VIEWERS_KEY = "finance.viewers"
# How far back the first sync reads, and how far each later one re-reads.
HISTORY_DAYS = 90
OVERLAP_DAYS = 7
STALE_AFTER = timedelta(hours=24)

NOT_ALLOWED = (
    "Financial data is limited to the people on the finance list. Someone already on it can add you."
)


class FinanceError(Exception):
    """Something the person asking can act on."""


class NotAllowed(FinanceError):
    """This person is not on the finance list."""


class FinanceUnavailable(FinanceError):
    """The financial data cannot be reached from here right now."""


# ── Who may see it ────────────────────────────────────────────────────────────


async def viewers(db: AsyncSession) -> list[str]:
    row = await db.get(SystemSetting, VIEWERS_KEY)
    value = row.value if row else []
    return sorted({str(e).strip().lower() for e in value if str(e).strip()}) if isinstance(value, list) else []


async def access(db: AsyncSession, user: User) -> dict[str, Any]:
    allowed = await viewers(db)
    on_list = (user.email or "").lower() in allowed
    can_manage = on_list or (not allowed and user.role == "admin")
    return {"can_view": on_list, "can_manage": can_manage, "viewers": allowed if can_manage else []}


async def require_view(db: AsyncSession, user: User) -> None:
    if not (await access(db, user))["can_view"]:
        raise NotAllowed(NOT_ALLOWED)


async def set_viewers(db: AsyncSession, user: User, emails: list[str]) -> list[str]:
    """Replace the finance list. Every address must be an active person here. Caller commits."""
    if not (await access(db, user))["can_manage"]:
        raise NotAllowed(NOT_ALLOWED)
    wanted = sorted({e.strip().lower() for e in emails if e and e.strip()})
    known = {
        (email or "").lower()
        for (email,) in await db.execute(select(User.email).where(User.is_active.is_(True)))
    }
    unknown = [e for e in wanted if e not in known]
    if unknown:
        raise FinanceError("No active account here for: " + ", ".join(unknown) + ". They need to sign in once first.")
    row = await db.get(SystemSetting, VIEWERS_KEY)
    if row is None:
        db.add(SystemSetting(key=VIEWERS_KEY, value=wanted, updated_by=user.id,
                             description="Who may see financial data (bank, books)."))
    else:
        row.value = wanted
        row.updated_by = user.id
    await db.flush()
    return wanted


async def save_bank_keys(db: AsyncSession, user: User, api_key: str, api_secret: str) -> None:
    """Keep the bank's API key and secret on a hub, encrypted. Caller commits.

    The company's certificate and its private key, which the bank's real
    environments also require, are never kept here: they are files on the server.
    """
    await require_view(db, user)
    if not settings.hub_mode:
        raise FinanceError("The bank's keys are saved on the hub, not on a desktop.")
    if user.role != "admin":
        raise NotAllowed("Only an administrator can set the company's bank keys.")
    if usbank.keys_source() not in (None, "app"):
        raise FinanceError("This server is given its bank keys directly; keys saved here would not be used.")
    api_key, api_secret = api_key.strip(), api_secret.strip()
    if not api_key or not api_secret:
        raise FinanceError("Both the API key and the secret are needed.")
    if await usbank.keys_refused(api_key, api_secret):
        raise FinanceError("U.S. Bank does not accept that API key and secret. Check both were copied in full.")
    await secret_store.put(db, "usbank_api_key", api_key, user.id)
    await secret_store.put(db, "usbank_api_secret", api_secret, user.id)
    usbank.forget_tokens()


# ── The bank ──────────────────────────────────────────────────────────────────


def _money(raw: Any) -> Decimal | None:
    try:
        return Decimal(str(raw)).quantize(Decimal("0.01")) if raw not in (None, "") else None
    except InvalidOperation:
        return None


def _day(raw: Any) -> date | None:
    try:
        return date.fromisoformat(str(raw)[:10]) if raw else None
    except ValueError:
        return None


def _counterparty(tx: dict) -> str:
    """Who the money went to or came from, where the bank's detail names them."""
    incoming = str(tx.get("debitCreditIndicator") or "").lower() == "credit"
    for block, keys in (
        ("achTransactionDetails", ("companyName",)),
        ("rtpTransactionDetails", ("debtorName",) if incoming else ("creditorName",)),
        ("zelleTransactionDetails", ("receiverName",)),
        ("wiresTransactionDetails", ("originator", "debtor") if incoming else ("beneficiary", "creditor")),
    ):
        detail = tx.get(block) or {}
        for key in keys:
            if detail.get(key):
                return str(detail[key]).strip()[:300]
    check = (tx.get("checksTransactionDetails") or {}).get("checkNumber")
    return f"Check {check}" if check else ""


def _dedupe_keys(rows: list[dict]) -> list[str]:
    """One stable key per transaction. Identical lines on one day are told apart by their order."""
    seen: dict[tuple, int] = {}
    keys = []
    for tx in rows:
        base = (
            str(tx.get("transactionDate") or "")[:10], str(tx.get("debitCreditIndicator") or "").lower(),
            str(tx.get("amount") or ""), str(tx.get("bankReferenceNumber") or ""),
            str(tx.get("transactionReferenceNumber") or ""), str(tx.get("transactionDescription") or ""),
        )
        seen[base] = seen.get(base, 0) + 1
        keys.append(hashlib.sha256("|".join((*base, str(seen[base]))).encode()).hexdigest())
    return keys


async def _accounts(db: AsyncSession) -> list[BankAccount]:
    return list(
        (
            await db.execute(
                select(BankAccount)
                .where(BankAccount.provider == "usbank", BankAccount.environment == usbank.environment())
                .order_by(BankAccount.name, BankAccount.last4)
            )
        ).scalars()
    )


async def last_synced(db: AsyncSession) -> datetime | None:
    return (
        await db.execute(
            select(func.max(BankAccount.synced_at)).where(
                BankAccount.provider == "usbank", BankAccount.environment == usbank.environment()
            )
        )
    ).scalar()


async def sync_bank(db: AsyncSession) -> dict[str, Any]:
    """Read accounts, balances and recent transactions from the bank. Caller commits."""
    env = usbank.environment()
    now = datetime.now(timezone.utc)
    have = {a.external_id: a for a in await _accounts(db)}
    for remote in await usbank.accounts():
        row = have.get(remote["accountID"])
        if row is None:
            row = BankAccount(id=uuid.uuid4(), provider="usbank", environment=env, external_id=remote["accountID"])
            db.add(row)
            have[remote["accountID"]] = row
        row.name = str(remote.get("accountName") or "")[:300]
        row.last4 = str(remote.get("accountNumber") or "")[-4:]
        row.account_type = str(remote.get("accountType") or "")[:40]
        row.bank_name = str(remote.get("bankName") or "")[:200]
        row.currency = str(remote.get("currency") or "USD")[:8]
    await db.flush()

    for summary in await usbank.balances(list(have)):
        row = have.get(summary.get("accountID"))
        if row is None:
            continue
        row.ledger_balance = _money(summary.get("ledgerBalance"))
        row.available_balance = _money(summary.get("accessibleBalance"))
        row.balance_as_of = _day(summary.get("balanceAsOfDate"))

    added = 0
    skipped: list[dict[str, str]] = []
    today = now.date()
    for row in have.values():
        latest = (
            await db.execute(select(func.max(BankTransaction.posted_on)).where(BankTransaction.account_id == row.id))
        ).scalar()
        start = latest - timedelta(days=OVERLAP_DAYS) if latest else today - timedelta(days=HISTORY_DAYS)
        row.synced_at = now
        try:
            fetched = await usbank.transactions(row.external_id, min(start, today), today)
        except usbank.BankUnavailable:
            raise
        except usbank.BankError as exc:
            # The bank answers for some accounts and not others (no entitlement,
            # nothing to report). One refusal must not lose the rest.
            skipped.append({"account": f"{row.name} …{row.last4}", "reason": str(exc)})
            continue
        known = set(
            (await db.execute(select(BankTransaction.dedupe_key).where(BankTransaction.account_id == row.id))).scalars()
        )
        for tx, key in zip(fetched, _dedupe_keys(fetched)):
            amount, posted = _money(tx.get("amount")), _day(tx.get("transactionDate"))
            if key in known or amount is None or posted is None:
                continue
            credit = str(tx.get("debitCreditIndicator") or "").lower() == "credit"
            db.add(
                BankTransaction(
                    account_id=row.id, posted_on=posted, amount=amount if credit else -amount,
                    currency=str(tx.get("currency") or row.currency)[:8],
                    kind=str(tx.get("transactionType") or "")[:60],
                    description=str(tx.get("transactionDescription") or ""),
                    counterparty=_counterparty(tx),
                    reference=str(tx.get("bankReferenceNumber") or tx.get("transactionReferenceNumber") or "")[:100],
                    dedupe_key=key, raw=tx,
                )
            )
            known.add(key)
            added += 1
    await db.flush()
    return {"environment": env, "accounts": len(have), "new_transactions": added, "skipped": skipped}


def _account_out(a: BankAccount) -> dict:
    return {
        "id": str(a.id), "name": a.name, "last4": a.last4, "account_type": a.account_type,
        "bank_name": a.bank_name, "currency": a.currency,
        "ledger_balance": float(a.ledger_balance) if a.ledger_balance is not None else None,
        "available_balance": float(a.available_balance) if a.available_balance is not None else None,
        "balance_as_of": a.balance_as_of.isoformat() if a.balance_as_of else None,
        "synced_at": a.synced_at.isoformat() if a.synced_at else None,
    }


async def list_accounts(db: AsyncSession) -> list[dict]:
    return [_account_out(a) for a in await _accounts(db)]


async def list_transactions(
    db: AsyncSession,
    *,
    account_id: uuid.UUID | None = None,
    q: str | None = None,
    start: date | None = None,
    end: date | None = None,
    limit: int = 200,
) -> list[dict]:
    stmt = (
        select(BankTransaction, BankAccount.name, BankAccount.last4)
        .join(BankAccount, BankAccount.id == BankTransaction.account_id)
        .where(BankAccount.provider == "usbank", BankAccount.environment == usbank.environment())
    )
    if account_id:
        stmt = stmt.where(BankTransaction.account_id == account_id)
    if start:
        stmt = stmt.where(BankTransaction.posted_on >= start)
    if end:
        stmt = stmt.where(BankTransaction.posted_on <= end)
    words = (q or "").strip()
    if words:
        like = f"%{words}%"
        stmt = stmt.where(
            or_(
                BankTransaction.description.ilike(like), BankTransaction.counterparty.ilike(like),
                BankTransaction.kind.ilike(like), BankTransaction.reference.ilike(like),
            )
        )
    stmt = stmt.order_by(BankTransaction.posted_on.desc(), BankTransaction.created_at).limit(max(1, min(int(limit), 1000)))
    return [
        {
            "id": str(t.id), "account_id": str(t.account_id), "account": f"{name} …{last4}",
            "posted_on": t.posted_on.isoformat(), "amount": float(t.amount), "currency": t.currency,
            "kind": t.kind, "description": t.description, "counterparty": t.counterparty, "reference": t.reference,
        }
        for t, name, last4 in await db.execute(stmt)
    ]


# ── What Gerry reads ──────────────────────────────────────────────────────────


async def overview(db: AsyncSession, user: User, *, search: str = "", days: int = 30, limit: int = 40) -> dict[str, Any]:
    """Balances and recent or matching transactions, for someone on the finance list."""
    await require_view(db, user)
    note = ""
    synced = await last_synced(db)
    if usbank.configured() and (synced is None or datetime.now(timezone.utc) - synced > STALE_AFTER):
        try:
            await sync_bank(db)
            await db.commit()
            synced = await last_synced(db)
        except usbank.BankError as exc:
            await db.rollback()
            note = f"The bank could not be read just now ({exc}); these are the last figures saved."
    days = max(1, min(int(days or 30), 730))
    return {
        "environment": usbank.environment(),
        "configured": usbank.configured(),
        "last_synced": synced.isoformat() if synced else None,
        "note": note,
        "accounts": await list_accounts(db),
        "days": days,
        "transactions": await list_transactions(
            db, q=search, start=date.today() - timedelta(days=days) if not search.strip() else None,
            limit=max(1, min(int(limit or 40), 200)),
        ),
    }


async def person(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise NotAllowed(NOT_ALLOWED)
    return user


async def from_hub(db: AsyncSession, user_id: uuid.UUID, path: str, params: dict[str, Any] | None = None) -> Any:
    """GET a ``/finance`` path on the hub as this person. For a desktop, which keeps no financial data."""
    from services.hub import client as hub

    if not hub.configured() or await hub.get_link(db, user_id) is None:
        raise FinanceUnavailable(
            "Financial data is kept on the hub. Connect this computer to the hub in Settings → Connections."
        )
    try:
        resp = await hub.request(
            db, user_id, "GET", path, params={k: v for k, v in (params or {}).items() if v not in ("", None)}
        )
    except hub.HubError as exc:
        raise FinanceUnavailable(str(exc)) from exc
    if resp.status_code == 200:
        return resp.json()
    if resp.status_code == 403:
        raise NotAllowed(NOT_ALLOWED)
    if resp.status_code == 404:
        raise FinanceUnavailable("The hub is not running a version that has this yet.")
    try:
        detail = resp.json().get("detail")
    except (ValueError, AttributeError):
        detail = None
    raise FinanceUnavailable(detail if isinstance(detail, str) and detail else f"The hub refused the request ({resp.status_code}).")


async def overview_for(db: AsyncSession, user_id: uuid.UUID, **args: Any) -> dict[str, Any]:
    """``overview`` from wherever this runs: here on a hub, through the hub on a desktop."""
    if settings.hub_mode:
        return await overview(db, await person(db, user_id), **args)
    return await from_hub(db, user_id, "/finance/overview", args)


def _amount(value: float | None, currency: str = "USD") -> str:
    return "unknown" if value is None else f"{value:,.2f} {currency}"


def render_overview(data: dict[str, Any], *, search: str = "") -> str:
    """The text Gerry is given: every figure with the date it runs to."""
    lines: list[str] = []
    if data["environment"] != "production":
        lines.append(
            f"NOTE: this is U.S. Bank {data['environment'].upper()} TEST DATA, not the company's real accounts. "
            "Say so whenever you report any figure from it."
        )
    if data.get("note"):
        lines.append(data["note"])
    accounts = data["accounts"]
    if not accounts:
        lines.append(
            "No bank accounts have been read yet." if data["configured"]
            else "The bank connection is not set up on this server."
        )
        return "\n".join(lines)
    lines.append(f"Bank accounts ({len(accounts)}), balances as of the bank's last close:")
    for a in accounts:
        lines.append(
            f"- {a['name']} …{a['last4']} ({a['account_type']}): available {_amount(a['available_balance'], a['currency'])}, "
            f"ledger {_amount(a['ledger_balance'], a['currency'])}, as of {a['balance_as_of'] or 'unknown'}"
        )
    by_currency: dict[str, float] = {}
    for a in accounts:
        if a["available_balance"] is not None:
            by_currency[a["currency"]] = by_currency.get(a["currency"], 0.0) + a["available_balance"]
    lines.append("Total available: " + "; ".join(_amount(v, c) for c, v in sorted(by_currency.items())) + ".")
    lines.append(f"Last read from the bank: {(data['last_synced'] or 'never')[:16].replace('T', ' ')} UTC.")
    txs = data["transactions"]
    lines.append("")
    lines.append(
        (f'Transactions matching "{search.strip()}": {len(txs)}.' if search.strip()
         else f"Transactions in the last {data['days']} days: {len(txs)} shown.")
    )
    for t in txs:
        who = f" | {t['counterparty']}" if t["counterparty"] else ""
        lines.append(
            f"- {t['posted_on']} | {t['amount']:+,.2f} {t['currency']} | {t['kind']} | {t['description']}{who} | {t['account']}"
        )
    return "\n".join(lines)
