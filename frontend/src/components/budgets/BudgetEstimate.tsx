/**
 * The cost estimate: what a contract or R&D effort is expected to cost, built
 * before there is any money to track. It sits on its own tab of the budget's
 * Google Sheet, so a plan can never be mistaken for spend, and it is shown on
 * both budget surfaces the way the ledger is — everyone on the project reads
 * it, the person whose sheet it is edits it.
 *
 * Two ways to total it. Simple adds the lines up. Cost build-up prices them
 * the way a government cost volume does: labor, then fringe on labor, then
 * overhead on that, then the other direct costs, then G&A on everything, then
 * fee. The rates live on the sheet's Settings tab beside the allotment.
 *
 * Committing is the award: every line becomes an Allocated ledger row, and
 * the total can become the allotment. The estimate stays as the baseline.
 */
import { Calculator, CheckCircle2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  addEstimateLine,
  commitEstimate,
  deleteEstimateLine,
  ESTIMATE_KINDS,
  updateEstimateLine,
  updateEstimateRates,
  type EstimateKind,
  type EstimateLine,
  type EstimateMode,
  type EstimateSummary,
  type BudgetCategory,
  type BudgetSummary,
} from "@/api/budgets";
import type { Source } from "@/api/tasks";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

import { money } from "./BudgetLedger";
import { CategorySelect } from "./CategorySelect";

/** The parts of a budget the estimate needs, whichever endpoint served it. */
export interface EstimateBudget {
  id: string;
  currency: string;
  cached_summary: BudgetSummary;
  cached_estimate?: EstimateLine[];
  cached_categories: BudgetCategory[];
  cached_ledger: { note: string }[];
}

const NO_PHASE = "(no phase)";

const KIND_STYLES: Record<EstimateKind, string> = {
  Labor: "border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  Materials: "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300",
  Travel: "border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  Subcontract: "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  Other: "border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400",
};

function KindPill({ kind }: { kind: EstimateKind }) {
  return (
    <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", KIND_STYLES[kind] ?? KIND_STYLES.Other)}>
      {kind}
    </span>
  );
}

