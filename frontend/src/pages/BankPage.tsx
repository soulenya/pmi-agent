/**
 * The company's bank accounts as the bank reports them: balances as of the
 * last close, and posted transactions. Read-only, and only for people on the
 * finance list. Test data from the bank's sandbox is labelled as such.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Loader2, RefreshCw, Search, X } from "lucide-react";

import {
  getFinanceAccess,
  listBankAccounts,
  listBankTransactions,
  setFinanceViewers,
  syncBank,
} from "@/api/finance";
import type { FinanceAccess, SyncReport } from "@/api/finance";
import { useHubStatus } from "@/hooks/useAllWork";

function errorText(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (!err.response) return "Could not reach the server.";
  }
  return fallback;
}

function money(value: number | null, currency = "USD"): string {
  if (value === null) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";
}

export function BankPage() {
  const qc = useQueryClient();
  const hub = useHubStatus();
  const reachable = hub.data?.here === true || hub.data?.connected === true;
  const access = useQuery({ queryKey: ["finance", "access"], queryFn: getFinanceAccess, enabled: reachable, retry: false });

  if (hub.isLoading || (reachable && access.isLoading)) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!reachable) {
    return (
      <Notice title="Financial data is kept on the hub.">
        Connect this computer to the hub under Settings → Connections.
      </Notice>
    );
  }
  if (!access.data) return <Notice title="Could not load.">{errorText(access.error, "Try again in a moment.")}</Notice>;

  const a = access.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["finance"] });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Bank</h1>
      {a.environment !== "production" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200">
          <strong>Test data.</strong> This is U.S. Bank&apos;s {a.environment} environment: made-up accounts and
          figures, not the company&apos;s money.
        </p>
      )}
      {a.can_view ? (
        <Books access={a} onChanged={refresh} />
      ) : (
        <Notice title="Financial data is limited to the people on the finance list.">
          {a.can_manage
            ? "Nobody is on the list yet. As an administrator you can start it below; after that, only people on the list can change it."
            : "Someone already on it can add you."}
        </Notice>
      )}
      {a.can_manage && <Viewers access={a} onChanged={refresh} />}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-xl rounded-lg border p-5 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  );
}

function Books({ access, onChanged }: { access: FinanceAccess; onChanged: () => void }) {
  const [accountId, setAccountId] = useState("");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const accounts = useQuery({ queryKey: ["finance", "accounts"], queryFn: listBankAccounts });
  const txs = useQuery({
    queryKey: ["finance", "transactions", accountId, q],
    queryFn: () => listBankTransactions({ account_id: accountId || undefined, q: q || undefined }),
  });
  const sync = useMutation({
    mutationFn: syncBank,
    onSuccess: (r) => {
      setReport(r);
      setError(null);
      onChanged();
    },
    onError: (e) => setError(errorText(e, "The bank could not be read.")),
  });

  const rows = accounts.data ?? [];
  const totals = new Map<string, number>();
  for (const acc of rows) {
    if (acc.available_balance !== null) totals.set(acc.currency, (totals.get(acc.currency) ?? 0) + acc.available_balance);
  }
  const asOf = [...new Set(rows.map((r) => r.balance_as_of).filter(Boolean))].sort().pop();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Last read from the bank: {when(access.last_synced)}</span>
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending || !access.bank_configured}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-60"
        >
          {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {sync.isPending ? "Reading the bank…" : "Read the bank now"}
        </button>
        {!access.bank_configured && <span className="text-muted-foreground">The bank connection is not set up on this server.</span>}
      </div>
      {error && <p className="text-sm text-destructive" role="status">{error}</p>}
      {report && (
        <p className="text-sm" role="status">
          {report.new_transactions} new transaction{report.new_transactions === 1 ? "" : "s"} across {report.accounts}{" "}
          account{report.accounts === 1 ? "" : "s"}.
          {report.skipped.length > 0 && ` The bank gave no transactions for ${report.skipped.length} of them.`}
        </p>
      )}

      <section className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 text-right font-medium">Available</th>
              <th className="px-3 py-2 text-right font-medium">Ledger</th>
              <th className="px-3 py-2 font-medium">As of</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((acc) => (
              <tr key={acc.id}>
                <td className="px-3 py-2">
                  {acc.name} <span className="text-muted-foreground">…{acc.last4} · {acc.account_type}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(acc.available_balance, acc.currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(acc.ledger_balance, acc.currency)}</td>
                <td className="px-3 py-2 text-muted-foreground">{acc.balance_as_of ?? "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  {accounts.isLoading ? "Loading…" : "Nothing has been read from the bank yet."}
                </td>
              </tr>
            )}
          </tbody>
          {totals.size > 0 && (
            <tfoot className="border-t bg-muted/30 font-medium">
              <tr>
                <td className="px-3 py-2">Total available</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {[...totals].map(([currency, value]) => money(value, currency)).join(" · ")}
                </td>
                <td />
                <td className="px-3 py-2 text-xs font-normal text-muted-foreground">{asOf ? `as of ${asOf}` : ""}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold">Transactions</h2>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="Account"
            className="max-w-xs rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">All accounts</option>
            {rows.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} …{acc.last4}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Payee, description, type"
              aria-label="Search transactions"
              className="w-60 rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {(txs.data ?? []).map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{t.posted_on}</td>
                  <td className="px-3 py-2">
                    {t.counterparty || t.description}
                    <span className="block text-xs text-muted-foreground">
                      {[t.counterparty ? t.description : "", t.kind, t.account].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${t.amount > 0 ? "text-emerald-600" : ""}`}>
                    {t.amount > 0 ? "+" : ""}
                    {money(t.amount, t.currency)}
                  </td>
                </tr>
              ))}
              {!txs.data?.length && (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground">
                    {txs.isLoading ? "Loading…" : q ? `Nothing matches "${q}".` : "No transactions."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Viewers({ access, onChanged }: { access: FinanceAccess; onChanged: () => void }) {
  const [emails, setEmails] = useState(access.viewers);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: string[]) => setFinanceViewers(next),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (e) => setError(errorText(e, "Could not save the list.")),
  });
  useEffect(() => setEmails(access.viewers), [access.viewers]);

  const add = () => {
    const email = adding.trim().toLowerCase();
    if (!email || emails.includes(email)) return;
    setAdding("");
    save.mutate([...emails, email]);
  };

  return (
    <section className="max-w-xl rounded-lg border p-4 text-sm">
      <h2 className="font-semibold">Who can see financial data</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Only these people see this page, and only they get an answer when they ask Gerry about money. Anyone on the
        list can change it.
      </p>
      <ul className="mt-3 space-y-1">
        {emails.map((email) => (
          <li key={email} className="flex items-center gap-2">
            <span className="flex-1">{email}</span>
            <button
              onClick={() => save.mutate(emails.filter((e) => e !== email))}
              disabled={save.isPending}
              className="rounded-md p-1 hover:bg-accent"
              aria-label={`Remove ${email}`}
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
        {!emails.length && <li className="text-muted-foreground">Nobody yet.</li>}
      </ul>
      <div className="mt-3 flex gap-2">
        <input
          type="email"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="name@company.com"
          aria-label="Email to add"
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5"
        />
        <button onClick={add} disabled={!adding.trim() || save.isPending} className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-60">
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive" role="status">{error}</p>}
    </section>
  );
}
