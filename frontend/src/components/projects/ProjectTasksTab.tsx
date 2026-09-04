/**
 * The Tasks tab of a project space.
 *
 * Before this, a project could hold tasks but had no way to make one: the
 * local tab linked out to the task board and the hub tab printed a read-only
 * list, so on a hub project — which is where the real work is — there was no
 * way in at all. The endpoint had been there the whole time.
 *
 * Everything is written through the project's own route, so custody, roles and
 * the hub all behave the same way they do everywhere else in the space. A row
 * can be dragged straight onto the canvas, because a task and its card on the
 * board are the same task.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Flag,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { createTask, deleteTask, listTasks, updateTask, type Source } from "@/api/tasks";
import { DRAG_MIME, type RailItem } from "@/components/projects/canvas/board";
import { useProjectInvalidate } from "@/hooks/useProjectInvalidate";
import { cn } from "@/lib/utils";
import type {
  ProjectMember,
  Task,
  TaskPriority,
  TaskStatus,
  TaskUpdate,
} from "@/types/tasks";

const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "in_review", label: "In review" },
  { id: "done", label: "Done" },
  { id: "backlog", label: "Backlog" },
  { id: "cancelled", label: "Cancelled" },
];

const PRIORITIES: { id: TaskPriority; label: string; className: string }[] = [
  { id: "low", label: "Low", className: "text-slate-500" },
  { id: "medium", label: "Medium", className: "text-sky-600 dark:text-sky-400" },
  { id: "high", label: "High", className: "text-amber-600 dark:text-amber-400" },
  { id: "critical", label: "Critical", className: "text-rose-600 dark:text-rose-400" },
];

const PRIORITY_RANK: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type SortBy = "order" | "due" | "priority";

/** `<input type="date">` speaks YYYY-MM-DD; the API speaks ISO instants. */
function toDayInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function fromDayInput(day: string): string | null {
  return day ? new Date(`${day}T12:00:00`).toISOString() : null;
}

function dueLabel(task: Task): { text: string; late: boolean } | null {
  if (!task.due_date) return null;
  const due = new Date(task.due_date);
  const open = task.status !== "done" && task.status !== "cancelled";
  return { text: due.toLocaleDateString(), late: open && due < new Date() };
}

function memberName(members: ProjectMember[], userId: string | null): string | null {
  if (!userId) return null;
  const found = members.find((m) => m.user_id === userId);
  return found ? found.display_name || found.email || "Someone on the project" : null;
}

