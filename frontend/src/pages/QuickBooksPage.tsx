/**
 * The company's books in QuickBooks Online, as the accountants keep them:
 * statements and lists, fetched when asked for. Read-only, and only for
 * people on the finance list. A sandbox company is labelled as test data.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, Search } from "lucide-react";

import {
  disconnectQuickBooks,
  getFinanceAccess,
  getQuickBooksList,
  getQuickBooksReport,
  getQuickBooksStatus,
  saveQuickBooksKeys,
  startQuickBooksConnect,
} from "@/api/finance";
import type { QuickBooksList, QuickBooksReport, QuickBooksStatus } from "@/api/finance";
import { useHubStatus } from "@/hooks/useAllWork";
import { BRAND } from "@/lib/brand";
import { openExternal } from "@/lib/externalLinks";
import { errorText, Notice } from "@/pages/BankPage";

const REPORTS = [
  { name: "profit_and_loss", label: "Profit and loss", period: true },
  { name: "balance_sheet", label: "Balance sheet", period: false },
  { name: "cash_flow", label: "Cash flow", period: true },
  { name: "aged_receivables", label: "Owed to us", period: false },
  { name: "aged_payables", label: "What we owe", period: false },
];

const LISTS = [
  { name: "accounts", label: "Accounts", dated: false },
  { name: "vendors", label: "Vendors", dated: false },
  { name: "customers", label: "Customers", dated: false },
  { name: "bills", label: "Bills", dated: true },
  { name: "invoices", label: "Invoices", dated: true },
  { name: "payments", label: "Payments received", dated: true },
  { name: "expenses", label: "Expenses", dated: true },
];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Start and end days for a named period, counted from today. */
function period(name: string): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (name === "this_month") return { start: iso(new Date(y, m, 1)), end: iso(now) };
  if (name === "last_month") return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
  if (name === "last_year") return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
  return { start: `${y}-01-01`, end: iso(now) };
}

function figure(value: string | number | null): string {
  if (value === null || value === "") return "";
  const n = typeof value === "number" ? value : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value);
}

const field = "rounded-md border bg-background px-2 py-1.5 text-sm";

export function QuickBooksPage() {
  const qc = useQueryClient();
  const hub = useHubStatus();
  const reachable = hub.data?.here === true || hub.data?.connected === true;
  const [waiting, setWaiting] = useState(false);
  const access = useQuery({ queryKey: ["finance", "access"], queryFn: getFinanceAccess, enabled: reachable, retry: false });
  const status = useQuery({
    queryKey: ["finance", "quickbooks", "status"],
    queryFn: getQuickBooksStatus,
    enabled: reachable && access.data?.can_view === true,
    retry: false,
    // While the person is away approving at Intuit, watch for the connection to appear.
    refetchInterval: waiting ? 3000 : false,
  });
  const ready = status.data?.connected === true && !status.data.needs_reconnect;
  useEffect(() => {
    if (waiting && ready) {
      setWaiting(false);
      void qc.invalidateQueries({ queryKey: ["finance", "quickbooks"] });
    }
  }, [waiting, ready, qc]);

  if (hub.isLoading || (reachable && access.isLoading)) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!reachable) {
    return (
      <Notice title="Financial data is kept on the hub.">
        Connect this computer to the hub under Settings → Connections.
      </Notice>
    );
  }
  if (!access.data) return <Notice title="Could not load.">{errorText(access.error, "Try again in a moment.")}</Notice>;
  if (!access.data.can_view) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">QuickBooks</h1>
        <Notice title="Financial data is limited to the people on the finance list.">
          The list is kept on the <Link to="/bank" className="underline">Bank</Link> page. Someone already on it can add
          you.
        </Notice>
      </div>
    );
  }
  if (status.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!status.data) return <Notice title="Could not load.">{errorText(status.error, "Try again in a moment.")}</Notice>;

  const s = status.data;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">QuickBooks</h1>
      {s.environment !== "production" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200">
          <strong>Test data.</strong> This connects to a QuickBooks sandbox company: made-up books, not the
          company&apos;s.
        </p>
      )}
      <Connection
        status={s}
        waiting={waiting}
        onWaiting={setWaiting}
        onChanged={() => void qc.invalidateQueries({ queryKey: ["finance", "quickbooks", "status"] })}
      />
      {ready && (
        <>
          <Reports />
          <Lists />
        </>
      )}
    </div>
  );
}

