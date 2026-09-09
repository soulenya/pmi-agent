/**
 * The one way to make a task. Title, project, due, priority and assignee on
 * the face; description, start/end dates, milestone and tags behind "More".
 * The project decides where the task lives (this computer or the hub), so the
 * caller never has to pick a source.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react";

import { createTask, getProjectSpace, type Source } from "@/api/tasks";
import { HubBadge } from "@/components/HubBadge";
import { useAllProjects, useInvalidateTasks } from "@/hooks/useAllWork";
import { cn } from "@/lib/utils";
import type { Task, TaskCreate, TaskPriority } from "@/types/tasks";

export const PRIORITY_OPTIONS: { id: TaskPriority; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "critical", label: "Critical" },
];

/** `<input type="date">` speaks YYYY-MM-DD; the API speaks ISO instants. */
export function fromDayInput(day: string): string | undefined {
  return day ? new Date(`${day}T12:00:00`).toISOString() : undefined;
}

const FIELD = "rounded-md border bg-background px-2 py-1.5 text-sm text-foreground";

export interface TaskPlacement {
  projectId: string;
  due: string;
  priority: TaskPriority;
}

/** The project decides where a task lives; the caller never picks a source. */
export function useProjectSource(projectId: string): Source {
  const { projects } = useAllProjects();
  return projects.find((p) => p.id === projectId)?.source ?? "local";
}

/** Project, due and priority: what every task needs to be placed. */
export function TaskPlacementFields({
  value,
  onChange,
  lockProject = false,
}: {
  value: TaskPlacement;
  onChange: (next: TaskPlacement) => void;
  lockProject?: boolean;
}) {
  const { projects } = useAllProjects();
  const project = projects.find((p) => p.id === value.projectId);
  return (
    <>
      {!lockProject && (
        <select
          value={value.projectId}
          onChange={(e) => onChange({ ...value, projectId: e.target.value })}
          className={cn(FIELD, "max-w-[14rem]")}
          title="Project"
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={`${p.source}-${p.id}`} value={p.id}>
              {p.name}
              {p.source === "hub" ? " (hub)" : ""}
            </option>
          ))}
        </select>
      )}
      <input
        type="date"
        value={value.due}
        onChange={(e) => onChange({ ...value, due: e.target.value })}
        className={FIELD}
        title="Due"
      />
      <select
        value={value.priority}
        onChange={(e) => onChange({ ...value, priority: e.target.value as TaskPriority })}
        className={FIELD}
        title="Priority"
      >
        {PRIORITY_OPTIONS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {!lockProject && project?.source === "hub" && <HubBadge source="hub" />}
    </>
  );
}

export interface TaskCreateFormProps {
  /** Pre-select a project; with `lockProject` the picker is hidden. */
  projectId?: string | null;
  lockProject?: boolean;
  /** Where the locked project lives. Ignored when the picker is shown. */
  source?: Source;
  defaults?: Partial<Pick<TaskCreate, "title" | "description" | "priority" | "due_date" | "tags" | "source_ref" | "parent_task_id">>;
  /** Keep the form open and clear the title after each task (project Tasks tab). */
  stay?: boolean;
  submitLabel?: string;
  onCreated?: (task: Task, source: Source) => void;
  onCancel?: () => void;
  className?: string;
  autoFocus?: boolean;
}

export function TaskCreateForm({
  projectId: initialProjectId = null,
  lockProject = false,
  source: lockedSource = "local",
  defaults,
  stay = false,
  submitLabel = "Create task",
  onCreated,
  onCancel,
  className,
  autoFocus = true,
}: TaskCreateFormProps) {
  const invalidate = useInvalidateTasks();
  const { projects } = useAllProjects();

  const [title, setTitle] = useState(defaults?.title ?? "");
  const [place, setPlace] = useState<TaskPlacement>({
    projectId: initialProjectId ?? "",
    due: defaults?.due_date ? defaults.due_date.slice(0, 10) : "",
    priority: defaults?.priority ?? "medium",
  });
  const projectId = place.projectId;
  const [assigneeId, setAssigneeId] = useState("");
  const [more, setMore] = useState(false);
  const [description, setDescription] = useState(defaults?.description ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [milestone, setMilestone] = useState(false);
  const [tags, setTags] = useState((defaults?.tags ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialProjectId) setPlace((p) => ({ ...p, projectId: initialProjectId }));
  }, [initialProjectId]);

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const source: Source = lockProject ? lockedSource : project?.source ?? "local";

  // Members only exist inside a project; unassigned tasks have nobody to pick.
  const { data: space } = useQuery({
    queryKey: ["project-space", projectId, source],
    queryFn: () => getProjectSpace(projectId, source),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const members = space?.members ?? [];
  useEffect(() => {
    if (assigneeId && !members.some((m) => m.user_id === assigneeId)) setAssigneeId("");
  }, [members, assigneeId]);

  const create = useMutation({
    mutationFn: (body: TaskCreate) => createTask(body, source),
    onSuccess: (task) => {
      setError(null);
      invalidate();
      onCreated?.(task, source);
      if (stay) {
        setTitle("");
        setDescription("");
      }
    },
    onError: () => setError("That task could not be created."),
  });

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = title.trim();
    if (!clean || create.isPending) return;
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    create.mutate({
      title: clean,
      description: description.trim() || undefined,
      project_id: projectId || undefined,
      parent_task_id: defaults?.parent_task_id,
      priority: place.priority,
      assignee_id: assigneeId || undefined,
      due_date: fromDayInput(place.due),
      start_date: fromDayInput(start),
      end_date: fromDayInput(end),
      is_milestone: milestone || undefined,
      tags: tagList.length ? tagList : undefined,
      source_ref: defaults?.source_ref,
    });
  }

  const field = FIELD;

  return (
    <form onSubmit={submit} className={cn("space-y-2.5", className)}>
      <input
        autoFocus={autoFocus}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs doing?"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="flex flex-wrap items-center gap-2">
        <TaskPlacementFields value={place} onChange={setPlace} lockProject={lockProject} />
        {projectId && members.length > 0 && (
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className={cn(field, "max-w-[12rem]")}
            title="Assignee"
          >
            <option value="">Nobody yet</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name || m.email || m.user_id}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {more ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          More
        </button>
      </div>

      {more && (
        <div className="grid gap-2 rounded-md border bg-muted/30 p-2.5 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground sm:col-span-2">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={cn(field, "mt-0.5 w-full resize-y")}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Starts
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={cn(field, "mt-0.5 w-full")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Ends
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={cn(field, "mt-0.5 w-full")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Tags
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="comma, separated"
              className={cn(field, "mt-0.5 w-full")}
            />
          </label>
          <label className="flex items-center gap-2 self-end text-xs text-muted-foreground">
            <input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} />
            Milestone
          </label>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!title.trim() || create.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
