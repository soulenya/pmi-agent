import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Boxes,
  Plug,
  PlugZap,
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  CheckCircle2,
  AlertCircle,
  BookPlus,
  CheckCheck,
  CreditCard,
  ShieldCheck,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import {
  getOdooStatus,
  connectOdoo,
  disconnectOdoo,
  getOdooModels,
  getOdooData,
  ingestOdoo,
  proposeOdooAction,
  type OdooConnectRequest,
  type OdooWriteAction,
} from "@/api/odoo";

// The Odoo instance is shared org-wide; only the API key differs per user.
const ODOO_URL = "https://precisian-medical-instruments.odoo.com";
const ODOO_DATABASE = "precisian-medical-instruments";
const ODOO_EMAIL_DOMAIN = "precisianmedical.com";

/** Derive the Odoo login from the signed-in user: same local part, fixed domain. */
function odooLoginFor(email: string | undefined): string {
  const local = (email ?? "").split("@")[0];
  return local ? `${local}@${ODOO_EMAIL_DOMAIN}` : "";
}

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

// ── Connect form ─────────────────────────────────────────────────────────────

function ConnectForm({ onDone }: { onDone: () => void }) {
  const userEmail = useAuthStore((s) => s.user?.email);
  const [form, setForm] = useState<OdooConnectRequest>({
    url: ODOO_URL,
    database: ODOO_DATABASE,
    username: odooLoginFor(userEmail),
    api_key: "",
  });

  const connect = useMutation({
    mutationFn: () => connectOdoo(form),
    onSuccess: onDone,
  });

  const error = connect.error as { response?: { data?: { detail?: string } } } | null;
  const field = (key: keyof OdooConnectRequest, label: string, type = "text", placeholder = "") => (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
      />
    </label>
  );

  const canSubmit = form.url && form.database && form.username && form.api_key && !connect.isPending;

  return (
    <div className="max-w-lg space-y-4 rounded-lg border bg-card p-6">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Connect your Odoo ERP</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        The company, database, and your login are filled in for you — just create an API key in Odoo
        under <span className="font-medium">your profile → Account Security → New API Key</span> and
        paste it below. Your key is encrypted before it is stored.
      </p>
      <div className="space-y-3">
        {field("url", "Odoo URL", "text", "https://yourcompany.odoo.com")}
        {field("database", "Database name", "text", "yourcompany")}
        {field("username", "Login email", "text", "you@company.com")}
        {field("api_key", "API key", "password", "••••••••••••")}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.response?.data?.detail ?? "Connection failed. Check your details and try again."}</span>
        </div>
      )}

      <button
        onClick={() => connect.mutate()}
        disabled={!canSubmit}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
        Connect
      </button>
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
          "Approve it on the Approvals page to run it.",
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

export default function OdooIntegrationPage() {
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-1">
      <div className="flex items-center gap-3">
        <Boxes className="h-7 w-7" style={{ color: "#fb923c" }} />
        <div>
          <h1 className="text-2xl font-bold">Odoo ERP</h1>
          <p className="text-sm text-muted-foreground">
            Read live business data from your Odoo ERP.
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
                  {status.server_version ? ` · Odoo ${status.server_version}` : ""}
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

          <DataBrowser />
        </>
      ) : (
        <ConnectForm onDone={refreshStatus} />
      )}
    </div>
  );
}
