/**
 * TimelineTab — the project Gantt.
 *
 * Bars are drawn from the schedule the backend computed, so a task with no
 * dates of its own still lands somewhere sensible. Dragging writes real dates
 * back to the task; nothing is persisted until the pointer is released.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Diamond, Link2, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addDependency,
  getProjectTimeline,
  removeDependency,
  updateTask,
  type Source,
} from "@/api/tasks";
import type { Gate, ScheduledTask, Task, Timeline } from "@/types/tasks";

const ROW_HEIGHT = 36;
const BAR_HEIGHT = 20;
const NAME_WIDTH = 240;
const PAD_DAYS_BEFORE = 3;
const PAD_DAYS_AFTER = 10;

const ZOOMS = [
  { id: "month", label: "Month", pxPerDay: 4 },
  { id: "week", label: "Week", pxPerDay: 12 },
  { id: "day", label: "Day", pxPerDay: 30 },
] as const;

type ZoomId = (typeof ZOOMS)[number]["id"];

const DAY_MS = 86_400_000;

/** Parse a `YYYY-MM-DD` (or ISO datetime) as a local calendar day, no TZ drift. */
function parseDay(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}T00:00:00Z`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Parents first, each followed by its own subtasks. */
function orderRows(tasks: Task[]): { task: Task; depth: number }[] {
  const byParent = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parent_task_id;
    const list = byParent.get(key) ?? [];
    list.push(t);
    byParent.set(key, list);
  }
  const known = new Set(tasks.map(t => t.id));
  const roots = tasks.filter(t => !t.parent_task_id || !known.has(t.parent_task_id));

  const out: { task: Task; depth: number }[] = [];
  const walk = (task: Task, depth: number) => {
    out.push({ task, depth });
    for (const child of byParent.get(task.id) ?? []) walk(child, depth + 1);
  };
  roots.forEach(r => walk(r, 0));
  return out;
}

interface DragState {
  taskId: string;
  mode: "move" | "resize-start" | "resize-end";
  originX: number;
  startDay: Date;
  endDay: Date;
  offsetDays: number;
}

export function TimelineTab({
  projectId,
  source = "local",
  canEdit,
}: {
  projectId: string;
  source?: Source;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<ZoomId>("week");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["project-timeline", source, projectId],
    queryFn: () => getProjectTimeline(projectId, source),
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["project-timeline", source, projectId] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["project-space", source, projectId] });
  }, [qc, source, projectId]);

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, start, end }: { id: string; start: Date; end: Date }) =>
      updateTask(id, { start_date: toIsoDay(start), end_date: toIsoDay(end) }, source),
    onSuccess: invalidate,
    onError: () => setError("That change could not be saved."),
  });

  const linkMutation = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      addDependency(to, from, "FS", 0, source),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail;
      setError(detail || "Those two tasks could not be linked.");
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      removeDependency(to, from, source),
    onSuccess: invalidate,
  });

  const pxPerDay = ZOOMS.find(z => z.id === zoom)!.pxPerDay;

  const model = useMemo(() => buildModel(data, pxPerDay), [data, pxPerDay]);

  const onPointerDown = (
    e: React.PointerEvent,
    task: Task,
    bar: { start: Date; end: Date },
    mode: DragState["mode"],
  ) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      taskId: task.id,
      mode,
      originX: e.clientX,
      startDay: bar.start,
      endDay: bar.end,
      offsetDays: 0,
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const moved = Math.round((e.clientX - drag.originX) / pxPerDay);
    if (moved !== drag.offsetDays) setDrag({ ...drag, offsetDays: moved });
  };

  const onPointerUp = () => {
    if (!drag) return;
    const { startDay, endDay, offsetDays, mode } = drag;
    let start = startDay;
    let end = endDay;
    if (mode === "move") {
      start = addDays(startDay, offsetDays);
      end = addDays(endDay, offsetDays);
    } else if (mode === "resize-start") {
      start = addDays(startDay, offsetDays);
      if (start > end) start = end;
    } else {
      end = addDays(endDay, offsetDays);
      if (end < start) end = start;
    }
    if (offsetDays !== 0) rescheduleMutation.mutate({ id: drag.taskId, start, end });
    setDrag(null);
  };

  const handleBarClick = (taskId: string) => {
    if (!canEdit) return;
    if (!linkFrom) return;
    if (linkFrom === taskId) {
      setLinkFrom(null);
      return;
    }
    linkMutation.mutate({ from: linkFrom, to: taskId });
    setLinkFrom(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Working out the schedule…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        The timeline could not be loaded.
      </p>
    );
  }
  if (!model || model.rows.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm font-medium">Nothing to schedule yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Add tasks to this project and they appear here as bars. Give one a start
          and end date, then drag the ends to reschedule it.
        </p>
      </div>
    );
  }

  const { rows, rangeStart, totalDays, months, todayOffset } = model;
  const gridWidth = totalDays * pxPerDay;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border">
          {ZOOMS.map(z => (
            <button
              key={z.id}
              type="button"
              onClick={() => setZoom(z.id)}
              className={cn(
                "px-3 py-1 text-xs first:rounded-l-md last:rounded-r-md",
                zoom === z.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {z.label}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ZoomOut className="h-3 w-3" />
          <ZoomIn className="h-3 w-3" />
          {rows.length} {rows.length === 1 ? "task" : "tasks"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2 w-4 rounded-sm bg-rose-500" /> critical path
        </span>
        {model.gates.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-3 w-0.5 bg-amber-500" /> gate in another project
          </span>
        )}
        {linkFrom && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs">
            <Link2 className="h-3 w-3" />
            Pick the task that waits on it
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => setLinkFrom(null)}
            >
              cancel
            </button>
          </span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      <div className="flex-1 overflow-auto rounded-xl border bg-card">
        <div className="flex min-w-max">
          {/* Task names, frozen to the left. */}
          <div
            className="sticky left-0 z-20 shrink-0 border-r bg-card"
            style={{ width: NAME_WIDTH }}
          >
            <div className="h-10 border-b" />
            {rows.map(row => (
              <div
                key={row.task.id}
                className="flex items-center gap-1 truncate border-b px-3 text-sm"
                style={{ height: ROW_HEIGHT, paddingLeft: 12 + row.depth * 14 }}
                title={row.task.title}
              >
                {row.task.is_milestone && (
                  <Diamond className="h-3 w-3 shrink-0 text-amber-500" />
                )}
                <span className="truncate">{row.task.title}</span>
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="relative select-none"
            style={{ width: gridWidth }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {/* Month header */}
            <div className="sticky top-0 z-10 flex h-10 border-b bg-card">
              {months.map(m => (
                <div
                  key={m.key}
                  className="shrink-0 border-r px-2 py-1 text-xs text-muted-foreground"
                  style={{ width: m.days * pxPerDay }}
                >
                  {m.label}
                </div>
              ))}
            </div>

            {/* Today */}
            {todayOffset >= 0 && todayOffset <= totalDays && (
              <div
                className="pointer-events-none absolute top-10 z-10 w-px bg-primary/60"
                style={{ left: todayOffset * pxPerDay, height: rows.length * ROW_HEIGHT }}
              />
            )}

            {/* Gates — a milestone in another project that this one waits on. */}
            {model.gates.map(gate => (
              <div
                key={gate.link_id}
                className="absolute top-10 z-10 flex"
                style={{ left: gate.offset * pxPerDay, height: rows.length * ROW_HEIGHT }}
                title={`${gate.from_project_name}: ${gate.gate_task_title || "gate"}${
                  gate.note ? `\n${gate.note}` : ""
                }`}
              >
                <div
                  className={cn(
                    "w-0.5",
                    gate.status === "open" ? "bg-amber-500" : "bg-emerald-500/50",
                  )}
                />
                <span
                  className={cn(
                    "pointer-events-none ml-1 h-4 self-start whitespace-nowrap rounded-sm px-1 text-[10px] leading-4",
                    gate.status === "open"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {gate.gate_task_title || gate.from_project_name}
                </span>
              </div>
            ))}

            {/* Dependency arrows */}
            <svg
              className="pointer-events-none absolute left-0 top-10"
              width={gridWidth}
              height={rows.length * ROW_HEIGHT}
            >
              {model.links.map(link => (
                <path
                  key={link.key}
                  d={link.path}
                  fill="none"
                  strokeWidth={1.5}
                  className="stroke-muted-foreground/60"
                  markerEnd="url(#tl-arrow)"
                />
              ))}
              <defs>
                <marker
                  id="tl-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground/60" />
                </marker>
              </defs>
            </svg>

            {/* Rows */}
            {rows.map((row, i) => {
              const isDragging = drag?.taskId === row.task.id;
              const shift = isDragging ? drag!.offsetDays : 0;
              const left =
                (daysBetween(rangeStart, row.bar.start) +
                  (isDragging && drag!.mode !== "resize-end" ? shift : 0)) *
                pxPerDay;
              const rawDays = daysBetween(row.bar.start, row.bar.end) + 1;
              const days =
                isDragging && drag!.mode === "resize-end"
                  ? Math.max(1, rawDays + shift)
                  : isDragging && drag!.mode === "resize-start"
                    ? Math.max(1, rawDays - shift)
                    : rawDays;

              return (
                <div
                  key={row.task.id}
                  className="relative border-b"
                  style={{ height: ROW_HEIGHT }}
                >
                  {row.task.is_milestone ? (
                    <div
                      role={canEdit ? "button" : undefined}
                      tabIndex={canEdit ? 0 : undefined}
                      onPointerDown={e => onPointerDown(e, row.task, row.bar, "move")}
                      onClick={() => handleBarClick(row.task.id)}
                      className={cn(
                        "absolute top-1/2 h-3 w-3 -translate-y-1/2 rotate-45",
                        row.sched?.is_critical ? "bg-rose-500" : "bg-amber-500",
                        canEdit && "cursor-grab",
                      )}
                      style={{ left: left + pxPerDay / 2 - 6 }}
                      title={row.tooltip}
                    />
                  ) : (
                    <div
                      className={cn(
                        "group absolute top-1/2 -translate-y-1/2 rounded-md",
                        row.sched?.is_critical
                          ? "bg-rose-500/20 ring-1 ring-rose-500"
                          : "bg-primary/20 ring-1 ring-primary/50",
                        row.sched?.is_late && "ring-2 ring-destructive",
                        row.gate && "ring-2 ring-amber-500",
                        canEdit && "cursor-grab",
                        linkFrom && linkFrom !== row.task.id && "ring-2 ring-primary",
                      )}
                      style={{
                        left,
                        width: Math.max(days * pxPerDay, 6),
                        height: BAR_HEIGHT,
                      }}
                      title={row.tooltip}
                      onPointerDown={e => onPointerDown(e, row.task, row.bar, "move")}
                      onClick={() => handleBarClick(row.task.id)}
                    >
                      <div
                        className={cn(
                          "h-full rounded-l-md",
                          row.sched?.is_critical ? "bg-rose-500/60" : "bg-primary/60",
                        )}
                        style={{ width: `${row.task.progress_pct}%` }}
                      />
                      {canEdit && (
                        <>
                          <span
                            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
                            onPointerDown={e =>
                              onPointerDown(e, row.task, row.bar, "resize-start")
                            }
                          />
                          <span
                            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
                            onPointerDown={e =>
                              onPointerDown(e, row.task, row.bar, "resize-end")
                            }
                          />
                          <button
                            type="button"
                            title="Make another task wait on this one"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              setLinkFrom(row.task.id);
                            }}
                            className="absolute -right-5 top-1/2 hidden h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border bg-background group-hover:flex"
                          >
                            <Link2 className="h-2.5 w-2.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {i === 0 && null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {model.links.length > 0 && canEdit && (
        <details className="rounded-lg border bg-card px-3 py-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Dependencies ({model.links.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {model.links.map(l => (
              <li key={l.key} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  {l.fromTitle} → {l.toTitle}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-destructive hover:underline"
                  onClick={() => unlinkMutation.mutate({ from: l.from, to: l.to })}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

interface Row {
  task: Task;
  depth: number;
  bar: { start: Date; end: Date };
  sched: ScheduledTask | undefined;
  gate: Gate | undefined;
  tooltip: string;
}

function buildModel(data: Timeline | undefined, pxPerDay: number) {
  if (!data || data.tasks.length === 0) return null;

  const schedById = new Map(data.schedule.map(s => [s.task_id, s]));
  const ordered = orderRows(data.tasks);

  const rows: Row[] = ordered.map(({ task, depth }) => {
    const sched = schedById.get(task.id);
    const start = parseDay(
      task.start_date ?? sched?.early_start ?? task.due_date ?? new Date().toISOString(),
    );
    const end = parseDay(
      task.end_date ?? task.due_date ?? sched?.early_finish ?? toIsoDay(start),
    );
    const bar = { start, end: end < start ? start : end };
    const slack = sched ? `${sched.slack_days} days slack` : "";
    const gate = sched?.blocked_by_gate
      ? (data.gates ?? []).find(g => g.link_id === sched.blocked_by_gate)
      : undefined;
    return {
      task,
      depth,
      bar,
      sched,
      gate,
      tooltip: [
        task.title,
        `${bar.start.toDateString()} → ${bar.end.toDateString()}`,
        sched?.is_critical ? "on the critical path" : slack,
        sched?.is_late ? "finishes after it is due" : "",
        gate
          ? `starts before ${gate.from_project_name} clears ${gate.gate_task_title || "its gate"}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });

  const openGates = (data.gates ?? []).filter(g => g.opens_on);
  const allDates = [
    ...rows.flatMap(r => [r.bar.start, r.bar.end]),
    ...openGates.map(g => parseDay(g.opens_on!)),
  ];
  const today = startOfToday();
  const min = new Date(Math.min(...allDates.map(d => d.getTime()), today.getTime()));
  const max = new Date(Math.max(...allDates.map(d => d.getTime()), today.getTime()));
  const rangeStart = addDays(min, -PAD_DAYS_BEFORE);
  const rangeEnd = addDays(max, PAD_DAYS_AFTER);
  const totalDays = daysBetween(rangeStart, rangeEnd) + 1;

  const months: { key: string; label: string; days: number }[] = [];
  let cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const sliceEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;
    months.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: cursor.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      days: daysBetween(cursor, sliceEnd) + 1,
    });
    cursor = addDays(sliceEnd, 1);
  }

  const rowIndex = new Map(rows.map((r, i) => [r.task.id, i]));
  const links = data.dependencies
    .filter(d => rowIndex.has(d.predecessor_id) && rowIndex.has(d.successor_id))
    .map(d => {
      const from = rows[rowIndex.get(d.predecessor_id)!];
      const to = rows[rowIndex.get(d.successor_id)!];
      const y1 = rowIndex.get(d.predecessor_id)! * ROW_HEIGHT + ROW_HEIGHT / 2;
      const y2 = rowIndex.get(d.successor_id)! * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x1 = (daysBetween(rangeStart, from.bar.end) + 1) * pxPerDay;
      const x2 = daysBetween(rangeStart, to.bar.start) * pxPerDay;
      const mid = x2 > x1 + 12 ? (x1 + x2) / 2 : x1 + 12;
      return {
        key: d.id,
        from: d.predecessor_id,
        to: d.successor_id,
        fromTitle: from.task.title,
        toTitle: to.task.title,
        path: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,
      };
    });

  return {
    rows,
    rangeStart,
    totalDays,
    months,
    links,
    gates: openGates.map(g => ({
      ...g,
      offset: daysBetween(rangeStart, parseDay(g.opens_on!)),
    })),
    todayOffset: daysBetween(rangeStart, today),
  };
}
