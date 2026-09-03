/**
 * The Budget tab of a project space.
 *
 * The figures belong to the project, so everyone on it sees them. The sheet on
 * Drive still belongs to whoever linked it, so only they can attach, detach or
 * refresh — a stranger's refresh would fail against Drive's own permissions
 * anyway, and offering the button would only teach people it is broken.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Wallet, X } from "lucide-react";
import { useState } from "react";

import {
  listBudgets,
  listProjectBudgets,
  updateBudget,
  type ProjectBudget,
} from "@/api/budgets";

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

function BudgetCard({
  budget,
  projectId,
  canEdit,
}: {
  budget: ProjectBudget;
  projectId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const spent = budget.cached_summary?.total_spent ?? 0;
  const allotment = budget.allotment;
  const pct = allotment && allotment > 0 ? Math.min(spent / allotment, 1.5) : null;
  const over = pct !== null && pct > 1;

  const detach = useMutation({
    mutationFn: () => updateBudget(budget.id, { clear_project: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-budgets", projectId] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-slate-900 dark:text-slate-100">
            {budget.title}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {money(spent, budget.currency)} spent
            {allotment !== null ? ` of ${money(allotment, budget.currency)}` : ""}
          </p>
        </div>
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
              ? `${money(spent - (allotment ?? 0), budget.currency)} over`
              : `${money((allotment ?? 0) - spent, budget.currency)} left`}
          </p>
        </div>
      )}

      {!budget.is_mine && (
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          Linked by someone else. You can see the figures here.
        </p>
      )}
    </div>
  );
}

export function ProjectBudgetTab({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);

  const { data: budgets = [], isLoading } = useQuery({
    queryKey: ["project-budgets", projectId],
    queryFn: () => listProjectBudgets(projectId),
  });

  // Only budgets this person owns can be attached, so the picker is their own list.
  const { data: mine = [] } = useQuery({
    queryKey: ["budgets"],
    queryFn: listBudgets,
    enabled: picking,
  });

  const attach = useMutation({
    mutationFn: (budgetId: string) => updateBudget(budgetId, { project_id: projectId }),
    onSuccess: () => {
      setPicking(false);
      qc.invalidateQueries({ queryKey: ["project-budgets", projectId] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
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
        <div className="grid gap-3 sm:grid-cols-2">
          {budgets.map(b => (
            <BudgetCard key={b.id} budget={b} projectId={projectId} canEdit={canEdit} />
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
              Your budgets
            </h4>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
          {available.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              You have no budget to add. Make one on the Budget page first.
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
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