function Connection({
  status,
  waiting,
  onWaiting,
  onChanged,
}: {
  status: QuickBooksStatus;
  waiting: boolean;
  onWaiting: (waiting: boolean) => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const connect = useMutation({
    mutationFn: startQuickBooksConnect,
    onSuccess: (url) => {
      setError(null);
      onWaiting(true);
      openExternal(url);
    },
    onError: (e) => setError(errorText(e, "Could not start the connection.")),
  });
  const disconnect = useMutation({
    mutationFn: disconnectQuickBooks,
    onSuccess: () => {
      setConfirming(false);
      onChanged();
    },
    onError: (e) => setError(errorText(e, "Could not disconnect.")),
  });
  const connected = status.connected && !status.needs_reconnect;

  return (
    <section className="max-w-2xl rounded-lg border p-4 text-sm">
      {!status.configured ? (
        status.can_save_keys ? (
          <Keys status={status} onSaved={onChanged} />
        ) : (
          <p className="text-muted-foreground">
            QuickBooks is not set up on this server yet. An administrator on the finance list enters the Intuit keys on
            this page in the hub&apos;s web app.
          </p>
        )
      ) : connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="mr-auto">
            Connected to <strong>{status.company_name}</strong>
            <span className="text-muted-foreground">
              {status.connected_by ? ` by ${status.connected_by}` : ""}
              {status.connected_at ? `, ${new Date(status.connected_at).toLocaleDateString(undefined, { dateStyle: "medium" })}` : ""}
              . Read-only.
            </span>
          </p>
          {confirming ? (
            <>
              <button onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="rounded-md border border-destructive px-3 py-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-60">
                {disconnect.isPending ? "Disconnecting…" : "Yes, disconnect"}
              </button>
              <button onClick={() => setConfirming(false)} className="rounded-md border px-3 py-1.5 hover:bg-accent">
                Keep it
              </button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)} className="rounded-md border px-3 py-1.5 hover:bg-accent">
              Disconnect
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="font-medium">
            {status.needs_reconnect
              ? `QuickBooks needs to be connected again${status.company_name ? ` (${status.company_name})` : ""}.`
              : "Connect the company's QuickBooks."}
          </p>
          <p className="text-muted-foreground">
            A browser tab opens at Intuit. Sign in, choose the company and approve. {BRAND.productName} only reads the
            books: it has no way to add or change anything in them. Everyone on the finance list then sees them here.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <ExternalLink className="h-4 w-4" />
              {status.needs_reconnect ? "Connect again" : "Connect to QuickBooks"}
            </button>
            {waiting && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting for you to approve at Intuit…
              </span>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive" role="status">{error}</p>}
    </section>
  );
}

function Keys({ status, onSaved }: { status: QuickBooksStatus; onSaved: () => void }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [environment, setEnvironment] = useState("sandbox");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => saveQuickBooksKeys({ client_id: clientId, client_secret: secret, environment }),
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(errorText(e, "Could not save the keys.")),
  });

  return (
    <div className="space-y-3">
      <p className="font-medium">Set up QuickBooks</p>
      <p className="text-muted-foreground">
        {BRAND.productName} connects through your company&apos;s own app at developer.intuit.com. Copy its client ID and
        client secret from Keys &amp; credentials, and list this address there as a redirect URI:
      </p>
      <code className="block select-all break-all rounded-md bg-muted px-2 py-1.5 text-xs">{status.redirect_uri}</code>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" aria-label="Client ID" autoComplete="off" className={field} />
        <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" placeholder="Client secret" aria-label="Client secret" autoComplete="off" className={field} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={environment} onChange={(e) => setEnvironment(e.target.value)} aria-label="Which keys these are" className={field}>
          <option value="sandbox">Development keys (sandbox company)</option>
          <option value="production">Production keys (the real books)</option>
        </select>
        <button onClick={() => save.mutate()} disabled={!clientId.trim() || !secret.trim() || save.isPending} className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-60">
          {save.isPending ? "Checking with Intuit…" : "Save"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Kept encrypted on the hub and never shown again.</p>
      {error && <p className="text-xs text-destructive" role="status">{error}</p>}
    </div>
  );
}

function Reports() {
  const [name, setName] = useState(REPORTS[0].name);
  const [preset, setPreset] = useState("this_year");
  const [start, setStart] = useState(period("this_year").start);
  const [end, setEnd] = useState(period("this_year").end);
  const [by, setBy] = useState("");
  const spec = REPORTS.find((r) => r.name === name) ?? REPORTS[0];

  const choose = (next: string) => {
    setPreset(next);
    if (next !== "custom") {
      const p = period(next);
      setStart(p.start);
      setEnd(p.end);
    }
  };
  const params = spec.period ? { start, end, by: by || undefined } : { end };
  const report = useQuery({
    queryKey: ["finance", "quickbooks", "report", name, params],
    queryFn: () => getQuickBooksReport(name, params),
    enabled: Boolean(end) && (!spec.period || Boolean(start)),
    retry: false,
    staleTime: 60_000,
  });

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex flex-wrap gap-1" role="tablist" aria-label="Statement">
          {REPORTS.map((r) => (
            <button
              key={r.name}
              role="tab"
              aria-selected={r.name === name}
              onClick={() => setName(r.name)}
              className={`rounded-md px-3 py-1.5 text-sm ${r.name === name ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {spec.period ? (
          <>
            <select value={preset} onChange={(e) => choose(e.target.value)} aria-label="Period" className={field}>
              <option value="this_year">This year so far</option>
              <option value="this_month">This month so far</option>
              <option value="last_month">Last month</option>
              <option value="last_year">Last year</option>
              <option value="custom">Other dates</option>
            </select>
            {preset === "custom" && (
              <>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="From" className={field} />
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="To" className={field} />
              </>
            )}
            <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="Columns" className={field}>
              <option value="">One total</option>
              <option value="month">By month</option>
              <option value="quarter">By quarter</option>
              <option value="year">By year</option>
            </select>
          </>
        ) : (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            As of
            <input type="date" value={end} onChange={(e) => { setPreset("custom"); setEnd(e.target.value); }} aria-label="As of" className={field} />
          </label>
        )}
      </div>
      {report.isLoading && <p className="text-sm text-muted-foreground">Reading the books…</p>}
      {report.error && <p className="text-sm text-destructive" role="status">{errorText(report.error, "The books could not be read.")}</p>}
      {report.data && <ReportTable report={report.data} />}
    </section>
  );
}

function ReportTable({ report }: { report: QuickBooksReport }) {
  const width = Math.max(report.columns.length, ...report.lines.map((l) => l.cells.length), 1);
  const span = report.start ? `${report.start} to ${report.end}` : `as of ${report.end}`;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {report.company} · {span}
        {report.basis ? ` · ${report.basis} basis` : ""}
        {report.currency ? ` · ${report.currency}` : ""} · as posted by the accountants
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" aria-label={report.title}>
          {report.columns.some(Boolean) && (
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {Array.from({ length: width }, (_, i) => (
                  <th key={i} className={`whitespace-nowrap px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>
                    {report.columns[i] ?? ""}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y">
            {report.lines.map((line, n) => (
              <tr key={n} className={line.kind === "row" ? "" : "font-medium"}>
                {Array.from({ length: width }, (_, i) => (
                  <td
                    key={i}
                    className={i ? "whitespace-nowrap px-3 py-1.5 text-right tabular-nums" : "px-3 py-1.5"}
                    style={i ? undefined : { paddingLeft: `${0.75 + line.depth * 1.25}rem` }}
                  >
                    {i ? figure(line.cells[i] ?? "") : line.cells[0]}
                  </td>
                ))}
              </tr>
            ))}
            {!report.lines.length && (
              <tr>
                <td className="px-3 py-4 text-muted-foreground">QuickBooks has nothing to report for this.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Lists() {
  const [name, setName] = useState(LISTS[0].name);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(365);
  const spec = LISTS.find((l) => l.name === name) ?? LISTS[0];

  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const list = useQuery({
    queryKey: ["finance", "quickbooks", "list", name, search, spec.dated ? days : 0],
    queryFn: () => getQuickBooksList(name, { search: search || undefined, days: spec.dated ? days : undefined, limit: 200 }),
    retry: false,
    staleTime: 60_000,
  });

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">In the books</h2>
        <select value={name} onChange={(e) => setName(e.target.value)} aria-label="List" className={field}>
          {LISTS.map((l) => (
            <option key={l.name} value={l.name}>
              {l.label}
            </option>
          ))}
        </select>
        {spec.dated && (
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="How far back" className={field}>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
            <option value={1095}>Last 3 years</option>
          </select>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Name, number, memo"
            aria-label="Search the list"
            className="w-56 rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm"
          />
        </div>
      </div>
      {list.error && <p className="text-sm text-destructive" role="status">{errorText(list.error, "The books could not be read.")}</p>}
      {list.data && <ListTable list={list.data} search={search} />}
      {list.isLoading && <p className="text-sm text-muted-foreground">Reading the books…</p>}
    </section>
  );
}

function ListTable({ list, search }: { list: QuickBooksList; search: string }) {
  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" aria-label={list.title}>
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {list.columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-medium ${c.kind === "money" ? "text-right" : "text-left"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.rows.map((row, n) => (
              <tr key={n}>
                {list.columns.map((c) => (
                  <td key={c.key} className={c.kind === "money" ? "whitespace-nowrap px-3 py-1.5 text-right tabular-nums" : c.kind === "date" ? "whitespace-nowrap px-3 py-1.5 text-muted-foreground" : "px-3 py-1.5"}>
                    {c.kind === "money" ? figure(row[c.key] ?? null) : (row[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {!list.rows.length && (
              <tr>
                <td colSpan={list.columns.length} className="px-3 py-4 text-muted-foreground">
                  {search ? `Nothing matches "${search}".` : "Nothing here."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(list.rows.length < list.total || list.capped) && (
        <p className="text-xs text-muted-foreground">
          Showing {list.rows.length} of {list.capped ? "at least " : ""}
          {list.total}. Search to narrow it.
        </p>
      )}
    </>
  );
}
