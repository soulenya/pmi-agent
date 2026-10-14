import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Boxes,
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  CheckCircle2,
  AlertCircle,
  BookPlus,
  CheckCheck,
  CreditCard,
  ShieldCheck,
  Landmark,
  Wallet,
} from "lucide-react";
import {
  getOdooStatus,
  disconnectOdoo,
  getOdooModels,
  getOdooData,
  getOdooBankBalance,
  ingestOdoo,
  proposeOdooAction,
  type OdooWriteAction,
} from "@/api/odoo";
import { ErpConnectPanel } from "@/components/erp/ErpConnectPanel";

// Odoo returns many2one fields as [id, "Display Name"]. Render cells nicely.
function renderCell(value: unknown): string {
  if (value === false || value === null || value === undefined) return "—";
  if (Array.isArray(value)) return String(value[1] ?? value[0] ?? "—");
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function prettyField(field: string): string {
  return field
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Bank balance ─────────────────────────────────────────────────────────────

function formatMoney(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency ? `${formatted} ${currency}` : formatted;
}

function BankBalance() {
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["odoo-bank-balance"],
    queryFn: getOdooBankBalance,
  });

  const err = error as { response?: { data?: { detail?: string } } } | null;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Landmark className="h-5 w-5 text-emerald-500" /> Bank Balance
        </h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          title="Refresh balances from Odoo"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading balances…
        </div>
      ) : err ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{err.response?.data?.detail ?? "Could not load bank balances from Odoo."}</span>
        </div>
      ) : !data || data.accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bank or cash accounts were found in Odoo.
        </p>
      ) : (
        <>
          <div className="rounded-lg border bg-emerald-500/5 px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total available
            </div>
            <div className="mt-0.5 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatMoney(data.total, data.currency)}
            </div>
          </div>
          <div className="divide-y rounded-lg border">
            {data.accounts.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex items-center gap-2.5 text-sm">
                  <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{a.journal}</div>
                    {a.account && (
                      <div className="text-xs text-muted-foreground">{a.account}</div>
                    )}
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {formatMoney(a.balance, data.currency)}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Balances reflect posted journal entries and are shown in your company currency.
          </p>
        </>
      )}
    </div>
  );
}

// ── Data browser ─────────────────────────────────────────────────────────────

function DataBrowser() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: models } = useQuery({
    queryKey: ["odoo-models"],
    queryFn: getOdooModels,
  });

  const selectedKey = activeKey ?? models?.[0]?.key ?? null;

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["odoo-data", selectedKey, search],
    queryFn: () => getOdooData(selectedKey as string, { search }),
    enabled: !!selectedKey,
  });

  const dataErr = error as { response?: { data?: { detail?: string } } } | null;

  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  const ingestRows = useMutation({
    mutationFn: (ids?: number[]) => ingestOdoo(selectedKey as string, { ids }),
    onMutate: () => setIngestMsg(null),
    onSuccess: (res) =>
      setIngestMsg(
        `Imported ${res.imported} to the Knowledge Base` +
          (res.skipped ? `, ${res.skipped} already imported` : "") +
          (res.failed ? `, ${res.failed} failed` : "") +
          ".",
      ),
    onError: () => setIngestMsg("Import failed. Please try again."),
  });

  const allIds = (data?.rows ?? [])
    .map((r) => r.id)
    .filter((id): id is number => typeof id === "number");

  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const propose = useMutation({
    mutationFn: (input: { action: OdooWriteAction; params: Record<string, unknown> }) =>
      proposeOdooAction(input.action, input.params),
    onMutate: () => setActionMsg(null),
    onSuccess: (res) =>
      setActionMsg(
        `Queued for approval: “${res.title}” (${res.risk_level} risk). ` +
          "Approve it under Waiting for you to run it.",
      ),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } } };
      setActionMsg(err.response?.data?.detail ?? "Could not queue the action.");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {models?.map((m) => (
          <button
            key={m.key}
            onClick={() => {
              setActiveKey(m.key);
              setSearch("");
              setIngestMsg(null);
            }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              m.key === selectedKey
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <button
          onClick={() => ingestRows.mutate(allIds.length ? allIds : undefined)}
          disabled={ingestRows.isPending || !data || data.rows.length === 0}
          className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          title="Add the rows shown below to the Knowledge Base so they're searchable"
        >
          {ingestRows.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BookPlus className="h-4 w-4" />
          )}
          Import all to Knowledge Base
        </button>
      </div>

      {ingestMsg && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{ingestMsg}</span>
        </div>
      )}

      {actionMsg && (
        <div className="flex items-start gap-2 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-700 dark:text-violet-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      {dataErr && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{dataErr.response?.data?.detail ?? "Could not load data from Odoo."}</span>
        </div>
      )}

      {data && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {data.fields.map((f) => (
                  <th key={f} className="px-3 py-2 text-left font-medium text-muted-foreground">
                    {prettyField(f)}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={data.fields.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                    No records found.
                  </td>
                </tr>
              ) : (
                data.rows.map((row, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30">
                    {data.fields.map((f) => (
                      <td key={f} className="px-3 py-2">
                        {renderCell(row[f])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {selectedKey === "sales" && typeof row.id === "number" && (
                          <button
                            onClick={() =>
                              propose.mutate({
                                action: "confirm_quotation",
                                params: { order_id: row.id, order_name: row.name },
                              })
                            }
                            disabled={propose.isPending}
                            title="Confirm this quotation (needs your approval)"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            <CheckCheck className="h-4 w-4" />
                          </button>
                        )}
                        {selectedKey === "invoices" && typeof row.id === "number" && (
                          <button
                            onClick={() =>
                              propose.mutate({
                                action: "register_payment",
                                params: {
                                  move_id: row.id,
                                  move_name: row.name,
                                  amount: row.amount_residual,
                                },
                              })
                            }
                            disabled={propose.isPending}
                            title="Register a payment for this invoice (needs your approval)"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            <CreditCard className="h-4 w-4" />
                          </button>
                        )}
                        {typeof row.id === "number" && (
                          <button
                            onClick={() => ingestRows.mutate([row.id as number])}
                            disabled={ingestRows.isPending}
                            title="Import this record to the Knowledge Base"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            <BookPlus className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ErpPage() {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["odoo-status"],
    queryFn: getOdooStatus,
  });

  const disconnect = useMutation({
    mutationFn: disconnectOdoo,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["odoo-status"] }),
  });

  const refreshStatus = () => qc.invalidateQueries({ queryKey: ["odoo-status"] });
  const label = status?.label ?? "ERP";
  const isOdoo = status?.provider === "odoo";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-1">
      <div className="flex items-center gap-3">
        <Boxes className="h-7 w-7" style={{ color: "#fb923c" }} />
        <div>
          <h1 className="text-2xl font-bold">{isOdoo ? "Odoo ERP" : label === "No ERP" ? "ERP" : `${label} ERP`}</h1>
          <p className="text-sm text-muted-foreground">
            {isOdoo ? "Read live business data from your Odoo ERP." : "Read live business data from the company's ERP."}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : status?.connected ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <div className="text-sm">
                <div className="font-medium">
                  Connected{status.display_name ? ` as ${status.display_name}` : ""}
                </div>
                <div className="text-muted-foreground">
                  {status.url} · db: {status.database}
                  {status.server_version ? ` · ${status.label} ${status.server_version}` : ""}
                </div>
              </div>
            </div>
            <button
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>

          <BankBalance />

          <DataBrowser />
        </>
      ) : (
        <ErpConnectPanel onChanged={refreshStatus} />
      )}
    </div>
  );
}
