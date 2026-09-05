/**
 * BudgetsPage — "Manage Budgets": personal Drive-backed budgets.
 *
 * Two surfaces, one ledger: the Google Sheet on Drive is the system of
 * record. Edits here write through to the Sheet immediately; edits made
 * directly in Sheets appear here automatically (refresh on open + 30s poll
 * while visible + re-read before every write). Gerry's chat writes are
 * gated by the per-budget permission toggle. Not an official budget center.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ExternalLink,
  Link2,
  Loader2,
  PlusCircle,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  addBudgetReference,
  compareBudgetToOdoo,
  createBudget,
  getBudget,
  linkBudget,
  listBudgets,
  refreshBudget,
  removeBudgetReference,
  unlinkBudget,
  updateBudget,
  type BudgetDetail,
  type OdooCompareResult,
} from "@/api/budgets";
import {
  BudgetLedgerTable,
  BudgetSummaryCards,
  money,
} from "@/components/budgets/BudgetLedger";
import { InvoiceIntake } from "@/components/budgets/InvoiceIntake";
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";

export function BudgetsPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAllotment, setNewAllotment] = useState("");
  const [newCategories, setNewCategories] = useState("");
  const [linkRef, setLinkRef] = useState("");

  const { data: budgets = [], isLoading } = useQuery({
    queryKey: ["budgets"],
    queryFn: () => listBudgets(),
  });

  const { data: budget } = useQuery({
    queryKey: ["budget", selectedId],
    queryFn: () => getBudget(selectedId!),
    enabled: !!selectedId,
    // Two-surface contract: pick up Sheets-side edits while the page is open.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    if (selectedId) qc.invalidateQueries({ queryKey: ["budget", selectedId] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createBudget({
        title: newTitle.trim(),
        allotment: newAllotment.trim() ? Number(newAllotment) : null,
        categories: newCategories.split(",").map((c) => c.trim()).filter(Boolean),
      }),
    onSuccess: (b) => {
      setCreating(false);
      setNewTitle("");
      setNewAllotment("");
      setNewCategories("");
      setSelectedId(b.id);
      invalidate();
      push("success", `Budget "${b.title}" created — its Google Sheet is in the company budgets folder on Drive.`);
    },
    onError: (e) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", detail || "Couldn't create the budget.");
    },
  });

  const linkMutation = useMutation({
    mutationFn: () => linkBudget(linkRef.trim()),
    onSuccess: (b) => {
      setLinking(false);
      setLinkRef("");
      setSelectedId(b.id);
      invalidate();
      push("success", `Linked "${b.title}" (read-only — Gerry didn't create this sheet).`);
    },
    onError: (e) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", detail || "Couldn't link that spreadsheet.");
    },
  });

  return (
    <div className="flex h-full gap-4">
      {/* ── Budget list ──────────────────────────────────────────────── */}
      <aside className="flex w-72 flex-col gap-2 border-r pr-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Wallet className="h-5 w-5" />
          Manage Budgets
        </h1>

        {creating ? (
          <div className="space-y-2 rounded-md border p-3">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Budget title (e.g. VACTOR Prototyping)"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <input
              value={newAllotment}
              onChange={(e) => setNewAllotment(e.target.value)}
              placeholder="Allotment in USD (optional)"
              type="number"
              min="0"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <input
              value={newCategories}
              onChange={(e) => setNewCategories(e.target.value)}
              placeholder="Categories, comma-separated (optional)"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate()}
                disabled={!newTitle.trim() || createMutation.isPending}
                className="flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {createMutation.isPending ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  "Create budget"
                )}
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : linking ? (
          <div className="space-y-2 rounded-md border p-3">
            <input
              autoFocus
              value={linkRef}
              onChange={(e) => setLinkRef(e.target.value)}
              placeholder="Spreadsheet ID or URL"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Links an existing sheet read-only (only Gerry-created sheets are editable here).
              A teammate can share their budget sheet with you from Google Sheets — paste its
              link here to follow it.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => linkMutation.mutate()}
                disabled={!linkRef.trim() || linkMutation.isPending}
                className="flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {linkMutation.isPending ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  "Link sheet"
                )}
              </button>
              <button onClick={() => setLinking(false)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setCreating(true)}
              className="flex flex-1 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <PlusCircle className="h-4 w-4" />
              Create a budget
            </button>
            <button
              onClick={() => setLinking(true)}
              title="Link an existing spreadsheet (read-only)"
              className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            >
              <Link2 className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex-1 space-y-1 overflow-y-auto">
          {isLoading && (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          )}
          {!isLoading && budgets.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No budgets yet. Create one — it lives as a Google Sheet on your
              Drive, editable from either side.
            </div>
          )}
          {budgets.map((b) => {
            const s = b.cached_summary || {};
            const committed = (s.total_spent ?? 0) + (s.total_allocated ?? 0);
            const pct = s.allotment ? Math.min(100, Math.round((committed / s.allotment) * 100)) : null;
            return (
              <button
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                  b.id === selectedId ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{b.title}</span>
                  {b.external_readonly && (
                    <span className="shrink-0 rounded bg-accent px-1 text-[10px] text-muted-foreground">read-only</span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {money(s.total_spent ?? 0, b.currency)} spent
                  {s.allotment != null && ` of ${money(s.allotment, b.currency)}`}
                </div>
                {(s.total_allocated ?? 0) > 0 && (
                  <div className="truncate text-xs text-amber-600 dark:text-amber-400">
                    {money(s.total_allocated, b.currency)} allocated
                  </div>
                )}
                {pct !== null && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-accent">
                    <div
                      className={cn("h-full", pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <p className="border-t pt-2 text-[11px] text-muted-foreground">
          A personal financial-management aid — not the company's official books.
        </p>
      </aside>

      {/* ── Budget detail ─────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {!budget ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Wallet className="h-8 w-8 opacity-50" />
            <p className="text-lg font-medium">Select or create a budget</p>
            <p className="max-w-md text-sm">
              Each budget is a Google Sheet on your Drive. Edit it here or in
              Sheets — changes reflect in both, and Gerry can help when you
              grant her permission.
            </p>
          </div>
        ) : (
          <BudgetDetailView key={budget.id} budget={budget} onChanged={invalidate} onUnlinked={() => setSelectedId(null)} />
        )}
      </div>
    </div>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────

function BudgetDetailView({
  budget,
  onChanged,
  onUnlinked,
}: {
  budget: BudgetDetail;
  onChanged: () => void;
  onUnlinked: () => void;
}) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const readonly = budget.external_readonly;

  const refreshMutation = useMutation({
    mutationFn: () => refreshBudget(budget.id),
    onSuccess: onChanged,
  });

  const grantMutation = useMutation({
    mutationFn: (enabled: boolean) => updateBudget(budget.id, { gerry_write_enabled: enabled }),
    onSuccess: (b) => {
      onChanged();
      push("info", b.gerry_write_enabled
        ? "Gerry may now add and edit entries in this budget (deletes still confirm in chat)."
        : "Gerry's write access to this budget is off — she can still read it.");
    },
  });

  const unlink = async () => {
    if (!window.confirm(`Remove "${budget.title}" from Little Gerry? The Google Sheet stays on your Drive untouched.`)) return;
    const res = await unlinkBudget(budget.id);
    qc.invalidateQueries({ queryKey: ["budgets"] });
    onUnlinked();
    push("info", `Budget unlinked. The sheet is still on Drive: ${res.sheet_kept_at}`);
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{budget.title}</h2>
          <p className="text-xs text-muted-foreground">
            {readonly ? "Linked read-only" : "Gerry-managed sheet"} ·{" "}
            {budget.cached_at ? `synced ${new Date(budget.cached_at).toLocaleTimeString()}` : "not synced yet"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={budget.drive_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <ExternalLink className="h-4 w-4" />
            Open in Sheets
          </a>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
            title="Pull the latest from the Google Sheet now"
          >
            {refreshMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
          <button
            onClick={unlink}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            title="Remove from Little Gerry (the sheet on Drive is kept)"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Summary */}
      <BudgetSummaryCards budget={budget} />

      {/* Gerry permission */}
      {!readonly && (
        <section className="flex items-center justify-between rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Let Gerry manage entries</p>
              <p className="text-xs text-muted-foreground">
                When on, you can ask Gerry in chat to add or edit entries here.
                Deletions always require your confirmation. You stay in full control.
              </p>
            </div>
          </div>
          <button
            onClick={() => grantMutation.mutate(!budget.gerry_write_enabled)}
            disabled={grantMutation.isPending}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors",
              budget.gerry_write_enabled ? "bg-primary" : "bg-muted-foreground/30",
            )}
            title={budget.gerry_write_enabled ? "Revoke Gerry's write access" : "Grant Gerry write access"}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                budget.gerry_write_enabled ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
        </section>
      )}

      {/* Finding invoices, and reviewing what turned up */}
      {!readonly && <InvoiceIntake budget={budget} onChanged={onChanged} />}

      {/* Cross-budget references + Odoo cross-check */}
      <ReferencesSection budget={budget} onChanged={onChanged} />
      <OdooCompareSection budget={budget} />

      {/* Categories, ledger and the add-entry row */}
      <BudgetLedgerTable budget={budget} canEdit={!readonly} onChanged={onChanged} />
    </div>
  );
}

// ── Cross-budget references — a master budget uses other budgets' numbers ──

function ReferencesSection({ budget, onChanged }: { budget: BudgetDetail; onChanged: () => void }) {
  const push = useToastStore((s) => s.push);
  const [adding, setAdding] = useState(false);
  const [pickId, setPickId] = useState("");
  const [asLineItem, setAsLineItem] = useState(!budget.external_readonly);
  const [busy, setBusy] = useState(false);

  const all = useQuery({ queryKey: ["budgets"], queryFn: () => listBudgets() });
  const alreadyRefd = new Set(budget.references.map((r) => r.ref_budget_id));
  const candidates = (all.data ?? []).filter((b) => b.id !== budget.id && !alreadyRefd.has(b.id));

  if (budget.references.length === 0 && candidates.length === 0) return null;

  const add = async () => {
    if (!pickId) return;
    setBusy(true);
    try {
      await addBudgetReference(budget.id, { ref_budget_id: pickId, include_as_entry: asLineItem });
      setAdding(false);
      setPickId("");
      onChanged();
      push("success", asLineItem
        ? "Referenced — '[Budget]' line items in this sheet now track that budget's spend and its allocations on every sync."
        : "Referenced — its live numbers show here.");
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", typeof detail === "string" ? detail : "Couldn't add the reference.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (refId: string, title: string, hasRow: boolean) => {
    const removeRow = hasRow
      ? window.confirm(`Also delete the "[Budget] ${title}" line items from this sheet? OK = delete the rows too, Cancel = keep them as a frozen snapshot.`)
      : false;
    if (!hasRow && !window.confirm(`Stop referencing "${title}"?`)) return;
    const res = await removeBudgetReference(budget.id, refId, removeRow);
    onChanged();
    push("info", res.row_removed ? "Reference and its line items removed." : "Reference removed.");
  };

  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Referenced budgets</p>
            <p className="text-xs text-muted-foreground">
              Pull other budgets' numbers into this one — as live figures here, and optionally
              as synced "[Budget]" line items in this sheet so your totals include them.
              What a sub-budget has spent and what it has allocated come across as
              separate rows, so allocated money stays allocated all the way up.
            </p>
          </div>
        </div>
        {candidates.length > 0 && (
          <button
            onClick={() => setAdding((v) => !v)}
            className={cn("shrink-0 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent", adding && "border-primary text-primary")}
          >
            Reference a budget
          </button>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Pick a budget…</option>
            {candidates.map((b) => (
              <option key={b.id} value={b.id}>{b.title}</option>
            ))}
          </select>
          {!budget.external_readonly && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={asLineItem}
                onChange={(e) => setAsLineItem(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Add as a synced line item in this sheet
            </label>
          )}
          <button
            onClick={() => void add()}
            disabled={!pickId || busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Linking…" : "Reference"}
          </button>
        </div>
      )}

      {budget.references.length > 0 && (
        <ul className="space-y-1.5">
          {budget.references.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs">
              <span className="font-medium">{r.ref_title}</span>
              <span className="text-muted-foreground">
                spent {money(r.total_spent, budget.currency)}
                {(r.total_allocated ?? 0) > 0 && (
                  <>
                    {" "}·{" "}
                    <span className="text-amber-600 dark:text-amber-400">
                      allocated {money(r.total_allocated, budget.currency)}
                    </span>
                  </>
                )}
                {r.allotment != null && <> of {money(r.allotment, budget.currency)} · remaining {money(r.remaining, budget.currency)}</>}
                {" "}· {r.entry_count} entries
              </span>
              {r.include_as_entry && (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground" title="'[Budget]' rows in this sheet track this budget's spend and its allocations">
                  synced line items
                </span>
              )}
              <button
                onClick={() => void remove(r.id, r.ref_title, r.include_as_entry)}
                className="ml-auto text-muted-foreground hover:text-destructive"
                title="Remove reference"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Odoo cross-check — advisory, read-only ────────────────────────────────

const ODOO_DATASETS = [
  { value: "invoices", label: "Invoices & bills" },
  { value: "sales", label: "Sales orders" },
  { value: "purchases", label: "Purchase orders" },
  { value: "customers", label: "Customers" },
  { value: "bank_balances", label: "Bank & cash balances" },
];

function OdooCompareSection({ budget }: { budget: BudgetDetail }) {
  const push = useToastStore((s) => s.push);
  const [open, setOpen] = useState(false);
  const [dataset, setDataset] = useState("invoices");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<OdooCompareResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await compareBudgetToOdoo(budget.id, { dataset, search: search.trim() }));
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", typeof detail === "string" ? detail : "Comparison failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Cross-check against Odoo</p>
            <p className="text-xs text-muted-foreground">
              Bounce this budget off live ERP data — invoices, sales, customers, bank balances.
              Advisory only: a personal ledger and ERP actuals track different things.
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn("shrink-0 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent", open && "border-primary text-primary")}
        >
          {open ? "Hide" : "Compare"}
        </button>
      </div>

      {open && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={dataset}
              onChange={(e) => { setDataset(e.target.value); setResult(null); }}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {ODOO_DATASETS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            {dataset !== "bank_balances" && (
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Odoo search (default: "${budget.title}")`}
                className="min-w-[200px] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            )}
            <button
              onClick={() => void run()}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Comparing…" : "Run comparison"}
            </button>
          </div>

          {result && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">This budget</p>
                <p className="text-lg font-semibold">{money(result.budget.total_spent, result.budget.currency)}</p>
                <p className="text-xs text-muted-foreground">
                  {result.budget.entry_count} entries
                  {result.budget.allotment != null && <> · remaining {money(result.budget.remaining, result.budget.currency)}</>}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  Odoo — {result.odoo.label}
                  {result.odoo.search && <> matching "{result.odoo.search}"</>}
                </p>
                <p className="text-lg font-semibold">
                  {result.odoo.total != null
                    ? money(result.odoo.total, result.odoo.currency || result.budget.currency)
                    : `${result.odoo.count} record(s)`}
                </p>
                <p className="text-xs text-muted-foreground">{result.odoo.count} record(s)</p>
              </div>
              {result.odoo.rows.length > 0 && (
                <div className="rounded-md border p-3 sm:col-span-2">
                  <p className="mb-1 text-xs text-muted-foreground">Odoo detail (first {result.odoo.rows.length})</p>
                  <ul className="space-y-0.5 text-xs">
                    {result.odoo.rows.map((r, i) => (
                      <li key={i} className="truncate">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground sm:col-span-2">{result.advisory}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
