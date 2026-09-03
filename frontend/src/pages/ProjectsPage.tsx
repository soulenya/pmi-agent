import { useEffect, useState } from "react";
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
  Layers,
  Pencil,
  X,
  Archive,
  Loader2,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listProjects, createProject, updateProject, listTasks } from "@/api/tasks";
import type { Source } from "@/api/tasks";
import { getHubStatus } from "@/api/hub";
import type { Project, Task, TaskStatus, ProjectCreate, ProjectUpdate } from "@/types/tasks";
import { AskGerryButton } from "@/components/AskGerryButton";
// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_DONE: TaskStatus[] = ["done", "cancelled"];

function errorMessage(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (err instanceof Error && err.message) return err.message;
  return "Please try again.";
}

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

// ── Edit project modal ────────────────────────────────────────────────────────

const PROJECT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];

function EditProjectModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [color, setColor] = useState(project.color ?? "#1e6db5");
  const [targetDate, setTargetDate] = useState(
    project.target_date ? project.target_date.slice(0, 10) : ""
  );
  const [status, setStatus] = useState(project.status);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveMutation = useMutation({
    mutationFn: (body: ProjectUpdate) => updateProject(project.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => updateProject(project.id, { is_archived: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    saveMutation.mutate({
      name: name.trim(),
      description: description.trim() || null,
      color,
      target_date: targetDate || null,
      status,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-sm">Edit Project</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Status + Color */}
          <div className="flex gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Color</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-16 cursor-pointer rounded-md border bg-background"
              />
            </div>
          </div>

          {/* Target date */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Target Date</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => {
                if (confirm("Archive this project? It will be hidden from the main view.")) {
                  archiveMutation.mutate();
                }
              }}
              disabled={archiveMutation.isPending}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              {archiveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
              Archive
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || saveMutation.isPending}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
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

      {mutation.isError && (
        // Without this a failed save looks exactly like nothing happening.
        <p className="text-sm text-destructive">
          Could not create the project. {errorMessage(mutation.error)}
        </p>
      )}
    </form>
  );
}

// ── Project card ──────────────────────────────────────────────────────────────

const PROJECT_STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  on_hold: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
};

function ProjectCard({
  project,
  tasks,
  onEdit,
  source = "local",
}: {
  project: Project;
  tasks: Task[];
  onEdit: () => void;
  source?: Source;
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

  // A hub project is opened through the hub space; it has no local detail page.
  const detailTo =
    source === "hub" ? `/hub/projects/${project.id}/space` : `/projects/${project.id}`;
  const spaceTo =
    source === "hub" ? `/hub/projects/${project.id}/space` : `/projects/${project.id}/space`;

  return (
    <div className="group rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow">
      {/* Color bar */}
      <div
        className="h-1.5 w-full rounded-t-xl"
        style={{ backgroundColor: project.color ?? "#1e6db5" }}
      />

      <div className="p-5 space-y-4">
        {/* Title + actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
              <FolderOpen
                className="h-5 w-5 shrink-0"
                style={{ color: project.color ?? "#1e6db5" }}
              />
              <NavLink
                to={detailTo}
                className="font-semibold text-sm leading-snug truncate hover:underline"
              >
                {project.name}
              </NavLink>
            </div>
          <div className="flex items-center gap-1 shrink-0">
            {source === "local" && (
              <button
                onClick={onEdit}
                className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground transition-opacity"
                title="Edit project"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <AskGerryButton
              className="p-1 opacity-0 group-hover:opacity-100"
              build={() => ({
                title: `Project: ${project.name}`,
                prompt:
                  `I'd like your help with this project.\n\n` +
                  `Name: ${project.name}\n` +
                  `Status: ${project.status}` +
                  (target ? `\nTarget date: ${target}` : "") +
                  `\nProgress: ${done}/${total} tasks done (${pct}%)` +
                  (overdue > 0 ? `\nOverdue tasks: ${overdue}` : "") +
                  (project.description ? `\n\nDescription:\n${project.description}` : "") +
                  (activeTasks.length
                    ? `\n\nOpen tasks:\n${activeTasks
                        .slice(0, 10)
                        .map((t) => `- ${t.title} (${t.status})`)
                        .join("\n")}`
                    : "") +
                  `\n\nGive me a status read and suggest what to focus on next.`,
              })}
            />
            <NavLink
              to={spaceTo}
              className="flex items-center gap-1 rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Open project space"
            >
              <Layers className="h-3.5 w-3.5" />
            </NavLink>
            <NavLink
              to={detailTo}
              className="flex items-center gap-1 rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="View project detail"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </NavLink>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              PROJECT_STATUS_STYLES[project.status] ?? PROJECT_STATUS_STYLES.active
            )}
          >
            {PROJECT_STATUSES.find((s) => s.value === project.status)?.label ?? project.status}
          </span>
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
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(false),
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
    staleTime: 30_000,
  });

  // The hub holds the work the firm shares. It is read over the wire every
  // time, never copied down, so what is shown here is what the hub says now.
  const { data: hubStatus } = useQuery({
    queryKey: ["hub", "status"],
    queryFn: getHubStatus,
    staleTime: 60_000,
    retry: false,
  });
  const hubConnected = hubStatus?.connected === true;

  const { data: hubProjects = [], isLoading: hubLoading } = useQuery({
    queryKey: ["hub", "projects"],
    queryFn: () => listProjects(false, "hub"),
    enabled: hubConnected,
    staleTime: 30_000,
    retry: false,
  });

  const { data: hubTasks = [] } = useQuery({
    queryKey: ["hub", "tasks"],
    queryFn: () => listTasks(undefined, "hub"),
    enabled: hubConnected,
    staleTime: 30_000,
    retry: false,
  });

  const tasksByProject = (projectId: string) =>
    allTasks.filter((t) => t.project_id === projectId);

  const unassigned = allTasks.filter((t) => !t.project_id);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Edit modal */}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track progress across all active projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NavLink
            to="/projects/portfolio"
            className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <Network className="h-4 w-4" />
            Portfolio
          </NavLink>
          <button
            onClick={() => setShowForm((x) => !x)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
        </div>
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
            <ProjectCard
              key={p.id}
              project={p}
              tasks={tasksByProject(p.id)}
              onEdit={() => setEditingProject(p)}
            />
          ))}
        </div>
      )}

      {/* What the firm shares, live from the hub */}
      {hubConnected && (
        <div className="space-y-4 border-t pt-6">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-semibold">Shared on the hub</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Signed in as {hubStatus?.email}. This work lives on the hub, not on
                this computer.
              </p>
            </div>
          </div>
          {hubLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Asking the hub…
            </div>
          ) : hubProjects.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nothing on the hub is shared with you yet.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {hubProjects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  tasks={hubTasks.filter((t) => t.project_id === p.id)}
                  onEdit={() => undefined}
                  source="hub"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
