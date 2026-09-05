/**
 * The Budget tab of a project space.
 *
 * The figures belong to the project, so everyone on it sees them — including
 * the whole ledger, in the same shape as the Budgets page, because it is the
 * same ledger. The sheet on Drive still belongs to whoever linked it, so only
 * they can create, attach, detach, refresh or edit rows — a stranger's write
 * would fail against Drive's own permissions anyway, and offering the button
 * would only teach people it is broken.
 *
 * A project budget is not just a record of what has been spent. Allocated
 * lines reserve money for costs that are committed but not yet paid, and
 * Expected lines track money invoiced but not yet collected, so the tab can
 * answer the question that actually matters partway through a project: how
 * much is still free to promise.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, Plus, Wallet, X } from "lucide-react";
import { useState } from "react";

import {
  createBudget,
  getProjectBudget,
  linkBudget,
  listBudgets,
  listProjectBudgets,
  mirrorBudget,
  refreshBudget,
  updateBudget,
  type ProjectBudget,
} from "@/api/budgets";
import type { Source } from "@/api/tasks";
import { BudgetLedgerTable, BudgetSummaryCards } from "@/components/budgets/BudgetLedger";

/** Pulls the file id out of a pasted Drive link, or accepts a bare id. */
function driveFileId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const inUrl = text.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (inUrl) return inUrl[1];
  const inQuery = text.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (inQuery) return inQuery[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : null;
}

function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

/**
 * The expanded ledger for one attached budget.
 *
 * Read through the project's own route, so a colleague who has never seen the
 * Google Sheet still gets every row. It serves the cached copy: pulling fresh
 * from Drive needs the owner's credentials, and they can do that from the
 * Budgets page.
 */