function num(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/[,$%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pct(n: number | undefined): string {
  return `${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

/** When the estimate was last written to the ledger, from the rows it left there. */
export function estimateCommittedOn(ledger: { note: string }[]): string | null {
  for (const e of ledger) {
    const at = (e.note || "").indexOf("estimate-commit:");
    if (at >= 0) return e.note.slice(at + 16, at + 26);
  }
  return null;
}

export function BudgetEstimate({
  budget,
  canEdit,
  source = "local",
  onChanged,
}: {
  budget: EstimateBudget;
  canEdit: boolean;
  source?: Source;
  onChanged: () => void;
}) {
  const push = useToastStore((s) => s.push);
  const lines = budget.cached_estimate ?? [];
  const est: EstimateSummary | undefined = budget.cached_summary?.estimate;
  const mode: EstimateMode = est?.mode ?? "Simple";
  const costMode = mode === "Cost build-up";
  const committedOn = estimateCommittedOn(budget.cached_ledger);

  const [open, setOpen] = useState(lines.length > 0);

  // ── add line ──
  const [phase, setPhase] = useState("");
  const [kind, setKind] = useState<EstimateKind>("Labor");
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  // ── edit / delete ──
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Record<keyof EstimateLine, string>>>({});
  const [busyRow, setBusyRow] = useState<number | null>(null);

  // ── rates ──
  const [ratesOpen, setRatesOpen] = useState(false);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [savingRates, setSavingRates] = useState(false);

  // ── commit ──
  const [committing, setCommitting] = useState(false);

  const phases = useMemo(() => {
    const seen: string[] = [];
    for (const l of lines) if (!seen.includes(l.phase)) seen.push(l.phase);
    return seen;
  }, [lines]);
  const knownPhases = phases.filter(Boolean);

  const err = (e: unknown, fallback: string) => {
    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    push("error", typeof detail === "string" ? detail : fallback);
    onChanged();
  };

  const previewAmount = (() => {
    const q = num(qty);
    const u = num(unit);
    if (q !== null && u !== null) return q * u;
    return num(amount);
  })();

  const add = async () => {
    if (!desc.trim()) return;
    if (previewAmount === null) {
      push("error", "Give an amount, or both a quantity and a unit cost.");
      return;
    }
    setAdding(true);
    try {
      await addEstimateLine(
        budget.id,
        {
          phase: phase.trim(),
          kind,
          description: desc.trim(),
          qty: num(qty),
          unit_cost: num(unit),
          amount: num(qty) !== null && num(unit) !== null ? undefined : num(amount),
          note: note.trim(),
          category: cat,
        },
        source,
      );
      setDesc("");
      setQty("");
      setUnit("");
      setAmount("");
      setNote("");
      onChanged();
    } catch (e) {
      err(e, "Couldn't add the estimate line.");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (l: EstimateLine) => {
    setEditingRow(l.row);
    setDraft({
      phase: l.phase,
      kind: l.kind,
      description: l.description,
      qty: l.qty === null ? "" : String(l.qty),
      unit_cost: l.unit_cost === null ? "" : String(l.unit_cost),
      amount: l.amount === null ? "" : String(l.amount),
      note: l.note,
      category: l.category ?? "",
    });
  };

  const saveEdit = async (l: EstimateLine) => {
    setBusyRow(l.row);
    const q = num(draft.qty ?? "");
    const u = num(draft.unit_cost ?? "");
    const body: Parameters<typeof updateEstimateLine>[2] = {
      expected: { description: l.description },
      phase: draft.phase ?? l.phase,
      kind: (draft.kind as EstimateKind) ?? l.kind,
      description: (draft.description ?? l.description).trim() || l.description,
      note: draft.note ?? l.note,
      category: draft.category ?? l.category ?? "",
      qty: q,
      unit_cost: u,
    };
    // Both factors present → the product is the amount. Otherwise the typed
    // amount stands, and the server clears whichever factor is missing.
    if (q === null || u === null) body.amount = num(draft.amount ?? "");
    try {
      await updateEstimateLine(budget.id, l.row, body, source);
      setEditingRow(null);
      setDraft({});
      onChanged();
    } catch (e) {
      err(e, "Couldn't update the estimate line.");
    } finally {
      setBusyRow(null);
    }
  };

  const remove = async (l: EstimateLine) => {
    if (
      !window.confirm(
        `Delete "${l.description}" (${money(l.amount, budget.currency)}) from the estimate? This removes the row from the Google Sheet too.`,
      )
    )
      return;
    setBusyRow(l.row);
    try {
      await deleteEstimateLine(budget.id, l.row, { description: l.description }, source);
      onChanged();
    } catch (e) {
      err(e, "Couldn't delete the estimate line.");
    } finally {
      setBusyRow(null);
    }
  };

  const setMode = async (next: EstimateMode) => {
    if (next === mode) return;
    setSavingRates(true);
    try {
      await updateEstimateRates(budget.id, { mode: next }, source);
      onChanged();
      if (next === "Cost build-up") setRatesOpen(true);
    } catch (e) {
      err(e, "Couldn't change the estimate mode.");
    } finally {
      setSavingRates(false);
    }
  };

  const saveRates = async () => {
    setSavingRates(true);
    const body: Parameters<typeof updateEstimateRates>[1] = {};
    for (const k of ["fringe_pct", "overhead_pct", "ga_pct", "fee_pct"] as const) {
      if (rateDraft[k] !== undefined) {
        const v = num(rateDraft[k]);
        if (v === null && rateDraft[k].trim() !== "") {
          push("error", "Rates must be numbers, e.g. 30 for 30%.");
          setSavingRates(false);
          return;
        }
        body[k] = v ?? 0;
      }
    }
    try {
      await updateEstimateRates(budget.id, body, source);
      setRateDraft({});
      setRatesOpen(false);
      onChanged();
    } catch (e) {
      err(e, "Couldn't save the rates.");
    } finally {
      setSavingRates(false);
    }
  };

  const commit = async () => {
    if (!est || est.total <= 0) return;
    const already = committedOn
      ? `\n\nThis estimate was already committed on ${committedOn}. Committing again adds a SECOND set of Allocated rows.`
      : "";
    const setAllotment = window.confirm(
      `Commit the estimate?\n\n${lines.filter((l) => l.amount !== null).length} lines${
        costMode ? " plus the fringe/overhead/G&A/fee pools" : ""
      } become Allocated rows in the ledger, totalling ${money(est.total, budget.currency)}.${already}\n\nOK: also set the allotment to ${money(
        est.total,
        budget.currency,
      )}.\nCancel: choose next whether to commit without touching the allotment.`,
    );
    if (!setAllotment) {
      if (!window.confirm("Commit the estimate to the ledger WITHOUT changing the allotment?")) return;
    }
    setCommitting(true);
    try {
      const r = await commitEstimate(
        budget.id,
        { set_allotment: setAllotment, force: Boolean(committedOn) },
        source,
      );
      push(
        "success",
        `${r.rows_added} Allocated rows written (${money(r.allocated, budget.currency)})${
          r.allotment_set ? " — allotment set to match" : ""
        }.`,
      );
      onChanged();
    } catch (e) {
      err(e, "Couldn't commit the estimate.");
    } finally {
      setCommitting(false);
    }
  };

  const inputCls = "rounded border bg-background px-1.5 py-1 text-xs";

  const renderLine = (l: EstimateLine) => {
    if (editingRow === l.row) {
      return (
        <tr key={l.row} className="border-b last:border-0">
          <td className="px-2 py-1">
            <input
              list={`est-phases-${budget.id}`}
              value={draft.phase ?? ""}
              onChange={(ev) => setDraft((d) => ({ ...d, phase: ev.target.value }))}
              className={cn(inputCls, "w-24")}
              placeholder="Phase"
            />
          </td>
          <td className="px-2 py-1">
            <select
              value={draft.kind ?? l.kind}
              onChange={(ev) => setDraft((d) => ({ ...d, kind: ev.target.value }))}
              className={cn(inputCls, "w-28")}
            >
              {ESTIMATE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </td>
          <td className="px-2 py-1">
            <CategorySelect
              budgetId={budget.id}
              categories={budget.cached_categories}
              value={draft.category ?? ""}
              onChange={(name) => setDraft((d) => ({ ...d, category: name }))}
              onAdded={onChanged}
              source={source}
              canAdd={canEdit}
              className={cn(inputCls, "w-32")}
            />
          </td>
          <td className="px-2 py-1">
            <input
              value={draft.description ?? ""}
              onChange={(ev) => setDraft((d) => ({ ...d, description: ev.target.value }))}
              className={cn(inputCls, "w-full")}
            />
          </td>
          <td className="px-2 py-1 text-right">
            <input
              type="number"
              value={draft.qty ?? ""}
              onChange={(ev) => setDraft((d) => ({ ...d, qty: ev.target.value }))}
              className={cn(inputCls, "w-16 text-right")}
              placeholder="Qty"
            />
          </td>
          <td className="px-2 py-1 text-right">
            <input
              type="number"
              value={draft.unit_cost ?? ""}
              onChange={(ev) => setDraft((d) => ({ ...d, unit_cost: ev.target.value }))}
              className={cn(inputCls, "w-20 text-right")}
              placeholder="Rate"
            />
          </td>
          <td className="px-2 py-1 text-right">
            <input
              type="number"
              value={
                num(draft.qty ?? "") !== null && num(draft.unit_cost ?? "") !== null
                  ? String(Math.round(num(draft.qty ?? "")! * num(draft.unit_cost ?? "")! * 100) / 100)
                  : draft.amount ?? ""
              }
              disabled={num(draft.qty ?? "") !== null && num(draft.unit_cost ?? "") !== null}
              onChange={(ev) => setDraft((d) => ({ ...d, amount: ev.target.value }))}
              className={cn(inputCls, "w-24 text-right disabled:opacity-60")}
              title="Filled from Qty × Unit cost when both are given"
            />
          </td>
          <td className="px-2 py-1">
            <input
              value={draft.note ?? ""}
              onChange={(ev) => setDraft((d) => ({ ...d, note: ev.target.value }))}
              className={cn(inputCls, "w-full")}
            />
          </td>
          <td className="whitespace-nowrap px-2 py-1 text-right">
            <button
              onClick={() => void saveEdit(l)}
              disabled={busyRow === l.row}
              className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
            >
              {busyRow === l.row ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </button>
            <button
              onClick={() => {
                setEditingRow(null);
                setDraft({});
              }}
              className="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </td>
        </tr>
      );
    }
    return (
      <tr key={l.row} className="border-b last:border-0">
        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{l.phase}</td>
        <td className="whitespace-nowrap px-3 py-2">
          <KindPill kind={l.kind} />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{l.category}</td>
        <td className="px-3 py-2">{l.description}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted-foreground">
          {l.qty === null ? "" : l.qty.toLocaleString()}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted-foreground">
          {l.unit_cost === null ? "" : money(l.unit_cost, budget.currency)}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
          {money(l.amount, budget.currency)}
        </td>
        <td className="max-w-[200px] truncate px-3 py-2 text-xs text-muted-foreground">{l.note}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {canEdit && (
            <>
              <button
                onClick={() => startEdit(l)}
                disabled={busyRow === l.row}
                className="mr-1 text-muted-foreground hover:text-foreground"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => void remove(l)}
                disabled={busyRow === l.row}
                className="text-muted-foreground hover:text-red-600"
                title="Delete"
              >
                {busyRow === l.row ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <section className="space-y-3 rounded-xl border border-violet-300/60 bg-violet-500/5 p-4 dark:border-violet-800/60">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
          title={open ? "Collapse the estimate" : "Show the estimate"}
        >
          <Calculator className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <h3 className="text-sm font-semibold">Estimate</h3>
          <span className="text-xs text-muted-foreground">
            {lines.length === 0
              ? "the plan before the money — what this is expected to cost"
              : `${lines.length} line${lines.length === 1 ? "" : "s"} · ${mode}`}
          </span>
        </button>
        {est && lines.length > 0 && (
          <span className="ml-auto text-base font-semibold text-violet-700 dark:text-violet-300">
            {money(est.total, budget.currency)}
          </span>
        )}
      </div>

      {open && (
        <>
          {/* Mode + rates */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Totalled as</span>
            {(["Simple", "Cost build-up"] as EstimateMode[]).map((m) => (
              <button
                key={m}
                onClick={() => (canEdit ? void setMode(m) : undefined)}
                disabled={!canEdit || savingRates}
                className={cn(
                  "rounded-md border px-2 py-1 transition-colors disabled:cursor-default",
                  m === mode ? "border-primary bg-primary/10 font-medium text-primary" : canEdit && "hover:bg-accent",
                )}
                title={
                  m === "Simple"
                    ? "The sum of the lines."
                    : "Labor → fringe → overhead → other direct costs → G&A → fee, the way a proposal is priced."
                }
              >
                {m}
              </button>
            ))}
            {costMode && (
              <button
                onClick={() => setRatesOpen((v) => !v)}
                className="rounded-md border px-2 py-1 hover:bg-accent"
                title="The rates applied on top of the direct costs"
              >
                Fringe {pct(est?.fringe_pct)} · Overhead {pct(est?.overhead_pct)} · G&A {pct(est?.ga_pct)} · Fee {pct(est?.fee_pct)}
              </button>
            )}
            {committedOn && (
              <span
                className="flex items-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                title="The estimate's lines sit in the ledger as Allocated rows"
              >
                <CheckCircle2 className="h-3 w-3" /> Committed {committedOn}
              </span>
            )}
          </div>

          {costMode && ratesOpen && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-background/60 p-3 text-xs">
              {(
                [
                  ["fringe_pct", "Fringe %", "On labor."],
                  ["overhead_pct", "Overhead %", "On labor + fringe."],
                  ["ga_pct", "G&A %", "On everything above, including other direct costs."],
                  ["fee_pct", "Fee %", "On the total cost."],
                ] as const
              ).map(([key, label, help]) => (
                <label key={key} className="flex flex-col gap-1" title={help}>
                  <span className="text-muted-foreground">{label}</span>
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canEdit}
                    value={rateDraft[key] ?? String(est?.[key] ?? 0)}
                    onChange={(ev) => setRateDraft((d) => ({ ...d, [key]: ev.target.value }))}
                    className={cn(inputCls, "w-20 text-right")}
                  />
                </label>
              ))}
              {canEdit && (
                <button
                  onClick={() => void saveRates()}
                  disabled={savingRates || Object.keys(rateDraft).length === 0}
                  className="rounded-md border bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingRates ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save rates"}
                </button>
              )}
              <p className="basis-full text-muted-foreground">
                Rates are written to the sheet's Settings tab. Fringe applies to labor; overhead to labor plus
                fringe; G&A to all of that plus materials, travel, subcontracts and other; fee to the resulting cost.
              </p>
            </div>
          )}

          {/* Lines, grouped by phase */}
          <div className="overflow-x-auto rounded-xl border bg-background">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">Phase</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit cost</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                      No estimate yet
                      {canEdit
                        ? " — add lines below, ask Gerry (“add 200 hours of mechanical engineering at $95”), or type them into the sheet's Estimate tab."
                        : "."}
                    </td>
                  </tr>
                )}
                {phases.map((p) => {
                  const group = lines.filter((l) => l.phase === p);
                  const subtotal = est?.by_phase?.[p || NO_PHASE];
                  return (
                    <PhaseGroup
                      key={p || NO_PHASE}
                      label={p || (phases.length > 1 ? NO_PHASE : "")}
                      showHeader={phases.length > 1}
                      subtotal={subtotal}
                      currency={budget.currency}
                      costMode={costMode}
                    >
                      {group.map(renderLine)}
                    </PhaseGroup>
                  );
                })}
              </tbody>
              {est && lines.length > 0 && (
                <tfoot className="border-t bg-muted/30 text-xs">
                  {costMode ? (
                    <>
                      <FootRow label="Labor" value={est.labor} currency={budget.currency} />
                      <FootRow label={`Fringe (${pct(est.fringe_pct)} of labor)`} value={est.fringe} currency={budget.currency} />
                      <FootRow label={`Overhead (${pct(est.overhead_pct)} of labor + fringe)`} value={est.overhead} currency={budget.currency} />
                      <FootRow label="Materials, travel, subcontracts, other" value={est.odc} currency={budget.currency} />
                      <FootRow label={`G&A (${pct(est.ga_pct)})`} value={est.ga} currency={budget.currency} />
                      <FootRow label="Total cost" value={est.cost} currency={budget.currency} strong />
                      <FootRow label={`Fee (${pct(est.fee_pct)})`} value={est.fee} currency={budget.currency} />
                      <FootRow label="Estimate total" value={est.total} currency={budget.currency} strong big />
                    </>
                  ) : (
                    <>
                      {Object.entries(est.by_category ?? est.by_kind).map(([k, v]) => (
                        <FootRow key={k} label={k} value={v} currency={budget.currency} />
                      ))}
                      <FootRow label="Estimate total" value={est.total} currency={budget.currency} strong big />
                    </>
                  )}
                </tfoot>
              )}
            </table>
          </div>

          {/* Add a line */}
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-background/60 p-3">
              <datalist id={`est-phases-${budget.id}`}>
                {knownPhases.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <input
                list={`est-phases-${budget.id}`}
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
                placeholder="Phase (optional)"
                className={cn(inputCls, "w-28")}
                title="Base, Option 1, Year 2, CLIN 0001…"
              />
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as EstimateKind)}
                className={cn(inputCls, "w-28")}
                title="Labor is the base for fringe and overhead in Cost build-up mode"
              >
                {ESTIMATE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <CategorySelect
                budgetId={budget.id}
                categories={budget.cached_categories}
                value={cat}
                onChange={setCat}
                onAdded={onChanged}
                source={source}
                className={cn(inputCls, "w-36")}
              />
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={kind === "Labor" ? "Role, e.g. Mechanical engineer" : "Description"}
                className={cn(inputCls, "min-w-[180px] flex-1")}
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={kind === "Labor" ? "Hours" : "Qty"}
                className={cn(inputCls, "w-20 text-right")}
              />
              <input
                type="number"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={kind === "Labor" ? "Rate" : "Unit cost"}
                className={cn(inputCls, "w-24 text-right")}
              />
              <input
                type="number"
                value={num(qty) !== null && num(unit) !== null ? String(Math.round(num(qty)! * num(unit)! * 100) / 100) : amount}
                disabled={num(qty) !== null && num(unit) !== null}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                className={cn(inputCls, "w-24 text-right disabled:opacity-60")}
                title="Filled from Qty × Unit cost when both are given"
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note"
                className={cn(inputCls, "w-32")}
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
              <button
                onClick={() => void add()}
                disabled={adding || !desc.trim() || previewAmount === null}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add line
              </button>
            </div>
          )}

          {/* Commit */}
          {canEdit && est && lines.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                onClick={() => void commit()}
                disabled={committing || est.total <= 0}
                className="flex items-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
                title="Awarded: write the estimate to the ledger as Allocated rows"
              >
                {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                {committedOn ? "Commit again" : "Commit estimate to ledger"}
              </button>
              <span className="text-muted-foreground">
                When the contract is awarded: each line becomes an Allocated ledger row and the total can become
                the allotment. The estimate stays here as the baseline.
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PhaseGroup({
  label,
  showHeader,
  subtotal,
  currency,
  costMode,
  children,
}: {
  label: string;
  showHeader: boolean;
  subtotal: number | undefined;
  currency: string;
  costMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {showHeader && (
        <tr className="border-b bg-violet-500/5 text-xs">
          <td colSpan={6} className="px-3 py-1.5 font-semibold">
            {label}
          </td>
          <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold" title={costMode ? "Loaded, with the rates applied" : undefined}>
            {money(subtotal, currency)}
          </td>
          <td colSpan={2} />
        </tr>
      )}
      {children}
    </>
  );
}

function FootRow({
  label,
  value,
  currency,
  strong,
  big,
}: {
  label: string;
  value: number;
  currency: string;
  strong?: boolean;
  big?: boolean;
}) {
  return (
    <tr className={cn(strong && "border-t")}>
      <td colSpan={6} className={cn("px-3 py-1 text-right text-muted-foreground", strong && "font-semibold text-foreground")}>
        {label}
      </td>
      <td className={cn("whitespace-nowrap px-3 py-1 text-right", strong && "font-semibold", big && "text-sm text-violet-700 dark:text-violet-300")}>
        {money(value, currency)}
      </td>
      <td colSpan={2} />
    </tr>
  );
}
