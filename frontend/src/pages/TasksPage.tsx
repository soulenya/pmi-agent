import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Plus, Check, Circle, Clock, AlertCircle, Tag, ChevronRight, FolderOpen, LayoutList, Columns2, ListChecks, Trash2, MoveRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWhen } from "@/lib/formatWhen";
import { updateTask, deleteTask } from "@/api/tasks";
import { getGoogleStatus, listGoogleTasks, importGoogleTasks } from "@/api/google";
import type { TaskStatus, TaskPriority } from "@/types/tasks";
import type { GoogleTask } from "@/api/google";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { TaskCreateForm } from "@/components/tasks/TaskCreateForm";
import { TaskSourceActions, sourceSummary } from "@/components/tasks/TaskSourceActions";
import { AskGerryButton } from "@/components/AskGerryButton";
import { HubBadge } from "@/components/HubBadge";
import { ScheduledTasksPage } from "@/pages/ScheduledTasksPage";
import {
  useAllProjects,
  useAllTasks,
  useInvalidateTasks,
  type SourcedTask,
} from "@/hooks/useAllWork";

type Task = SourcedTask;
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
  const invalidate = useInvalidateTasks();

  const statusMutation = useMutation({
    mutationFn: (newStatus: TaskStatus) =>
      updateTask(task.id, { status: newStatus }, task.source),
    onSuccess: invalidate,
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
        <HubBadge source={task.source} className="ml-2 align-middle" />
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
        <TaskSourceActions task={task} className="mt-2" />
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
            {formatWhen(task.due_date, { overdue: !!isOverdue })}
          </span>
        )}
        <AskGerryButton
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          build={() => ({
            title: `Task: ${task.title}`,
            prompt:
              `I'd like your help with this task.\n\n` +
              `Title: ${task.title}\n` +
              `Status: ${task.status}\n` +
              `Priority: ${task.priority}` +
              (task.due_date ? `\nDue: ${new Date(task.due_date).toLocaleDateString()}` : "") +
              (task.tags.length ? `\nTags: ${task.tags.join(", ")}` : "") +
              (task.source_ref ? `\n${sourceSummary(task.source_ref)}` : "") +
              (task.description ? `\n\nDescription:\n${task.description}` : "") +
              `\n\nWhat can you tell me about it, and how should I approach it?`,
          })}
        />
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
        <HubBadge source={task.source} />
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
            {formatWhen(task.due_date, { overdue: !!isOverdue })}
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
      <TaskSourceActions task={task} />
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
  const invalidate = useInvalidateTasks();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  const statusMutation = useMutation({
    mutationFn: ({ task, status }: { task: Task; status: TaskStatus }) =>
      updateTask(task.id, { status }, task.source),
    onSuccess: invalidate,
  });

  function handleDrop(colStatus: TaskStatus) {
    if (!draggingId) return;
    const task = tasks.find((t) => t.id === draggingId);
    if (task && task.status !== colStatus) {
      statusMutation.mutate({ task, status: colStatus });
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

// ── Google Tasks Import Modal ────────────────────────────────────────────────

function GoogleTasksImportModal({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidateTasks();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: googleTasks = [], isLoading } = useQuery({
    queryKey: ["google-tasks-list"],
    queryFn: () => listGoogleTasks(50, false),
  });

  const importMutation = useMutation({
    mutationFn: () => importGoogleTasks(Array.from(selectedIds)),
    onSuccess: (result) => {
      invalidate();
      onClose();
      console.info(`Imported ${result.imported} tasks from Google Tasks`);
    },
  });

  function toggleTask(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex flex-col w-[520px] max-h-[70vh] bg-background rounded-xl border shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Import from Google Tasks</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <AlertCircle className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : googleTasks.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">No tasks found.</p>
          ) : (
            <div className="divide-y">
              {googleTasks.map((task: GoogleTask) => (
                <label key={task.id} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(task.id)}
                    onChange={() => toggleTask(task.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{task.title}</p>
                    {task.due && (
                      <p className="text-xs text-muted-foreground">
                        Due: {new Date(task.due).toLocaleDateString()}
                      </p>
                    )}
                    {task.notes && (
                      <p className="text-xs text-muted-foreground truncate">{task.notes}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
            <button
              onClick={() => importMutation.mutate()}
              disabled={selectedIds.size === 0 || importMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {importMutation.isPending ? "Importing…" : `Import ${selectedIds.size > 0 ? selectedIds.size : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Routines are Gerry's standing jobs; they share this page so "task" means one thing in the rail.
  const tab = searchParams.get("tab") === "routines" ? "routines" : "tasks";
  const [showNewTask, setShowNewTask] = useState(searchParams.get("new") === "1");
  const [showGoogleImport, setShowGoogleImport] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<TaskStatus>("todo");
  const [bulkProject, setBulkProject] = useState("");
  const invalidate = useInvalidateTasks();

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

  const { tasks, isLoading } = useAllTasks();
  const { projects } = useAllProjects();

  const { data: googleStatus } = useQuery({
    queryKey: ["google-status"],
    queryFn: getGoogleStatus,
    staleTime: 60_000,
  });

  // ?task=<id> — arriving from the dashboard or a notification opens that task.
  useEffect(() => {
    const id = searchParams.get("task");
    if (!id) return;
    const match = tasks.find((t) => t.id === id);
    if (!match) return;
    setSelectedTask(match);
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, tasks]);

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

  const chosen = () => tasks.filter((t) => selectedIds.has(t.id));

  async function bulkUpdateStatus() {
    await Promise.all(chosen().map((t) => updateTask(t.id, { status: bulkStatus }, t.source)));
    invalidate();
    clearSelection();
  }

  // A task can only be moved into a project that lives where it does.
  const bulkTarget = projects.find((p) => p.id === bulkProject);
  const movable = bulkTarget ? chosen().filter((t) => t.source === bulkTarget.source) : [];

  async function bulkMoveProject() {
    if (!bulkTarget) return;
    await Promise.all(movable.map((t) => updateTask(t.id, { project_id: bulkProject }, t.source)));
    invalidate();
    clearSelection();
  }

  async function bulkDelete() {
    if (!window.confirm(`Delete ${selectedIds.size} task${selectedIds.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    await Promise.all(chosen().map((t) => deleteTask(t.id, t.source)));
    invalidate();
    clearSelection();
  }

  const activeProject = projectFilter ? projects.find((p) => p.id === projectFilter) : undefined;
  const activeProjectName = activeProject?.name ?? "";

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
      {/* Tasks | Routines */}
      <div className="flex gap-1 rounded-lg border bg-muted p-1 self-start">
        {(["tasks", "routines"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (t === "routines") next.set("tab", "routines");
              else next.delete("tab");
              setSearchParams(next);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "tasks" ? "Tasks" : "Routines"}
          </button>
        ))}
      </div>

      {tab === "routines" ? (
        <ScheduledTasksPage />
      ) : (
        <>
      {/* Task detail drawer */}
      {liveSelectedTask && (
        <TaskDrawer
          task={liveSelectedTask}
          source={liveSelectedTask.source}
          onClose={() => setSelectedTask(null)}
          onDeleted={() => setSelectedTask(null)}
        />
      )}

      {/* Google Tasks Import modal */}
      {showGoogleImport && (
        <GoogleTasksImportModal onClose={() => setShowGoogleImport(false)} />
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
          {googleStatus?.connected && (
            <button
              onClick={() => setShowGoogleImport(true)}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              Import from Google Tasks
            </button>
          )}
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
              <option key={p.id} value={p.id}>
                {p.name}{p.source === "hub" ? " · hub" : ""}
              </option>
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
      {showNewTask && (
        <TaskCreateForm
          projectId={activeProject?.id ?? null}
          onCreated={() => setShowNewTask(false)}
          onCancel={() => setShowNewTask(false)}
          className="rounded-lg border bg-card p-4 shadow-sm"
        />
      )}

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
                  <option key={p.id} value={p.id}>
                    {p.name}{p.source === "hub" ? " · hub" : ""}
                  </option>
                ))}
              </select>
              {bulkProject && (
                <button
                  onClick={bulkMoveProject}
                  disabled={movable.length === 0}
                  title={
                    movable.length < selectedIds.size
                      ? "Only tasks that already live where that project does can move into it"
                      : undefined
                  }
                  className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                >
                  <MoveRight className="h-3 w-3" /> Move{movable.length < selectedIds.size ? ` ${movable.length}` : ""}
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
        </>
      )}
    </div>
  );
}
