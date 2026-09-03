/**
 * BudgetsPage — "Manage Budgets": personal Drive-backed budgets.
 *
 * Two surfaces, one ledger: the Google Sheet on Drive is the system of
 * record. Edits here write through to the Sheet immediately; edits made
 * directly in Sheets appear here automatically (refresh on open + 30s poll
 * while visible + re-read before every write). Gerry's chat writes are
 * gated by the per-budget permission toggle. Not an official budget center.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ExternalLink,
  FolderOpen,
  Link2,
  Loader2,
  Mail,
  Pencil,
  PlusCircle,
  RefreshCw,
  ScanSearch,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  addBudgetEntry,
  addBudgetReference,
  compareBudgetToOdoo,
  createBudget,
  deleteBudgetEntry,
  getBudget,
  linkBudget,
  linkBudgetFolder,
  listBudgets,
  refreshBudget,
  removeBudgetReference,
  scanBudgetFolder,
  unlinkBudget,
  unlinkBudgetFolder,
  updateBudget,
  updateBudgetEntry,
  updateBudgetFolder,
  type BudgetDetail,
  type BudgetEntry,
  type BudgetFolder,
  type OdooCompareResult,
} from "@/api/budgets";
import { acceptSuggestion, dismissSuggestion, listSuggestions } from "@/api/assistant";
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";

function money(n: number | null | undefined, currency = "USD"): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

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
            const pct =
              s.allotment && s.total_spent !== undefined
                ? Math.min(100, Math.round(((s.total_spent ?? 0) / s.allotment) * 100))
                : null;
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
  const s = budget.cached_summary || {};
  const readonly = budget.external_readonly;

  const [entryDate, setEntryDate] = useState("");
  const [entryDesc, setEntryDesc] = useState("");
  const [entryCategory, setEntryCategory] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<BudgetEntry>>({});
  const [busyRow, setBusyRow] = useState<number | null>(null);

  // ── Ledger filters & isolation ────────────────────────────────
  const UNCAT = "(uncategorized)";
  const [activeCats, setActiveCats] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isolate, setIsolate] = useState(false);

  const entryCat = (e: BudgetEntry) => e.category.trim() || UNCAT;

  const filterCats = useMemo(() => {
    const defined = budget.cached_categories.map((c) => c.name);
    const inUse = new Set(budget.cached_ledger.map(entryCat));
    const extras = [...inUse].filter((c) => c !== UNCAT && !defined.includes(c)).sort();
    const cats = [...defined, ...extras];
    if (inUse.has(UNCAT)) cats.push(UNCAT);
    return cats;
  }, [budget.cached_categories, budget.cached_ledger]);

  // Row numbers shift when the sheet changes — drop selections that vanished.
  useEffect(() => {
    setSelectedRows((prev) => {
      const live = new Set(budget.cached_ledger.map((e) => e.row));
      const next = new Set([...prev].filter((r) => live.has(r)));
      return next.size === prev.size ? prev : next;
    });
  }, [budget.cached_ledger]);
  useEffect(() => {
    if (isolate && selectedRows.size === 0) setIsolate(false);
  }, [isolate, selectedRows]);

  const visibleEntries = useMemo(() => {
    if (isolate) return budget.cached_ledger.filter((e) => selectedRows.has(e.row));
    if (activeCats.size === 0) return budget.cached_ledger;
    return budget.cached_ledger.filter((e) => activeCats.has(entryCat(e)));
  }, [budget.cached_ledger, activeCats, selectedRows, isolate]);

  const filtering = isolate || activeCats.size > 0;
  const visibleSubtotal = useMemo(
    () => visibleEntries.reduce((sum, e) => sum + (e.amount ?? 0), 0),
    [visibleEntries],
  );

  const toggleCat = (name: string) =>
    setActiveCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const toggleRow = (row: number) =>
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });

  const err = (e: unknown, fallback: string) => {
    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    push("error", typeof detail === "string" ? detail : fallback);
    onChanged(); // conflict messages come with a refreshed truth — show it
  };

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

  const addMutation = useMutation({
    mutationFn: () =>
      addBudgetEntry(budget.id, {
        date: entryDate || undefined,
        description: entryDesc.trim(),
        category: entryCategory.trim(),
        amount: Number(entryAmount),
        note: entryNote.trim(),
      }),
    onSuccess: () => {
      setEntryDate(""); setEntryDesc(""); setEntryCategory(""); setEntryAmount(""); setEntryNote("");
      onChanged();
    },
    onError: (e) => err(e, "Couldn't add the entry."),
  });

  const saveEdit = async (entry: BudgetEntry) => {
    setBusyRow(entry.row);
    try {
      await updateBudgetEntry(budget.id, entry.row, {
        expected: { description: entry.description, amount: entry.amount },
        date: editDraft.date,
        description: editDraft.description,
        category: editDraft.category,
        amount: editDraft.amount === undefined ? undefined : Number(editDraft.amount),
        note: editDraft.note,
      });
      setEditingRow(null);
      setEditDraft({});
      onChanged();
    } catch (e) {
      err(e, "Couldn't update the entry.");
    } finally {
      setBusyRow(null);
    }
  };

  const removeEntry = async (entry: BudgetEntry) => {
    if (!window.confirm(`Delete "${entry.description}" (${money(entry.amount, budget.currency)}) from the ledger? This removes the row from the Google Sheet too.`)) return;
    setBusyRow(entry.row);
    try {
      await deleteBudgetEntry(budget.id, entry.row, {
        description: entry.description,
        amount: entry.amount,
      });
      onChanged();
    } catch (e) {
      err(e, "Couldn't delete the entry.");
    } finally {
      setBusyRow(null);
    }
  };

  const unlink = async () => {
    if (!window.confirm(`Remove "${budget.title}" from Little Gerry? The Google Sheet stays on your Drive untouched.`)) return;
    const res = await unlinkBudget(budget.id);
    qc.invalidateQueries({ queryKey: ["budgets"] });
    onUnlinked();
    push("info", `Budget unlinked. The sheet is still on Drive: ${res.sheet_kept_at}`);
  };

  const pct = s.allotment ? Math.min(100, Math.round(((s.total_spent ?? 0) / s.allotment) * 100)) : null;

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
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total spent</p>
          <p className="text-xl font-semibold">{money(s.total_spent ?? 0, budget.currency)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Allotment</p>
          <p className="text-xl font-semibold">{money(s.allotment ?? null, budget.currency)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Remaining</p>
          <p className={cn("text-xl font-semibold", (s.remaining ?? 0) < 0 && "text-red-500")}>
            {money(s.remaining ?? null, budget.currency)}
          </p>
          {pct !== null && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded bg-accent">
              <div
                className={cn("h-full", pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500")}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </section>

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

      {/* Linked folders + automations (Phase 6) */}
      {!readonly && <FoldersSection budget={budget} onChanged={onChanged} />}
      {!readonly && <PendingSuggestionsSection budget={budget} onChanged={onChanged} />}

      {/* Cross-budget references + Odoo cross-check */}
      <ReferencesSection budget={budget} onChanged={onChanged} />
      <OdooCompareSection budget={budget} />

      {/* Categories — tap to filter the ledger */}
      {filterCats.length > 0 && (
        <section className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {filterCats.map((name) => {
              const spent = name === UNCAT
                ? budget.cached_ledger.reduce((sum, e) => sum + (entryCat(e) === UNCAT ? e.amount ?? 0 : 0), 0)
                : s.by_category?.[name] ?? 0;
              const cap = budget.cached_categories.find((c) => c.name === name)?.cap;
              const active = activeCats.has(name);
              return (
                <button
                  key={name}
                  onClick={() => toggleCat(name)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "hover:bg-accent",
                  )}
                  title={active ? "Remove this category from the filter" : "Show only this category"}
                >
                  {name}: {money(spent, budget.currency)}
                  {cap != null && <span className="text-muted-foreground"> / {money(cap, budget.currency)}</span>}
                </button>
              );
            })}
            {activeCats.size > 0 && (
              <button
                onClick={() => setActiveCats(new Set())}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Clear filter
              </button>
            )}
          </div>
        </section>
      )}

      {/* Ledger */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Ledger</h3>
          {selectedRows.size > 0 && (
            <>
              <button
                onClick={() => setIsolate((v) => !v)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  isolate
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "hover:bg-accent",
                )}
                title={isolate ? "Show the full ledger again" : "Show only the checked entries"}
              >
                {isolate ? "Show all" : `Isolate selected (${selectedRows.size})`}
              </button>
              <button
                onClick={() => { setSelectedRows(new Set()); setIsolate(false); }}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Clear selection
              </button>
            </>
          )}
          {filtering && (
            <span className="ml-auto rounded-md bg-accent px-2 py-1 text-xs">
              Showing {visibleEntries.length} of {budget.cached_ledger.length} · subtotal{" "}
              <span className="font-semibold">{money(visibleSubtotal, budget.currency)}</span>
            </span>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-8 px-3 py-2" title="Check entries to isolate them" />
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {budget.cached_ledger.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No entries yet{readonly ? "." : " — add one below or straight into the Google Sheet."}
                  </td>
                </tr>
              )}
              {budget.cached_ledger.length > 0 && visibleEntries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Nothing matches the current filter.
                  </td>
                </tr>
              )}
              {visibleEntries.map((e) => (
                <tr key={`${e.row}-${e.description}`} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(e.row)}
                      onChange={() => toggleRow(e.row)}
                      className="h-3.5 w-3.5 accent-primary"
                      title="Select for isolation"
                    />
                  </td>
                  {editingRow === e.row ? (
                    <>
                      <td className="px-2 py-1">
                        <input
                          value={editDraft.date ?? e.date}
                          onChange={(ev) => setEditDraft((d) => ({ ...d, date: ev.target.value }))}
                          className="w-24 rounded border bg-background px-1.5 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={editDraft.description ?? e.description}
                          onChange={(ev) => setEditDraft((d) => ({ ...d, description: ev.target.value }))}
                          className="w-full rounded border bg-background px-1.5 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={editDraft.category ?? e.category}
                          onChange={(ev) => setEditDraft((d) => ({ ...d, category: ev.target.value }))}
                          className="w-28 rounded border bg-background px-1.5 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          value={String(editDraft.amount ?? e.amount ?? "")}
                          onChange={(ev) => setEditDraft((d) => ({ ...d, amount: Number(ev.target.value) }))}
                          className="w-24 rounded border bg-background px-1.5 py-1 text-right text-xs"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={editDraft.note ?? e.note}
                          onChange={(ev) => setEditDraft((d) => ({ ...d, note: ev.target.value }))}
                          className="w-full rounded border bg-background px-1.5 py-1 text-xs"
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right">
                        <button
                          onClick={() => void saveEdit(e)}
                          disabled={busyRow === e.row}
                          className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                        >
                          {busyRow === e.row ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                        </button>
                        <button
                          onClick={() => { setEditingRow(null); setEditDraft({}); }}
                          className="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{e.date}</td>
                      <td className="px-3 py-2">{e.description}</td>
                      <td className="px-3 py-2 text-xs">{e.category}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        {money(e.amount, budget.currency)}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-xs text-muted-foreground">{e.note}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {!readonly && (
                          <>
                            <button
                              onClick={() => { setEditingRow(e.row); setEditDraft({}); }}
                              className="mr-1 text-muted-foreground hover:text-foreground"
                              title="Edit entry"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => void removeEntry(e)}
                              disabled={busyRow === e.row}
                              className="text-muted-foreground hover:text-destructive"
                              title="Delete entry (removes the row in Sheets too)"
                            >
                              {busyRow === e.row ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add entry */}
        {!readonly && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <input
              value={entryDesc}
              onChange={(e) => setEntryDesc(e.target.value)}
              placeholder="Description"
              className="min-w-[160px] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <input
              value={entryCategory}
              onChange={(e) => setEntryCategory(e.target.value)}
              placeholder="Category"
              list={`categories-${budget.id}`}
              className="w-40 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <datalist id={`categories-${budget.id}`}>
              {budget.cached_categories.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
            <input
              type="number"
              value={entryAmount}
              onChange={(e) => setEntryAmount(e.target.value)}
              placeholder="Amount"
              className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <input
              value={entryNote}
              onChange={(e) => setEntryNote(e.target.value)}
              placeholder="Note (optional)"
              className="min-w-[120px] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => addMutation.mutate()}
              disabled={!entryDesc.trim() || !entryAmount.trim() || addMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {addMutation.isPending ? "Adding…" : "Add entry"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Linked folders + automation (Phase 6 — read-only to Gerry) ────────────

function FoldersSection({ budget, onChanged }: { budget: BudgetDetail; onChanged: () => void }) {
  const push = useToastStore((s) => s.push);
  const [linkingKind, setLinkingKind] = useState<"invoice" | "receipt" | null>(null);
  const [ref, setRef] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const scan = async (folderRowId: string, name: string) => {
    setBusyId(folderRowId);
    try {
      const r = await scanBudgetFolder(budget.id, folderRowId);
      const bits = [`${r.scanned} file(s) read`];
      if (r.suggested) bits.push(`${r.suggested} entry suggestion(s) below`);
      if (r.no_amount) bits.push(`${r.no_amount} with no readable amount`);
      if (r.errors) bits.push(`${r.errors} failed`);
      if (r.remaining) bits.push(`${r.remaining} more on the next scan`);
      push(r.suggested ? "success" : "info", `Scanned "${name}": ${bits.join(", ")}.`);
      onChanged();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", typeof detail === "string" ? detail : "Scan failed.");
    } finally {
      setBusyId(null);
    }
  };

  const link = async () => {
    if (!linkingKind || !ref.trim()) return;
    setBusyId("link");
    try {
      const folder = await linkBudgetFolder(budget.id, { kind: linkingKind, ref: ref.trim() });
      setRef("");
      setLinkingKind(null);
      onChanged();
      if (window.confirm(`"${folder.folder_name}" linked. Want Gerry to scan it for ${linkingKind}s now? (Read-only — your files are never modified.)`)) {
        await scan(folder.id, folder.folder_name);
      }
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", typeof detail === "string" ? detail : "Couldn't link the folder.");
    } finally {
      setBusyId(null);
    }
  };

  const unlink = async (f: BudgetFolder) => {
    if (!window.confirm(`Unlink "${f.folder_name}"? The Drive folder and its files stay untouched.`)) return;
    await unlinkBudgetFolder(budget.id, f.id);
    onChanged();
  };

  const gmailMutation = useMutation({
    mutationFn: (enabled: boolean) => updateBudget(budget.id, { gmail_check_enabled: enabled }),
    onSuccess: (b) => {
      onChanged();
      push("info", b.gmail_check_enabled
        ? "Gerry will check Gmail daily for invoice-like attachments and suggest them here — nothing is filed or logged without your accept."
        : "Daily Gmail invoice checks are off for this budget.");
    },
  });

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Linked folders & automation</p>
            <p className="text-xs text-muted-foreground">
              Point Gerry at Drive folders of invoices or receipts. She reads them (never
              modifies or moves anything), extracts vendor/date/amount, and proposes ledger
              entries you accept or dismiss.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => { setLinkingKind(linkingKind === "invoice" ? null : "invoice"); setRef(""); }}
            className={cn("rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent", linkingKind === "invoice" && "border-primary text-primary")}
          >
            Link invoice folder
          </button>
          <button
            onClick={() => { setLinkingKind(linkingKind === "receipt" ? null : "receipt"); setRef(""); }}
            className={cn("rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent", linkingKind === "receipt" && "border-primary text-primary")}
          >
            Link receipts folder
          </button>
        </div>
      </div>

      {linkingKind && (
        <div className="flex gap-2">
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={`Paste the ${linkingKind} folder's Drive link`}
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            autoFocus
          />
          <button
            onClick={() => void link()}
            disabled={!ref.trim() || busyId === "link"}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busyId === "link" ? "Linking…" : "Link"}
          </button>
        </div>
      )}

      {budget.folders.length > 0 && (
        <ul className="space-y-2">
          {budget.folders.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs">
              <span className="rounded bg-accent px-1.5 py-0.5 uppercase text-[10px] tracking-wide text-muted-foreground">{f.kind}</span>
              <a href={f.folder_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                {f.folder_name}
              </a>
              <span className="text-muted-foreground">
                {f.files_scanned} file(s) read · extracted {money(f.extracted_total, budget.currency)}
                {f.last_scan_at && ` · last scan ${new Date(f.last_scan_at).toLocaleString()}`}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground" title="Scan this folder automatically once a day">
                  <input
                    type="checkbox"
                    checked={f.auto_scan}
                    onChange={async (e) => { await updateBudgetFolder(budget.id, f.id, { auto_scan: e.target.checked }); onChanged(); }}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Daily scan
                </label>
                <button
                  onClick={() => void scan(f.id, f.folder_name)}
                  disabled={busyId === f.id}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-accent disabled:opacity-60"
                >
                  {busyId === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
                  Scan now
                </button>
                <button onClick={() => void unlink(f)} className="text-muted-foreground hover:text-destructive" title="Unlink (folder and files stay untouched)">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Check Gmail for invoices daily</p>
            <p className="text-xs text-muted-foreground">
              New invoice-like attachments become suggestions here — accepting files them into
              the linked invoice folder and logs the entry. Never automatic.
            </p>
          </div>
        </div>
        <button
          onClick={() => gmailMutation.mutate(!budget.gmail_check_enabled)}
          disabled={gmailMutation.isPending}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            budget.gmail_check_enabled ? "bg-primary" : "bg-muted-foreground/30",
          )}
          title={budget.gmail_check_enabled ? "Turn off daily Gmail checks" : "Turn on daily Gmail checks"}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
              budget.gmail_check_enabled ? "left-[22px]" : "left-0.5",
            )}
          />
        </button>
      </div>
    </section>
  );
}

// ── Pending suggestions — bulk review for scanned/emailed documents ───────

function PendingSuggestionsSection({ budget, onChanged }: { budget: BudgetDetail; onChanged: () => void }) {
  const push = useToastStore((s) => s.push);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const suggestions = useQuery({
    queryKey: ["budget-suggestions", budget.id],
    queryFn: () => listSuggestions({ status: "pending" }),
    refetchInterval: 30_000,
    select: (rows) =>
      rows.filter(
        (r) =>
          (r.kind === "budget_entry" || r.kind === "gmail_invoice") &&
          (r.payload as { budget_id?: string })?.budget_id === budget.id,
      ),
  });
  const pending = suggestions.data ?? [];
  if (pending.length === 0) return null;

  const resolve = async (id: string, action: "accept" | "dismiss") => {
    try {
      if (action === "accept") await acceptSuggestion(id);
      else await dismissSuggestion(id);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", typeof detail === "string" ? detail : `Couldn't ${action} the suggestion.`);
    }
    qc.invalidateQueries({ queryKey: ["budget-suggestions", budget.id] });
    onChanged();
  };

  const acceptAll = async () => {
    if (!window.confirm(`Accept all ${pending.length} suggested entries? Each one is written to the sheet.`)) return;
    setBusy(true);
    for (const s of pending) {
      // Sequential on purpose: each write re-reads the sheet first.
      // eslint-disable-next-line no-await-in-loop
      await resolve(s.id, "accept");
    }
    setBusy(false);
  };

  return (
    <section className="space-y-2 rounded-xl border border-primary/40 bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Gerry found {pending.length} document{pending.length === 1 ? "" : "s"} to review
        </p>
        {pending.length > 1 && (
          <button
            onClick={() => void acceptAll()}
            disabled={busy}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Accepting…" : "Accept all"}
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {pending.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.title}</p>
              {s.summary && <p className="truncate text-muted-foreground">{s.summary}</p>}
            </div>
            {s.source_url && (
              <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" title="Open the source document">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button
              onClick={() => void resolve(s.id, "accept")}
              disabled={busy}
              className="rounded-md border border-primary px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-60"
            >
              Accept
            </button>
            <button
              onClick={() => void resolve(s.id, "dismiss")}
              disabled={busy}
              className="rounded-md border px-2 py-1 text-muted-foreground hover:bg-accent disabled:opacity-60"
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </section>
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
        ? "Referenced — a '[Budget]' line item in this sheet now tracks that budget's total on every sync."
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
      ? window.confirm(`Also delete the "[Budget] ${title}" line item from this sheet? OK = delete the row too, Cancel = keep the row as a frozen snapshot.`)
      : false;
    if (!hasRow && !window.confirm(`Stop referencing "${title}"?`)) return;
    const res = await removeBudgetReference(budget.id, refId, removeRow);
    onChanged();
    push("info", res.row_removed ? "Reference and its line item removed." : "Reference removed.");
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
              as a synced "[Budget]" line item in this sheet so your totals include them.
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
                {r.allotment != null && <> of {money(r.allotment, budget.currency)} · remaining {money(r.remaining, budget.currency)}</>}
                {" "}· {r.entry_count} entries
              </span>
              {r.include_as_entry && (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground" title="A '[Budget]' row in this sheet tracks this total">
                  synced line item
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
