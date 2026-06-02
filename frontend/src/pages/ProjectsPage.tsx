import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import {
  FolderOpen,
  Plus,
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listProjects, createProject, listTasks } from "@/api/tasks";
import type { Project, Task, TaskStatus, ProjectCreate } from "@/types/tasks";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_DONE: TaskStatus[] = ["done", "cancelled"];

function taskProgress(tasks: Task[]): { done: number; total: number; pct: number } {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

function statusIcon(status: TaskStatus) {
  const map: Record<TaskStatus, React.ReactNode> = {
    backlog: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
    todo: <Circle className="h-3.5 w-3.5 text-blue-400" />,
    in_progress: <Clock className="h-3.5 w-3.5 text-yellow-500" />,
    in_review: <AlertCircle className="h-3.5 w-3.5 text-orange-400" />,
    done: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
    cancelled: <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />,
  };
  return map[status];
}

// ── New project form ──────────────────────────────────────────────────────────

function NewProjectForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#1e6db5");
  const [targetDate, setTargetDate] = useState("");

  const mutation = useMutation({
    mutationFn: (body: ProjectCreate) => createProject(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      target_date: targetDate || undefined,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border bg-card p-5 space-y-4 shadow-sm"
    >
      <h3 className="font-semibold text-base">New Project</h3>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium">Name *</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      <div className="flex gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-16 cursor-pointer rounded-md border bg-background"
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Target Date</label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={!name.trim() || mutation.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {mutation.isPending ? "Creating…" : "Create Project"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Project card ──────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  tasks,
}: {
  project: Project;
  tasks: Task[];
}) {
  const { done, total, pct } = taskProgress(tasks);
  const activeTasks = tasks.filter((t) => !STATUS_DONE.includes(t.status));
  const overdue = activeTasks.filter(
    (t) => t.due_date && new Date(t.due_date) < new Date()
  ).length;

  const target = project.target_date
    ? new Date(project.target_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const isOverTarget =
    project.target_date &&
    new Date(project.target_date) < new Date() &&
    project.status !== "completed";

  return (
    <div className="rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow">
      {/* Color bar */}
      <div
        className="h-1.5 w-full rounded-t-xl"
        style={{ backgroundColor: project.color ?? "#1e6db5" }}
      />

      <div className="p-5 space-y-4">
        {/* Title + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <FolderOpen
              className="h-5 w-5 shrink-0"
              style={{ color: project.color ?? "#1e6db5" }}
            />
            <h3 className="font-semibold text-sm leading-snug">{project.name}</h3>
          </div>
          <NavLink
            to={`/tasks?project_id=${project.id}`}
            className="flex items-center gap-1 rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            title="View tasks"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </NavLink>
        </div>

        {project.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
        )}

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {done}/{total} tasks done
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                backgroundColor: project.color ?? "#1e6db5",
              }}
            />
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {target && (
            <span className={cn(isOverTarget && "text-destructive font-medium")}>
              Target: {target}
            </span>
          )}
          {overdue > 0 && (
            <span className="text-destructive font-medium">
              {overdue} overdue
            </span>
          )}
          {activeTasks.length > 0 && (
            <span>{activeTasks.length} open</span>
          )}
        </div>

        {/* Recent tasks preview */}
        {activeTasks.length > 0 && (
          <div className="space-y-1 border-t pt-3">
            {activeTasks.slice(0, 3).map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs">
                {statusIcon(t.status)}
                <span className="truncate text-foreground/80">{t.title}</span>
              </div>
            ))}
            {activeTasks.length > 3 && (
              <p className="text-xs text-muted-foreground pl-5">
                +{activeTasks.length - 3} more
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const [showForm, setShowForm] = useState(false);

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(false),
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
    staleTime: 30_000,
  });

  const tasksByProject = (projectId: string) =>
    allTasks.filter((t) => t.project_id === projectId);

  const unassigned = allTasks.filter((t) => !t.project_id);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track progress across all active projects
          </p>
        </div>
        <button
          onClick={() => setShowForm((x) => !x)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {/* Form */}
      {showForm && <NewProjectForm onClose={() => setShowForm(false)} />}

      {/* Stats */}
      {!projectsLoading && projects.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Projects</p>
            <p className="text-2xl font-bold mt-1">{projects.length}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Open Tasks</p>
            <p className="text-2xl font-bold mt-1">
              {allTasks.filter((t) => !STATUS_DONE.includes(t.status)).length}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Unassigned Tasks</p>
            <p className={cn("text-2xl font-bold mt-1", unassigned.length > 0 && "text-amber-500")}>
              {unassigned.length}
            </p>
          </div>
        </div>
      )}

      {/* Project grid */}
      {projectsLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <FolderOpen className="h-10 w-10 opacity-30" />
          <p className="text-sm">No projects yet.</p>
          <p className="text-xs">
            Click <span className="font-medium">New Project</span> to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} tasks={tasksByProject(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