// ── One row ───────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  parentTitle,
  members,
  canEdit,
  onPatch,
  onDelete,
  onAddSub,
  busy,
}: {
  task: Task;
  parentTitle: string | null;
  members: ProjectMember[];
  canEdit: boolean;
  onPatch: (body: TaskUpdate) => void;
  onDelete: () => void;
  onAddSub: (title: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [sub, setSub] = useState("");
  const due = dueLabel(task);
  const priority = PRIORITIES.find((p) => p.id === task.priority);
  const assignee = memberName(members, task.assignee_id);

  const drag: RailItem = { kind: "task", refId: task.id, label: task.title };

  return (
    <li className="border-b last:border-b-0">
      <div
        className="flex items-center gap-2 px-3 py-2"
        draggable={canEdit}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(drag));
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        {canEdit && (
          <GripVertical
            className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/50"
            aria-hidden
          />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span
              className={cn(
                "block truncate text-sm",
                (task.status === "done" || task.status === "cancelled") &&
                  "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </span>
            {parentTitle && (
              <span className="block truncate text-[11px] text-muted-foreground">
                under {parentTitle}
              </span>
            )}
          </span>
        </button>

        {task.is_milestone && (
          <Flag className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Milestone" />
        )}
        {assignee && (
          <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">
            {assignee}
          </span>
        )}
        {priority && priority.id !== "medium" && (
          <span className={cn("shrink-0 text-xs", priority.className)}>{priority.label}</span>
        )}
        {due && (
          <span
            className={cn(
              "shrink-0 text-xs",
              due.late ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
            )}
          >
            {due.text}
          </span>
        )}

        <select
          value={task.status}
          disabled={!canEdit || busy}
          onChange={(e) => onPatch({ status: e.target.value as TaskStatus })}
          className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-xs disabled:opacity-60"
        >
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {open && (
        <div className="space-y-3 border-t bg-muted/30 px-3 py-3">
          <input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const next = title.trim();
              if (next && next !== task.title) onPatch({ title: next });
              else setTitle(task.title);
            }}
            className="w-full rounded border bg-background px-2 py-1 text-sm"
          />
          <textarea
            value={description}
            disabled={!canEdit}
            rows={2}
            placeholder="What this involves"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== (task.description ?? "")) onPatch({ description });
            }}
            className="w-full rounded border bg-background px-2 py-1 text-sm"
          />

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-muted-foreground">
              Priority
              <select
                value={task.priority}
                disabled={!canEdit}
                onChange={(e) => onPatch({ priority: e.target.value as TaskPriority })}
                className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Assignee
              <select
                value={task.assignee_id ?? ""}
                disabled={!canEdit}
                onChange={(e) => onPatch({ assignee_id: e.target.value || null })}
                className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
              >
                <option value="">Nobody yet</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name || m.email || m.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Due
              <input
                type="date"
                value={toDayInput(task.due_date)}
                disabled={!canEdit}
                onChange={(e) => onPatch({ due_date: fromDayInput(e.target.value) })}
                className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Progress
              <input
                type="number"
                min={0}
                max={100}
                value={task.progress_pct}
                disabled={!canEdit}
                onChange={(e) =>
                  onPatch({
                    progress_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  })
                }
                className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Starts
              <input
                type="date"
                value={toDayInput(task.start_date)}
                disabled={!canEdit}
                onChange={(e) => onPatch({ start_date: fromDayInput(e.target.value) })}
                className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Ends
              <input
                type="date"
                value={toDayInput(task.end_date)}
                disabled={!canEdit}
                onChange={(e) => onPatch({ end_date: fromDayInput(e.target.value) })}
                className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
            <label className="flex items-end gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={task.is_milestone}
                disabled={!canEdit}
                onChange={(e) => onPatch({ is_milestone: e.target.checked })}
                className="mb-1.5"
              />
              <span className="mb-1">Milestone</span>
            </label>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={sub}
                placeholder="Add a sub-task"
                onChange={(e) => setSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !sub.trim()) return;
                  onAddSub(sub.trim());
                  setSub("");
                }}
                className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm"
              />
              <button
                type="button"
                disabled={!sub.trim() || busy}
                onClick={() => {
                  onAddSub(sub.trim());
                  setSub("");
                }}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Sub-task
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Drag this row onto the canvas to put it on the board.
          </p>
        </div>
      )}
    </li>
  );
}

// ── The tab ───────────────────────────────────────────────────────────────────

