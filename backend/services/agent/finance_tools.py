"""Agent tool for the company's bank accounts. Read-only, and only for the finance list.

Whoever is asking has to be on the finance list; anyone else is told so and
given nothing. Figures are returned with the date they run to, and test data
from the bank's sandbox is labelled as test data in the text itself.
"""

from __future__ import annotations

from typing import Any

from services import finance as svc


async def execute_read_bank(ctx: Any, args: dict[str, Any]) -> str:
    search = str(args.get("search") or args.get("query") or args.get("input") or "").strip()
    try:
        data = await svc.overview_for(
            ctx.db, ctx.user_id, search=search, days=args.get("days") or 30, limit=args.get("limit") or 40
        )
    except svc.FinanceError as exc:
        return f"Error: {exc}"
    return svc.render_overview(data, search=search)


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "read_bank",
            "description": (
                "Read the company's bank accounts: each account's balance as of the bank's last "
                "close, and posted transactions. Use it for 'how much cash do we have', 'what did we "
                "pay <vendor>', 'what came in this month', or to check a payment. With no arguments "
                "it returns balances and the last 30 days of transactions. 'search' matches a "
                "transaction's description, payee, type or reference across all dates. Only people "
                "on the company's finance list may see this; if the result says the user has no "
                "access, tell them that and nothing else about the accounts. Report every figure "
                "exactly as returned, with its 'as of' date, and never estimate or add up figures "
                "that were not returned. These are bank records, not the accountants' books. It "
                "only reads: it cannot move money or change anything."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {"type": "string", "description": "Words to look for in transactions (payee, description, type)."},
                    "days": {"type": "integer", "description": "How many days back to list when not searching (default 30)."},
                    "limit": {"type": "integer", "description": "At most this many transactions (default 40, max 200)."},
                },
                "required": [],
            },
        },
    },
]

TOOL_EXECUTORS = {"read_bank": execute_read_bank}

PRIMARY_ARGS = {"read_bank": "search"}

RUNNING_LABELS = {"read_bank": "Reading the bank…"}

TOOL_DOCS = {
    "read_bank": (
        "The company's bank accounts: balances as of the bank's last close, and posted transactions. "
        "Only for people on the finance list; if refused, say so and nothing more. Report figures "
        "exactly as returned with their 'as of' date; never estimate. Bank records, not the books. "
        "Read-only. JSON: {\"search\": str optional (payee, description, type), \"days\": int "
        "optional (default 30), \"limit\": int optional}."
    ),
}
