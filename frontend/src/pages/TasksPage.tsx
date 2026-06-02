import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Plus, Check, Circle, Clock, AlertCircle, Tag, ChevronRight, FolderOpen, LayoutList, Columns2, ListChecks, Trash2, MoveRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { listTasks, createTask, updateTask, deleteTask, listProjects } from "@/api/tasks";
import type { Task, TaskStatus, TaskPriority, TaskCreate } from "@/types/tasks";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";

const STATUS_ICONS: Record<TaskStatus, React.ReactNode> = {
  backlog: <Circle className="h-4 w-4 text-muted-foreground" />,
  todo: <Circle className="h-4 w-4 text-blue-500" />,
  in_progress: <Clock className="h-4 w-4 text-yellow-500" />,
  in_review: <AlertCircle className="h-4 w-4 text-orange-500" />,
  done: <Check className="h-4 w-4 text-green-500" />,
  cancelled: <Circle className="h-4 w-4 text-muted-foreground/50" />,
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "text-slate-400",
  medium: "text-blue-400",
  high: "text-orange-400",
  critical: "text-red-500 font-semibold",
};

function NewTaskForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");

  const mutation = useMutation({
    mutationFn: (body: TaskCreate) => createTask(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    mutation.mutate({
      title: title.trim(),
      priority,
      due_date: dueDate || undefined,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-card p-4 space-y-3 shadow-sm"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title…"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex gap-3">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending || !title.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {mutation.isPending ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

function TaskRow({
  task,
  onOpen,
  subtaskCount = 0,
  selected,
  onToggleSelect,
}: {
  task: Task;
  onOpen: () => void;
  subtaskCount?: number;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const qc = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (newStatus: TaskStatus) =>
      updateTask(task.id, { status: newStatus }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const nextStatus: Record<TaskStatus, TaskStatus> = {
    backlog: "todo",
    todo: "in_progress",
    in_progress: "in_review",
    in_review: "done",
    done: "done",
    cancelled: "cancelled",
  };

  const isOverdue =
    task.due_date &&
    task.status !== "done" &&
    task.status !== "cancelled" &&
    new Date(task.due_date) < new Date();

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-md border bg-card px-4 py-3 transition-colors hover:bg-accent/30 cursor-pointer",
        task.status === "done" && "opacity-60",
        selected && "border-primary/50 bg-primary/5"
      )}
      onClick={onOpen}
    >
      {/* Checkbox for bulk select */}
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(task.id); }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
        />
      )}
      {/* Status toggle — stops propagation so clicking it doesn't open drawer */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          statusMutation.mutate(nextStatus[task.status]);
        }}
        className="shrink-0 hover:scale-110 transition-transform"
        title={`Mark as ${STATUS_LABELS[nextStatus[task.status]]}`}
      >
        {STATUS_ICONS[task.status]}
      </button>

      <div className="flex-1 min-w-0">
        <span
          className={cn(
            "text-sm",
            task.status === "done" && "line-through text-muted-foreground"
          )}
        >
          {task.title}
        </span>
        {task.description && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {task.description}
          </p>
        )}
        {/* subtask badge */}
        {subtaskCount > 0 && (
          <span className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <ListChecks className="h-2.5 w-2.5" />
            {subtaskCount} subtask{subtaskCount > 1 ? "s" : ""}
          </span>
        )}
        {task.tags.length > 0 && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            {task.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              >
                <Tag className="h-2 w-2" />
                {tag}
              </span>
            ))}
            {task.tags.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{task.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <span className={cn("text-xs", PRIORITY_COLORS[task.priority])}>
          {task.priority}
        </span>
        {task.due_date && (
          <span
            className={cn(
              "text-xs",
              isOverdue ? "text-destructive font-medium" : "text-muted-foreground"
            )}
          >
            {new Date(task.due_date).toLocaleDateString()}
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

// ── Kanban board ───────────────────────────────────────────────────────────────

const KANBAN_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "In Review" },
  { status: "done", label: "Done" },
];

const COLUMN_COLORS: Record<TaskStatus, string> = {
  backlog: "border-t-slate-400",
  todo: "border-t-blue-400",
  in_progress: "border-t-yellow-400",
  in_review: "border-t-orange-400",
  done: "border-t-green-500",
  cancelled: "border-t-muted",
};

function KanbanCard({
  task,
  onOpen,
  subtaskCount,
  onDragStart,
}: {
  task: Task;
  onOpen: () => void;
  subtaskCount: number;
  onDragStart: (id: string) => void;
}) {
  const isOverdue =
    task.due_date &&
    task.status !== "done" &&
    task.status !== "cancelled" &&
    new Date(task.due_date) < new Date();

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart(task.id);
      }}
      onClick={onOpen}
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:bg-accent/30 transition-all space-y-1.5",
        task.status === "done" && "opacity-60"
      )}
    >
      <p
        className={cn(
          "text-sm font-medium leading-snug",
          task.status === "done" && "line-through text-muted-foreground"
        )}
      >
        {task.title}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("text-[10px] font-medium", PRIORITY_COLORS[task.priority])}>
          {task.priority}
        </span>
        {task.due_date && (
          <span
            className={cn(
              "text-[10px]",
              isOverdue ? "text-destructive font-medium" : "text-muted-foreground"
            )}
          >
            {new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
        {subtaskCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <ListChecks className="h-2.5 w-2.5" />
            {subtaskCount}
          </span>
        )}
      </div>
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
            >
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{task.tags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}

function KanbanBoard({
  tasks,
  allTasks,
  onOpen,
}: {
  tasks: Task[];
  allTasks: Task[];
  onOpen: (task: Task) => void;
}) {
  const qc = useQueryClient();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      updateTask(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  function handleDrop(colStatus: TaskStatus) {
    if (!draggingId) return;
    const task = tasks.find((t) => t.id === draggingId);
    if (task && task.status !== colStatus) {
      statusMutation.mutate({ id: draggingId, status: colStatus });
    }
    setDraggingId(null);
    setDragOverCol(null);
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1"
      onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
    >
      {KANBAN_COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.status);
        const isOver = dragOverCol === col.status;
        return (
          <div
            key={col.status}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.status); }}
            onDragLeave={(e) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) {
                setDragOverCol(null);
              }
            }}
            onDrop={(e) => { e.preventDefault(); handleDrop(col.status); }}
            className={cn(
              "flex flex-col gap-2 rounded-xl border-t-2 bg-muted/30 p-3 min-w-[220px] w-[220px] shrink-0 transition-colors",
              COLUMN_COLORS[col.status],
              isOver && "bg-primary/10 ring-2 ring-primary/30"
            )}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-0.5 mb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {col.label}
              </span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {colTasks.length}
              </span>
            </div>

            {/* Cards */}
            {colTasks.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                onOpen={() => onOpen(task)}
                subtaskCount={allTasks.filter((t) => t.parent_task_id === task.id).length}
                onDragStart={setDraggingId}
              />
            ))}

            {colTasks.length === 0 && (
              <p className={cn(
                "rounded-lg border border-dashed py-6 text-center text-[11px] text-muted-foreground/50",
                isOver && "border-primary/40 text-primary/50"
              )}>
                {isOver ? "Drop here" : "Empty"}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNewTask, setShowNewTask] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<TaskStatus>("todo");
  const [bulkProject, setBulkProject] = useState("");
  const qcBulk = useQueryClient();

  // View preference
  const [view, setView] = useState<"list" | "kanban">(() => {
    try { return (localStorage.getItem("tasks-view") as "list" | "kanban") || "list"; }
    catch { return "list"; }
  });

  function switchView(v: "list" | "kanban") {
    setView(v);
    try { localStorage.setItem("tasks-view", v); } catch { /* ignore */ }
  }

  // Project filter — seeded from URL ?project_id=
  const [projectFilter, setProjectFilter] = useState<string>(
    searchParams.get("project_id") ?? ""
  );

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
    staleTime: 60_000,
  });

  function handleProjectFilterChange(value: string) {
    setProjectFilter(value);
    if (value) {
      setSearchParams({ project_id: value });
    } else {
      setSearchParams({});
    }
  }

  const filtered = tasks.filter((t) => {
    const statusMatch =
      filterStatus === "active"
        ? t.status !== "done" && t.status !== "cancelled"
        : filterStatus === "done"
          ? t.status === "done"
          : true;
    const projectMatch = projectFilter ? t.project_id === projectFilter : true;
    return statusMatch && projectMatch;
  });

  const counts = {
    active: tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue: tasks.filter(
      (t) =>
        t.due_date &&
        t.status !== "done" &&
        t.status !== "cancelled" &&
        new Date(t.due_date) < new Date()
    ).length,
  };

  // Keep selectedTask in sync with latest cached data
  const liveSelectedTask =
    selectedTask ? (tasks.find((t) => t.id === selectedTask.id) ?? selectedTask) : null;

  // Bulk action helpers
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  async function bulkUpdateStatus() {
    await Promise.all([...selectedIds].map((id) => updateTask(id, { status: bulkStatus })));
    qcBulk.invalidateQueries({ queryKey: ["tasks"] });
    clearSelection();
  }

  async function bulkMoveProject() {
    if (!bulkProject) return;
    await Promise.all([...selectedIds].map((id) => updateTask(id, { project_id: bulkProject })));
    qcBulk.invalidateQueries({ queryKey: ["tasks"] });
    clearSelection();
  }

  async function bulkDelete() {
    if (!window.confirm(`Delete ${selectedIds.size} task${selectedIds.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    await Promise.all([...selectedIds].map((id) => deleteTask(id)));
    qcBulk.invalidateQueries({ queryKey: ["tasks"] });
    clearSelection();
  }

  const activeProjectName = projectFilter
    ? (projects.find((p) => p.id === projectFilter)?.name ?? "")
    : "";

  // Top-level tasks only (no subtasks in main list/kanban)
  const topLevel = filtered.filter((t) => t.parent_task_id === null);

  // Subtask counts per parent for badges
  const subtaskCounts: Record<string, number> = {};
  for (const t of tasks) {
    if (t.parent_task_id) {
      subtaskCounts[t.parent_task_id] = (subtaskCounts[t.parent_task_id] ?? 0) + 1;
    }
  }

  return (
    <div className={cn("flex flex-col gap-6 p-6 mx-auto", view === "kanban" ? "max-w-full" : "max-w-4xl")}>
      {/* Task detail drawer */}
      {liveSelectedTask && (
        <TaskDrawer
          task={liveSelectedTask}
          onClose={() => setSelectedTask(null)}
          onDeleted={() => setSelectedTask(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {activeProjectName ? (
              <span className="flex items-center gap-2">
                <FolderOpen className="h-6 w-6 text-primary" />
                {activeProjectName}
              </span>
            ) : (
              "Tasks"
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {counts.active} active · {counts.done} done
            {counts.overdue > 0 && (
              <span className="text-destructive ml-2">· {counts.overdue} overdue</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1 rounded-lg border bg-muted p-1">
            <button
              onClick={() => switchView("list")}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                view === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              title="List view"
            >
              <LayoutList className="h-4 w-4" />
            </button>
            <button
              onClick={() => switchView("kanban")}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                view === "kanban" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              title="Kanban board"
            >
              <Columns2 className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setShowNewTask(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Task
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tabs — hidden in kanban (columns serve as status filter) */}
        {view === "list" && (
          <div className="flex gap-1 rounded-lg border bg-muted p-1">
            {(["active", "done", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterStatus(f)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  filterStatus === f
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "active" ? "Active" : f === "done" ? "Completed" : "All"}
              </button>
            ))}
          </div>
        )}

        {/* Project filter */}
        {projects.length > 0 && (
          <select
            value={projectFilter}
            onChange={(e) => handleProjectFilterChange(e.target.value)}
            className="rounded-md border bg-background px-2.5 py-1.5 text-sm"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {/* Clear project filter badge */}
        {projectFilter && (
          <button
            onClick={() => handleProjectFilterChange("")}
            className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
          >
            <FolderOpen className="h-3 w-3" />
            {activeProjectName}
            <span className="ml-0.5 text-primary/60">×</span>
          </button>
        )}
      </div>

      {/* New task form */}
      {showNewTask && <NewTaskForm onClose={() => setShowNewTask(false)} />}

      {/* Content */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Loading tasks…</div>
      ) : view === "kanban" ? (
        <KanbanBoard
          tasks={topLevel}
          allTasks={tasks}
          onOpen={setSelectedTask}
        />
      ) : topLevel.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          {filterStatus === "active" ? (
            <>
              <p className="font-medium">No active tasks</p>
              <p className="text-sm mt-1">Create one or ask the AI Assistant to create tasks for you.</p>
            </>
          ) : (
            <p>No tasks found</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {topLevel.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={() => setSelectedTask(task)}
              subtaskCount={subtaskCounts[task.id] ?? 0}
              selected={selectedIds.has(task.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border bg-popover px-4 py-3 shadow-2xl">
          <span className="text-sm font-medium text-muted-foreground">
            {selectedIds.size} selected
          </span>
          <div className="h-4 w-px bg-border" />
          {/* Status change */}
          <div className="flex items-center gap-1.5">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value as TaskStatus)}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="in_review">In Review</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button
              onClick={bulkUpdateStatus}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90"
            >
              <Check className="h-3 w-3" /> Set status
            </button>
          </div>
          {/* Move to project */}
          {projects.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                value={bulkProject}
                onChange={(e) => setBulkProject(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-xs"
              >
                <option value="">Move to…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {bulkProject && (
                <button
                  onClick={bulkMoveProject}
                  className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                >
                  <MoveRight className="h-3 w-3" /> Move
                </button>
              )}
            </div>
          )}
          <div className="h-4 w-px bg-border" />
          {/* Delete */}
          <button
            onClick={bulkDelete}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
          {/* Clear */}
          <button onClick={clearSelection} className="text-xs text-muted-foreground hover:underline ml-1">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
