import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, Circle, Clock, AlertCircle, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { listTasks, createTask, updateTask, deleteTask } from "@/api/tasks";
import { listProjects, createProject } from "@/api/tasks";
import type { Task, TaskStatus, TaskPriority, TaskCreate } from "@/types/tasks";

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

function TaskRow({ task }: { task: Task }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const statusMutation = useMutation({
    mutationFn: (newStatus: TaskStatus) =>
      updateTask(task.id, { status: newStatus }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
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
    <div className={cn("group rounded-md border bg-card px-4 py-3 transition-colors hover:bg-accent/30", task.status === "done" && "opacity-60")}>
      <div className="flex items-center gap-3">
        <button
          onClick={() => statusMutation.mutate(nextStatus[task.status])}
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
          <select
            value={task.status}
            onChange={(e) => statusMutation.mutate(e.target.value as TaskStatus)}
            className="text-xs rounded border bg-background px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (confirm("Delete this task?")) deleteMutation.mutate();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TasksPage() {
  const qc = useQueryClient();
  const [showNewTask, setShowNewTask] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("active");

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
  });

  const filtered = tasks.filter((t) => {
    if (filterStatus === "active") return t.status !== "done" && t.status !== "cancelled";
    if (filterStatus === "done") return t.status === "done";
    return true;
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

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
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

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted p-1 w-fit">
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
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