function BudgetLedgerPanel({
  budget,
  projectId,
  source,
}: {
  budget: ProjectBudget;
  projectId: string;
  source: Source;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["project-budget", source, projectId, budget.id],
    queryFn: () => getProjectBudget(projectId, budget.id, source),
  });

  const onChanged = () => {
    qc.invalidateQueries({ queryKey: ["project-budget", source, projectId, budget.id] });
    qc.invalidateQueries({ queryKey: ["project-budgets", source, projectId] });
  };

  // A shared budget's sheet is read through this computer's Google account and
  // the figures are sent up, because the hub has no Google account of its own.
  const sync = useMutation({
    mutationFn: async () => {
      const fileId = driveFileId(budget.drive_url);
      if (!fileId) throw new Error("This budget has no Drive link.");
      const here = (await listBudgets("local")).find((b) => b.drive_file_id === fileId);
      if (!here) throw new Error("local-missing");
      return mirrorBudget(await refreshBudget(here.id, "local"), "hub");
    },
    onSuccess: onChanged,
  });

  if (isLoading) {
    return <p className="px-4 pb-4 text-sm text-slate-500">Loading the ledger…</p>;
  }
  if (isError || !data) {
    return <p className="px-4 pb-4 text-sm text-rose-600">The ledger could not be loaded.</p>;
  }

  // Writes go to Drive under the owner's Google account, so only they can make
  // them. A linked external sheet is read-only to everyone, its owner included.
  // On a shared project nobody edits here: the sheet is reachable only from the
  // computer that owns it, so the rows are edited on the Budgets page.
  const canEditLedger = data.is_mine && !data.external_readonly && source !== "hub";

  return (
    <div className="space-y-4 border-t border-slate-200 p-4 dark:border-slate-700">
      <BudgetSummaryCards budget={data} />

      {data.references.length > 0 && (
        <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Sub-budgets</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Budgets feeding into this one. Their spend and their allocations roll up as
            separate lines, so allocated money stays allocated all the way up the tree.
          </p>
          <ul className="mt-2 space-y-1">
            {data.references.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
              >
                <span className="font-medium text-slate-800 dark:text-slate-200">{r.ref_title}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  spent {money(r.total_spent, data.currency)}
                  {(r.total_allocated ?? 0) > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {" "}· allocated {money(r.total_allocated, data.currency)}
                    </span>
                  )}
                  {r.allotment != null && <> · of {money(r.allotment, data.currency)}</>}
                </span>
                {r.include_as_entry && (
                  <span
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    title="'[Budget]' rows in this sheet track that budget's spend and its allocations"
                  >
                    rolled up
                  </span>
                )}
              </li>
            ))}
          </ul>
          {canEditLedger && (
            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
              Add or remove sub-budgets from the Budgets page.
            </p>
          )}
        </section>
      )}

      {!canEditLedger && (
        <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
          <p>
            {!data.is_mine
              ? "You can see every figure here. Only the person who linked the sheet can change it."
              : data.external_readonly
                ? "This is a linked external sheet — Little Gerry can only read it. Edit it in Google Sheets."
                : "These are the figures as last sent up. The sheet lives on your Google account, so edit it on the Budgets page or in Google Sheets, then update this copy."}
          </p>
          {data.is_mine && source === "hub" && (
            <>
              <button
                type="button"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {sync.isPending ? "Updating…" : "Update from Drive"}
              </button>
              {sync.isError && (
                <p className="text-rose-600">
                  {String((sync.error as Error)?.message) === "local-missing"
                    ? "This budget was added from another computer, so its sheet cannot be read from here. Whoever created it can update the figures."
                    : "The figures could not be updated from Drive."}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <BudgetLedgerTable
        budget={data}
        canEdit={canEditLedger}
        source={source}
        onChanged={onChanged}
      />
    </div>
  );
}

function BudgetCard({
  budget,
  projectId,
  canEdit,
  source,
}: {
  budget: ProjectBudget;
  projectId: string;
  canEdit: boolean;
  source: Source;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const summary = budget.cached_summary ?? {};
  const spent = summary.total_spent ?? 0;
  const allocated = summary.total_allocated ?? 0;
  // The bar tracks committed money, not just money gone: an allocation you
  // have promised is no more available to spend than a payment already made.
  const committed = spent + allocated;
  const allotment = budget.allotment;
  const pct = allotment && allotment > 0 ? Math.min(committed / allotment, 1.5) : null;
  const over = pct !== null && pct > 1;

  const detach = useMutation({
    mutationFn: () => updateBudget(budget.id, { clear_project: true }, source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-budgets", source, projectId] });
      qc.invalidateQueries({ queryKey: ["budgets", source] });
    },
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
            title={open ? "Hide the ledger" : "Show the ledger"}
          >
            {open ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            )}
            <div className="min-w-0">
              <h3 className="truncate font-medium text-slate-900 dark:text-slate-100">
                {budget.title}
              </h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {money(spent, budget.currency)} spent
                {allotment !== null ? ` of ${money(allotment, budget.currency)}` : ""}
              </p>
              {allocated > 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {money(allocated, budget.currency)} allocated, not yet paid
                </p>
              )}
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={budget.drive_url}
              target="_blank"
              rel="noreferrer"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              title="Open the sheet in Drive"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            {canEdit && budget.is_mine && (
              <button
                type="button"
                onClick={() => detach.mutate()}
                disabled={detach.isPending}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800"
                title="Take this budget off the project"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {pct !== null && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(pct, 1) * 100}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {over
                ? `${money(committed - (allotment ?? 0), budget.currency)} over`
                : `${money((allotment ?? 0) - committed, budget.currency)} free to allocate`}
            </p>
          </div>
        )}

        {!budget.is_mine && (
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Linked by someone else. You can see the figures here.
          </p>
        )}
      </div>

      {open && <BudgetLedgerPanel budget={budget} projectId={projectId} source={source} />}
    </div>
  );
}

/**
 * Make a new budget on the project.
 *
 * Little Gerry builds the sheet, so it arrives with its Ledger, Categories and
 * Settings tabs already in place and can be written to. A sheet linked from
 * Drive instead is read-only, which is no use to anyone who wants to allocate
 * money — hence this being the first thing on offer.
 */
function CreateBudgetForm({
  projectId,
  source,
  onCreated,
}: {
  projectId: string;
  source: Source;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [allotment, setAllotment] = useState("");
  const [categories, setCategories] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      // The sheet is always made here, on the owner's Google account. The hub
      // has none, so a shared project gets a copy of the finished budget.
      const made = await createBudget(
        {
          title: title.trim(),
          allotment: allotment.trim() ? Number(allotment) : null,
          categories: categories
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        },
        "local",
      );
      const there = source === "hub" ? await mirrorBudget(made, "hub") : made;
      return updateBudget(there.id, { project_id: projectId }, source);
    },
    onSuccess: onCreated,
  });

  return (
    <div>
      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
        Create a budget for this project
      </label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Budget name"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          type="number"
          value={allotment}
          onChange={(e) => setAllotment(e.target.value)}
          placeholder="Allotment"
          className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
          placeholder="Categories, comma separated"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <button
          type="button"
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate()}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
        A Google Sheet on your Drive, editable from either side. Everyone on the project
        sees the figures; only you can change them.
      </p>
      {create.isError && (
        <p className="mt-1.5 text-sm text-rose-600">
          The budget could not be created. Check that Google is connected in Settings.
        </p>
      )}
    </div>
  );
}

export function ProjectBudgetTab({
  projectId,
  canEdit,
  source = "local",
}: {
  projectId: string;
  canEdit: boolean;
  source?: Source;
}) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [driveLink, setDriveLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const { data: budgets = [], isLoading } = useQuery({
    queryKey: ["project-budgets", source, projectId],
    queryFn: () => listProjectBudgets(projectId, source),
  });

  // Only budgets this person owns can be attached, so the picker is their own list.
  const { data: mine = [] } = useQuery({
    queryKey: ["budgets", source],
    queryFn: () => listBudgets(source),
    enabled: picking,
  });

  const done = () => {
    setPicking(false);
    setDriveLink("");
    setLinkError(null);
    qc.invalidateQueries({ queryKey: ["project-budgets", source, projectId] });
    qc.invalidateQueries({ queryKey: ["budgets", source] });
  };

  const attach = useMutation({
    mutationFn: (budgetId: string) =>
      updateBudget(budgetId, { project_id: projectId }, source),
    onSuccess: done,
  });

  // Reading the sheet needs Google, which only this computer has, so the link
  // is made here and the figures are copied to where the project lives.
  const linkAndAttach = useMutation({
    mutationFn: async (fileId: string) => {
      const created = await linkBudget(fileId, "local");
      const there = source === "hub" ? await mirrorBudget(created, "hub") : created;
      return updateBudget(there.id, { project_id: projectId }, source);
    },
    onSuccess: done,
  });

  const available = mine.filter(b => b.project_id !== projectId);

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading budgets…</p>;
  }

  return (
    <div className="space-y-4">
      {budgets.length === 0 && !picking && (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <Wallet className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            No budget on this project yet.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
            >
              <Plus className="h-4 w-4" /> Add a budget
            </button>
          )}
        </div>
      )}

      {budgets.length > 0 && (
        <div className="space-y-3">
          {budgets.map(b => (
            <BudgetCard
              key={b.id}
              budget={b}
              projectId={projectId}
              canEdit={canEdit}
              source={source}
            />
          ))}
        </div>
      )}

      {canEdit && budgets.length > 0 && !picking && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <Plus className="h-4 w-4" /> Add another
        </button>
      )}

      {picking && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Add a budget
            </h4>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Cancel
            </button>
          </div>

          <div className="mt-3">
            <CreateBudgetForm projectId={projectId} source={source} onCreated={done} />
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Or use a budget you already have
            </label>
            {available.length === 0 ? (
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                {source === "hub"
                  ? "You have no other budget here yet."
                  : "You have no other budget to add."}
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {available.map(b => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => attach.mutate(b.id)}
                      disabled={attach.isPending}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                    >
                      <span className="truncate text-slate-800 dark:text-slate-200">{b.title}</span>
                      <span className="ml-3 shrink-0 text-xs text-slate-500">
                        {money(b.allotment, b.currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Or link a Google Sheet
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                value={driveLink}
                onChange={e => {
                  setDriveLink(e.target.value);
                  setLinkError(null);
                }}
                placeholder="Paste the Drive link"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
              <button
                type="button"
                disabled={linkAndAttach.isPending}
                onClick={() => {
                  const fileId = driveFileId(driveLink);
                  if (!fileId) {
                    setLinkError("That does not look like a Drive link.");
                    return;
                  }
                  linkAndAttach.mutate(fileId);
                }}
                className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                {linkAndAttach.isPending ? "Linking…" : "Link"}
              </button>
            </div>
            {linkError && <p className="mt-1.5 text-sm text-rose-600">{linkError}</p>}
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              A sheet Little Gerry did not make is read-only — the figures show here, but
              you cannot add or allocate lines from this page.
            </p>
            {linkAndAttach.isError && (
              <p className="mt-1.5 text-sm text-rose-600">
                That sheet could not be linked. Check that Google is connected and that
                you can open it.
              </p>
            )}
          </div>

          {attach.isError && (
            <p className="mt-2 text-sm text-rose-600">
              That budget could not be added to this project.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
