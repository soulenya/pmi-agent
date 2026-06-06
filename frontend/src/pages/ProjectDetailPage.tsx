import { useState } from "react";
import { useParams, useNavigate, NavLink } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Circle,
  Clock,
  AlertCircle,
  FolderOpen,
  Plus,
  Loader2,
  CalendarDays,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProject, listTasks, createTask, updateTask } from "@/api/tasks";
import type { Task, TaskStatus, TaskPriority, TaskCreate } from "@/types/tasks";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const STATUS_ORDER: TaskStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "backlog",
  "done",
  "cancelled",
];

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "text-slate-400",
  medium: "text-blue-400",
  high: "text-orange-400",
  critical: "text-red-500 font-semibold",
};

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Quick add form ────────────────────────────────────────────────────────────

function QuickAddTaskForm({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");

  const mutation = useMutation({
    mutationFn: (body: TaskCreate) => createTask(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      setTitle("");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    mutation.mutate({ title: title.trim(), project_id: projectId, priority });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="New task title…"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as TaskPriority)}
        className="rounded border bg-background px-1.5 py-1 text-xs"
      >
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <button
        type="submit"
        disabled={!title.trim() || mutation.isPending}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </form>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  onClick,
}: {
  task: Task;
  onClick: () => void;
}) {
  const qc = useQueryClient();
  const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
    backlog: "todo",
    todo: "in_progress",
    in_progress: "in_review",
    in_review: "done",
    done: "done",
    cancelled: "cancelled",
  };

  const cycleMutation = useMutation({
    mutationFn: () =>
      updateTask(task.id, { status: STATUS_CYCLE[task.status] }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["project-tasks", task.project_id] }),
  });

  const isOverdue =
    task.due_date &&
    new Date(task.due_date) < new Date() &&
    task.status !== "done" &&
    task.status !== "cancelled";

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/30 transition-colors">
      <button
        onClick={(e) => {
          e.stopPropagation();
          cycleMutation.mutate();
        }}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        title={`Status: ${STATUS_LABELS[task.status]}`}
      >
        {STATUS_ICONS[task.status]}
      </button>

      <button
        className="flex-1 min-w-0 text-left"
        onClick={onClick}
      >
        <span
          className={cn(
            "text-sm",
            (task.status === "done" || task.status === "cancelled") &&
              "line-through text-muted-foreground"
          )}
        >
          {task.title}
        </span>
      </button>

      <div className="flex items-center gap-3 shrink-0">
        <span
          className={cn(
            "text-xs capitalize",
            PRIORITY_COLORS[task.priority]
          )}
        >
          {task.priority}
        </span>
        {task.due_date && (
          <span
            className={cn(
              "text-xs",
              isOverdue ? "text-destructive font-medium" : "text-muted-foreground"
            )}
          >
            {formatDate(task.due_date)}
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
    enabled: !!id,
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["project-tasks", id],
    queryFn: () => listTasks({ project_id: id }),
    enabled: !!id,
  });

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading project…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <p>Project not found.</p>
        <NavLink to="/projects" className="text-sm text-primary hover:underline">
          ← Back to Projects
        </NavLink>
      </div>
    );
  }

  const topLevel = tasks.filter((t) => !t.parent_task_id);
  const totalTasks = topLevel.length;
  const doneTasks = topLevel.filter((t) => t.status === "done").length;
  const pct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  // Group top-level tasks by status, in preferred order
  const byStatus: Record<string, Task[]> = {};
  for (const s of STATUS_ORDER) byStatus[s] = [];
  for (const t of topLevel) {
    if (byStatus[t.status]) byStatus[t.status].push(t);
  }

  const targetDate = formatDate(project.target_date);
  const isOverTarget =
    project.target_date &&
    new Date(project.target_date) < new Date() &&
    project.status !== "completed";

  const PROJECT_STATUS_STYLES: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    on_hold: "bg-yellow-100 text-yellow-700",
    completed: "bg-blue-100 text-blue-700",
    archived: "bg-muted text-muted-foreground",
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Back nav */}
      <button
        onClick={() => navigate("/projects")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit"
      >
        <ArrowLeft className="h-4 w-4" />
        All Projects
      </button>

      {/* Project header */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {/* Color bar */}
        <div
          className="h-2 w-full"
          style={{ backgroundColor: project.color ?? "#1e6db5" }}
        />
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <FolderOpen
                className="h-6 w-6 shrink-0"
                style={{ color: project.color ?? "#1e6db5" }}
              />
              <h1 className="text-xl font-bold leading-snug truncate">
                {project.name}
              </h1>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                PROJECT_STATUS_STYLES[project.status] ??
                  PROJECT_STATUS_STYLES.active
              )}
            >
              {project.status.replace("_", " ")}
            </span>
          </div>

          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}

          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            {targetDate && (
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                <span className={cn(isOverTarget && "text-destructive font-medium")}>
                  Target: {targetDate}
                </span>
              </div>
            )}
            <span>{totalTasks} tasks total</span>
            <span className="text-green-600 font-medium">{doneTasks} done</span>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  backgroundColor: project.color ?? "#1e6db5",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tasks section */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">Tasks</h2>
          <button
            onClick={() => setShowAddTask((x) => !x)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </button>
        </div>

        <div className="p-3 space-y-1">
          {showAddTask && (
            <div className="mb-3">
              <QuickAddTaskForm
                projectId={project.id}
                onClose={() => setShowAddTask(false)}
              />
            </div>
          )}

          {tasksLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading tasks…
            </div>
          ) : totalTasks === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No tasks yet. Add the first one above.
            </p>
          ) : (
            STATUS_ORDER.filter((s) => byStatus[s].length > 0).map((status) => (
              <div key={status}>
                {/* Status group header */}
                <div className="flex items-center gap-2 px-3 py-1.5 mt-2 first:mt-0">
                  {STATUS_ICONS[status]}
                  <span className="text-xs font-medium text-muted-foreground">
                    {STATUS_LABELS[status]}{" "}
                    <span className="text-muted-foreground/60">
                      ({byStatus[status].length})
                    </span>
                  </span>
                </div>
                {byStatus[status].map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onClick={() => setSelectedTask(task)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Task drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onDeleted={() => setSelectedTask(null)}

        />
      )}
    </div>
  );
}
