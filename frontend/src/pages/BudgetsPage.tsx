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
  Pencil,
  PlusCircle,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  addBudgetEntry,
  createBudget,
  deleteBudgetEntry,
  getBudget,
  linkBudget,
  listBudgets,
  refreshBudget,
  unlinkBudget,
  updateBudget,
  updateBudgetEntry,
  type BudgetDetail,
  type BudgetEntry,
} from "@/api/budgets";
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
    queryFn: listBudgets,
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
      push("success", `Budget "${b.title}" created — its Google Sheet is in the Little Gerry Budgets folder.`);
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

      {/* Categories */}
      {budget.cached_categories.length > 0 && (
        <section className="flex flex-wrap gap-1.5">
          {budget.cached_categories.map((c) => {
            const spent = s.by_category?.[c.name] ?? 0;
            return (
              <span key={c.name} className="rounded-md border px-2 py-1 text-xs">
                {c.name}: {money(spent, budget.currency)}
                {c.cap != null && <span className="text-muted-foreground"> / {money(c.cap, budget.currency)}</span>}
              </span>
            );
          })}
        </section>
      )}

      {/* Ledger */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Ledger</h3>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
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
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No entries yet{readonly ? "." : " — add one below or straight into the Google Sheet."}
                  </td>
                </tr>
              )}
              {budget.cached_ledger.map((e) => (
                <tr key={`${e.row}-${e.description}`} className="border-b last:border-0">
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