export function ProjectTasksTab({
  projectId,
  source = "local",
  canEdit,
  members,
}: {
  projectId: string;
  source?: Source;
  canEdit: boolean;
  members: ProjectMember[];
}) {
  const invalidate = useProjectInvalidate(projectId, source);
  const [title, setTitle] = useState("");
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState<{
    status: TaskStatus;
    priority: TaskPriority;
    assignee_id: string;
    due: string;
    start: string;
    end: string;
    milestone: boolean;
  }>({
    status: "todo",
    priority: "medium",
    assignee_id: "",
    due: "",
    start: "",
    end: "",
    milestone: false,
  });
  const [sortBy, setSortBy] = useState<SortBy>("order");
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    // Shared with the canvas rail, so a task made here shows up there at once.
    queryKey: ["tasks", { project_id: projectId }, source],
    queryFn: () => listTasks({ project_id: projectId }, source),
  });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof createTask>[0]) => createTask(body, source),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: () => setError("That task could not be created."),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskUpdate }) =>
      updateTask(id, body, source),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: () =>
      setError(
        "That change did not stick. Work made in a shared project can only be changed there.",
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteTask(id, source),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: () => setError("That task could not be deleted."),
  });

  const busy = create.isPending || patch.isPending || remove.isPending;

  const titles = useMemo(
    () => new Map(tasks.map((t) => [t.id, t.title] as const)),
    [tasks],
  );

  const groups = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      if (sortBy === "priority") {
        return (
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          a.sort_order - b.sort_order
        );
      }
      if (sortBy === "due") {
        // Anything without a date goes last, rather than sorting as year zero.
        const av = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
        const bv = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
        return av - bv || a.sort_order - b.sort_order;
      }
      return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
    });
    return STATUSES.map((s) => ({
      ...s,
      tasks: sorted.filter((t) => t.status === s.id),
    })).filter((g) => g.tasks.length > 0);
  }, [tasks, sortBy]);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate({
      title: trimmed,
      project_id: projectId,
      status: draft.status,
      priority: draft.priority,
      assignee_id: draft.assignee_id || undefined,
      due_date: fromDayInput(draft.due) ?? undefined,
      start_date: fromDayInput(draft.start) ?? undefined,
      end_date: fromDayInput(draft.end) ?? undefined,
      is_milestone: draft.milestone,
    });
    setTitle("");
  }

  const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {open} open of {tasks.length}.
        </p>
        {tasks.length > 1 && (
          <label className="text-xs text-muted-foreground">
            Sort by{" "}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded border bg-background px-1.5 py-0.5 text-xs text-foreground"
            >
              <option value="order">Order</option>
              <option value="due">Due date</option>
              <option value="priority">Priority</option>
            </select>
          </label>
        )}
      </div>

      {canEdit && (
        <div className="rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={title}
              placeholder="What needs doing?"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              {more ? "Less" : "Details"}
            </button>
            <button
              type="button"
              disabled={!title.trim() || busy}
              onClick={submit}
              className="inline-flex items-center gap-1.5 rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>

          {more && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-muted-foreground">
                Status
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.value as TaskStatus })
                  }
                  className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
                >
                  {STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Priority
                <select
                  value={draft.priority}
                  onChange={(e) =>
                    setDraft({ ...draft, priority: e.target.value as TaskPriority })
                  }
                  className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Assignee
                <select
                  value={draft.assignee_id}
                  onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value })}
                  className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
                >
                  <option value="">Nobody yet</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name || m.email || m.user_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Due
                <input
                  type="date"
                  value={draft.due}
                  onChange={(e) => setDraft({ ...draft, due: e.target.value })}
                  className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Starts
                <input
                  type="date"
                  value={draft.start}
                  onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                  className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Ends
                <input
                  type="date"
                  value={draft.end}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                  className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-sm text-foreground"
                />
              </label>
              <label className="flex items-end gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draft.milestone}
                  onChange={(e) => setDraft({ ...draft, milestone: e.target.checked })}
                  className="mb-1.5"
                />
                <span className="mb-1">Milestone</span>
              </label>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? "No tasks yet. Add the first one above, then drag it onto the canvas."
            : "No tasks on this project yet."}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const shut = collapsed.has(group.id);
            return (
              <section key={group.id} className="overflow-hidden rounded-xl border">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted"
                >
                  {shut ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  {group.label}
                  <span className="text-xs font-normal text-muted-foreground">
                    {group.tasks.length}
                  </span>
                </button>
                {!shut && (
                  <ul>
                    {group.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        parentTitle={
                          task.parent_task_id
                            ? titles.get(task.parent_task_id) ?? null
                            : null
                        }
                        members={members}
                        canEdit={canEdit}
                        busy={busy}
                        onPatch={(body) => patch.mutate({ id: task.id, body })}
                        onDelete={() => remove.mutate(task.id)}
                        onAddSub={(subTitle) =>
                          create.mutate({
                            title: subTitle,
                            project_id: projectId,
                            parent_task_id: task.id,
                            status: "todo",
                          })
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {!canEdit && tasks.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          You can read this project but not change it.
        </p>
      )}
    </div>
  );
}
