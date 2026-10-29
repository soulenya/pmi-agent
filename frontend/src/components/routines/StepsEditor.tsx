/**
 * The steps of a routine, as a small editor: a list where each row is either
 * something for Gerry to do, or a decision — IF a condition, THEN these
 * actions, OTHERWISE those. Rows move up and down; a branch's actions are one
 * per line. What is typed here is what Gerry follows at run time.
 */
import { ArrowDown, ArrowUp, GitBranch, ListChecks, Plus, X } from "lucide-react";

import type { RoutineStep } from "@/api/scheduledTasks";
import { cn } from "@/lib/utils";

/** Trim blanks; drop steps with nothing in them. Mirrors the server's checks. */
export function cleanSteps(steps: RoutineStep[]): RoutineStep[] {
  const out: RoutineStep[] = [];
  for (const s of steps) {
    if (s.kind === "do") {
      const text = s.text.trim();
      if (text) out.push({ kind: "do", text });
    } else {
      const condition = s.condition.trim();
      const then = s.then.map((a) => a.trim()).filter(Boolean);
      const otherwise = s.otherwise.map((a) => a.trim()).filter(Boolean);
      if (condition && (then.length || otherwise.length)) out.push({ kind: "if", condition, then, otherwise });
    }
  }
  return out;
}

/** A step that has a condition but nothing to do, or no condition — not saveable yet. */
export function stepsHaveGaps(steps: RoutineStep[]): boolean {
  return steps.some((s) => {
    if (s.kind === "do") return !s.text.trim();
    const anyAction = s.then.some((a) => a.trim()) || s.otherwise.some((a) => a.trim());
    return !s.condition.trim() || !anyAction;
  });
}

const input =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

function Lines({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <textarea
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        placeholder={placeholder}
        rows={Math.max(2, Math.min(5, value.length + 1))}
        className={cn(input, "mt-1 resize-y")}
      />
    </label>
  );
}

export function StepsEditor({
  steps,
  onChange,
  compact = false,
}: {
  steps: RoutineStep[];
  onChange: (steps: RoutineStep[]) => void;
  compact?: boolean;
}) {
  const set = (i: number, step: RoutineStep) => onChange(steps.map((s, j) => (j === i ? step : s)));
  const remove = (i: number) => onChange(steps.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {steps.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No steps — the instruction above is the whole routine. Add steps to give Gerry a procedure, with
          decisions along the way.
        </p>
      )}
      {steps.map((s, i) => (
        <div key={i} className={cn("rounded-lg border bg-card", compact ? "p-2.5" : "p-3")}>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
              {i + 1}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              {s.kind === "if" ? <GitBranch className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
              {s.kind === "if" ? "Decision" : "Do"}
            </span>
            <span className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === steps.length - 1}
                aria-label="Move down"
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove step"
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          {s.kind === "do" ? (
            <input
              value={s.text}
              onChange={(e) => set(i, { kind: "do", text: e.target.value })}
              placeholder="Read last week's emails from the Hatch team"
              className={input}
            />
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">If</span>
                <input
                  value={s.condition}
                  onChange={(e) => set(i, { ...s, condition: e.target.value })}
                  placeholder="any invoice is more than 30 days unpaid"
                  className={cn(input, "mt-1")}
                />
              </label>
              <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
                <Lines
                  label="Then"
                  value={s.then}
                  onChange={(v) => set(i, { ...s, then: v })}
                  placeholder={"Draft a reminder email to the vendor\nCreate a task to follow up on Friday"}
                />
                <Lines
                  label="Otherwise"
                  value={s.otherwise}
                  onChange={(v) => set(i, { ...s, otherwise: v })}
                  placeholder="Note that all invoices are current (leave empty to just carry on)"
                />
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([...steps, { kind: "do", text: "" }])}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Add a step
        </button>
        <button
          type="button"
          onClick={() => onChange([...steps, { kind: "if", condition: "", then: [], otherwise: [] }])}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
        >
          <GitBranch className="h-3.5 w-3.5" /> Add a decision (if / then / otherwise)
        </button>
      </div>
    </div>
  );
}

/** Read-only rendering of the steps, one line each, for a routine card. */
export function StepsSummary({ steps }: { steps: RoutineStep[] }) {
  if (!steps.length) return null;
  return (
    <ol className="space-y-1 text-xs">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
          {s.kind === "do" ? (
            <span>{s.text}</span>
          ) : (
            <span>
              <span className="font-medium">If</span> {s.condition}
              {s.then.length > 0 && (
                <>
                  {" "}
                  <span className="font-medium">then</span> {s.then.join("; ")}
                </>
              )}
              {s.otherwise.length > 0 && (
                <>
                  {" "}
                  <span className="font-medium">otherwise</span> {s.otherwise.join("; ")}
                </>
              )}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
