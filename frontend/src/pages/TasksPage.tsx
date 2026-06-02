import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Plus, Check, Circle, Clock, AlertCircle, Tag, ChevronRight, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { listTasks, createTask, updateTask, listProjects } from "@/api/tasks";
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
}: {
  task: Task;
  onOpen: () => void;
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
        task.status === "done" && "opacity-60"
      )}
      onClick={onOpen}
    >
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

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNewTask, setShowNewTask] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

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

  const activeProjectName = projectFilter
    ? (projects.find((p) => p.id === projectFilter)?.name ?? "")
    : "";

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
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
        <button
          onClick={() => setShowNewTask(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Task
        </button>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tabs */}
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

      {/* Task list */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Loading tasks…</div>
      ) : filtered.length === 0 ? (
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
          {filtered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={() => setSelectedTask(task)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
