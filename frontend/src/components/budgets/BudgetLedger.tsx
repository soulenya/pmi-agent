/**
 * The budget ledger, shared by the Budgets page and a project's Budget tab.
 *
 * Both surfaces show the same thing because it is the same thing: one Google
 * Sheet, read into the same mirror. What differs is only who may write to it.
 * A project member sees every figure and every row; the person who linked the
 * sheet is the one who can change it, because the write goes to Drive under
 * their credentials and nobody else's would be accepted.
 *
 * A row's status says whether the money has actually moved. Keeping promised
 * money apart from spent money is the whole point — a budget that adds them
 * together cannot tell you what is left to promise.
 */
import { Loader2, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  addBudgetEntry,
  deleteBudgetEntry,
  updateBudgetEntry,
  ENTRY_STATUSES,
  isOutgoing,
  type BudgetCategory,
  type BudgetEntry,
  type BudgetSummary,
  type EntryStatus,
} from "@/api/budgets";
import type { Source } from "@/api/tasks";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

export function money(n: number | null | undefined, currency = "USD"): string {
  if (n === null || n === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** The parts of a budget the ledger needs, whichever endpoint served it. */
export interface LedgerBudget {
  id: string;
  currency: string;
  cached_summary: BudgetSummary;
  cached_ledger: BudgetEntry[];
  cached_categories: BudgetCategory[];
}

export const UNCATEGORIZED = "(uncategorized)";

export function entryStatus(e: BudgetEntry): EntryStatus {
  return e.status ?? "Spent";
}

const STATUS_STYLES: Record<EntryStatus, string> = {
  Spent: "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300",
  Allocated: "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  Collected: "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  Expected: "border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
};

const STATUS_HELP: Record<EntryStatus, string> = {
  Spent: "Money out, already gone.",
  Allocated: "Money out, set aside for a cost that is committed but not yet paid.",
  Collected: "Money in, already received.",
  Expected: "Money in, invoiced or forecast but not yet collected.",
};

export function StatusPill({ status }: { status: EntryStatus }) {
  return (
    <span
      className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", STATUS_STYLES[status])}
      title={STATUS_HELP[status]}
    >
      {status}
    </span>
  );
}

/**
 * The figures.
 *
 * Spent and Allocated both come off the allotment, so Remaining is what is
 * still free to promise rather than merely what has not yet been paid. The
 * incoming pair only appears once there is something to show, so a plain
 * spending budget stays a plain spending budget.
 */
export function BudgetSummaryCards({ budget }: { budget: LedgerBudget }) {
  const s = budget.cached_summary || {};
  const cur = budget.currency;
  const spent = s.total_spent ?? 0;
  const allocated = s.total_allocated ?? 0;
  const collected = s.total_collected ?? 0;
  const expected = s.total_expected ?? 0;
  const allotment = s.allotment ?? null;
  const pct = allotment ? Math.min(100, Math.round(((spent + allocated) / allotment) * 100)) : null;
  const overspent = (s.remaining ?? 0) < 0;

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Spent</p>
          <p className="text-xl font-semibold">{money(spent, cur)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Money already gone</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Allocated</p>
          <p className={cn("text-xl font-semibold", allocated > 0 && "text-amber-600 dark:text-amber-400")}>
            {money(allocated, cur)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Committed, not yet paid</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Allotment</p>
          <p className="text-xl font-semibold">{money(allotment, cur)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {allotment === null ? "Not set" : `${money(spent + allocated, cur)} committed`}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Remaining</p>
          <p className={cn("text-xl font-semibold", overspent && "text-red-500")}>
            {money(s.remaining ?? null, cur)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Still free to allocate</p>
          {pct !== null && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded bg-accent">
              <div
                className={cn(
                  "h-full",
                  pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {(collected > 0 || expected > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Collected</p>
            <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
              {money(collected, cur)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Money received</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Expected</p>
            <p className="text-lg font-semibold text-sky-600 dark:text-sky-400">
              {money(expected, cur)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Invoiced or forecast, not yet in</p>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The ledger table, its filters, and the add-entry row.
 *
 * `canEdit` is false for anyone who is not the budget's owner and for linked
 * external sheets, which Little Gerry may only read. When it is false the
 * table is still fully visible: the figures belong to the project even though
 * the sheet belongs to a person.
 */
export function BudgetLedgerTable({
  budget,
  canEdit,
  source = "local",
  onChanged,
}: {
  budget: LedgerBudget;
  canEdit: boolean;
  source?: Source;
  onChanged: () => void;
}) {
  const push = useToastStore((s) => s.push);
  const s = budget.cached_summary || {};

  const [entryDate, setEntryDate] = useState("");
  const [entryDesc, setEntryDesc] = useState("");
  const [entryCategory, setEntryCategory] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [entryStatusDraft, setEntryStatusDraft] = useState<EntryStatus>("Spent");
  const [adding, setAdding] = useState(false);

  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<BudgetEntry>>({});
  const [busyRow, setBusyRow] = useState<number | null>(null);

  const [activeCats, setActiveCats] = useState<Set<string>>(new Set());
  const [activeStatuses, setActiveStatuses] = useState<Set<EntryStatus>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isolate, setIsolate] = useState(false);

  const entryCat = (e: BudgetEntry) => e.category.trim() || UNCATEGORIZED;

  const filterCats = useMemo(() => {
    const defined = budget.cached_categories.map((c) => c.name);
    const inUse = new Set(budget.cached_ledger.map(entryCat));
    const extras = [...inUse].filter((c) => c !== UNCATEGORIZED && !defined.includes(c)).sort();
    const cats = [...defined, ...extras];
    if (inUse.has(UNCATEGORIZED)) cats.push(UNCATEGORIZED);
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
    return budget.cached_ledger.filter(
      (e) =>
        (activeCats.size === 0 || activeCats.has(entryCat(e))) &&
        (activeStatuses.size === 0 || activeStatuses.has(entryStatus(e))),
    );
  }, [budget.cached_ledger, activeCats, activeStatuses, selectedRows, isolate]);

  const filtering = isolate || activeCats.size > 0 || activeStatuses.size > 0;
  // Money in and money out do not belong in the same total, so the subtotal
  // nets them: outgoing counts against, incoming counts for.
  const visibleSubtotal = useMemo(
    () =>
      visibleEntries.reduce(
        (sum, e) => sum + (isOutgoing(entryStatus(e)) ? e.amount ?? 0 : -(e.amount ?? 0)),
        0,
      ),
    [visibleEntries],
  );

  const toggleIn = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const err = (e: unknown, fallback: string) => {
    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    push("error", typeof detail === "string" ? detail : fallback);
    onChanged(); // conflict messages come with a refreshed truth — show it
  };

  const addEntry = async () => {
    setAdding(true);
    try {
      await addBudgetEntry(
        budget.id,
        {
          date: entryDate || undefined,
          description: entryDesc.trim(),
          category: entryCategory.trim(),
          amount: Number(entryAmount),
          note: entryNote.trim(),
          status: entryStatusDraft,
        },
        source,
      );
      setEntryDate("");
      setEntryDesc("");
      setEntryCategory("");
      setEntryAmount("");
      setEntryNote("");
      onChanged();
    } catch (e) {
      err(e, "Couldn't add the entry.");
    } finally {
      setAdding(false);
    }
  };

  const saveEdit = async (entry: BudgetEntry) => {
    setBusyRow(entry.row);
    try {
      await updateBudgetEntry(
        budget.id,
        entry.row,
        {
          expected: { description: entry.description, amount: entry.amount },
          date: editDraft.date,
          description: editDraft.description,
          category: editDraft.category,
          amount: editDraft.amount === undefined ? undefined : Number(editDraft.amount),
          note: editDraft.note,
          status: editDraft.status,
        },
        source,
      );
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
    if (
      !window.confirm(
        `Delete "${entry.description}" (${money(entry.amount, budget.currency)}) from the ledger? This removes the row from the Google Sheet too.`,
      )
    )
      return;
    setBusyRow(entry.row);
    try {
      await deleteBudgetEntry(
        budget.id,
        entry.row,
        { description: entry.description, amount: entry.amount },
        source,
      );
      onChanged();
    } catch (e) {
      err(e, "Couldn't delete the entry.");
    } finally {
      setBusyRow(null);
    }
  };

  const statusCounts = useMemo(() => {
    const counts = new Map<EntryStatus, number>();
    for (const e of budget.cached_ledger) {
      const st = entryStatus(e);
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    return counts;
  }, [budget.cached_ledger]);

  return (
    <div className="space-y-4">
      {/* Categories — tap to filter */}
      {filterCats.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filterCats.map((name) => {
            const committed =
              name === UNCATEGORIZED
                ? budget.cached_ledger.reduce(
                    (sum, e) =>
                      sum +
                      (entryCat(e) === UNCATEGORIZED && isOutgoing(entryStatus(e))
                        ? e.amount ?? 0
                        : 0),
                    0,
                  )
                : s.by_category?.[name] ?? 0;
            const cap = budget.cached_categories.find((c) => c.name === name)?.cap;
            const active = activeCats.has(name);
            return (
              <button
                key={name}
                onClick={() => setActiveCats((prev) => toggleIn(prev, name))}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  active ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent",
                )}
                title={
                  active
                    ? "Remove this category from the filter"
                    : "Show only this category. The figure counts spent and allocated together."
                }
              >
                {name}: {money(committed, budget.currency)}
                {cap != null && (
                  <span className="text-muted-foreground"> / {money(cap, budget.currency)}</span>
                )}
              </button>
            );
          })}
          {activeCats.size > 0 && (
            <button
              onClick={() => setActiveCats(new Set())}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear categories
            </button>
          )}
        </div>
      )}

      {/* Status — tap to filter */}
      {budget.cached_ledger.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {ENTRY_STATUSES.filter((st) => (statusCounts.get(st) ?? 0) > 0).map((st) => {
            const active = activeStatuses.has(st);
            return (
              <button
                key={st}
                onClick={() => setActiveStatuses((prev) => toggleIn(prev, st))}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  active ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent",
                )}
                title={STATUS_HELP[st]}
              >
                {st} ({statusCounts.get(st)})
              </button>
            );
          })}
          {activeStatuses.size > 0 && (
            <button
              onClick={() => setActiveStatuses(new Set())}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear statuses
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Ledger</h3>
        {selectedRows.size > 0 && (
          <>
            <button
              onClick={() => setIsolate((v) => !v)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                isolate ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent",
              )}
              title={isolate ? "Show the full ledger again" : "Show only the checked entries"}
            >
              {isolate ? "Show all" : `Isolate selected (${selectedRows.size})`}
            </button>
            <button
              onClick={() => {
                setSelectedRows(new Set());
                setIsolate(false);
              }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear selection
            </button>
          </>
        )}
        {filtering && (
          <span className="ml-auto rounded-md bg-accent px-2 py-1 text-xs">
            Showing {visibleEntries.length} of {budget.cached_ledger.length} · net{" "}
            <span className="font-semibold">{money(visibleSubtotal, budget.currency)}</span> out
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
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {budget.cached_ledger.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No entries yet
                  {canEdit ? " — add one below or straight into the Google Sheet." : "."}
                </td>
              </tr>
            )}
            {budget.cached_ledger.length > 0 && visibleEntries.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
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
                    onChange={() => setSelectedRows((prev) => toggleIn(prev, e.row))}
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
                        onChange={(ev) =>
                          setEditDraft((d) => ({ ...d, description: ev.target.value }))
                        }
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
                        onChange={(ev) =>
                          setEditDraft((d) => ({ ...d, amount: Number(ev.target.value) }))
                        }
                        className="w-24 rounded border bg-background px-1.5 py-1 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={editDraft.status ?? entryStatus(e)}
                        onChange={(ev) =>
                          setEditDraft((d) => ({ ...d, status: ev.target.value as EntryStatus }))
                        }
                        className="w-28 rounded border bg-background px-1.5 py-1 text-xs"
                        title="Has this money actually moved?"
                      >
                        {ENTRY_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
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
                        onClick={() => {
                          setEditingRow(null);
                          setEditDraft({});
                        }}
                        className="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {e.date}
                    </td>
                    <td className="px-3 py-2">{e.description}</td>
                    <td className="px-3 py-2 text-xs">{e.category}</td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-2 text-right font-medium",
                        !isOutgoing(entryStatus(e)) && "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {isOutgoing(entryStatus(e)) ? "" : "+"}
                      {money(e.amount, budget.currency)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <StatusPill status={entryStatus(e)} />
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-xs text-muted-foreground">
                      {e.note}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {canEdit && (
                        <>
                          <button
                            onClick={() => {
                              setEditingRow(e.row);
                              setEditDraft({});
                            }}
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
                            {busyRow === e.row ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
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

      {canEdit && (
        <div className="space-y-1.5">
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
            <select
              value={entryStatusDraft}
              onChange={(e) => setEntryStatusDraft(e.target.value as EntryStatus)}
              className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
              title={STATUS_HELP[entryStatusDraft]}
            >
              {ENTRY_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <input
              value={entryNote}
              onChange={(e) => setEntryNote(e.target.value)}
              placeholder="Note (optional)"
              className="min-w-[120px] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => void addEntry()}
              disabled={!entryDesc.trim() || !entryAmount.trim() || adding}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add entry"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{STATUS_HELP[entryStatusDraft]}</p>
        </div>
      )}
    </div>
  );
}
