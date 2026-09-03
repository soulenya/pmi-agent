import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Trash2, X } from "lucide-react";

import {
  createProjectLink,
  deleteProjectLink,
  listProjectLinks,
  updateProjectLink,
} from "@/api/projectLinks";
import { listProjects, listTasks, type Source } from "@/api/tasks";
import type { ProjectLink, ProjectLinkKind } from "@/types/tasks";
import { cn } from "@/lib/utils";

/** How each kind reads out loud, from each end of the link. */
const PHRASES: Record<ProjectLinkKind, { out: string; in: string; label: string }> = {
  depends_on: { out: "waits for", in: "is waited on by", label: "Depends on" },
  gates: { out: "gates", in: "is gated by", label: "Gates" },
  parallel: { out: "runs alongside", in: "runs alongside", label: "Runs alongside" },
  subproject_of: { out: "is part of", in: "contains", label: "Is part of" },
};

const STATUS_STYLES: Record<string, string> = {
  open: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  satisfied: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  waived: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

function errorText(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || "That did not work.";
}

export function ProjectLinksPanel({
  projectId,
  source = "local",
  canEdit,
}: {
  projectId: string;
  source?: Source;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ProjectLinkKind>("depends_on");
  const [target, setTarget] = useState("");
  const [gateTask, setGateTask] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  const { data: links = [] } = useQuery({
    queryKey: ["project-links", source, projectId],
    queryFn: () => listProjectLinks(projectId, source),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", source, false],
    queryFn: () => listProjects(false, source),
    enabled: adding,
  });

  // A gate's condition lives in the project doing the gating, which from this
  // page is always this project.
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", source, projectId],
    queryFn: () => listTasks({ project_id: projectId }, source),
    enabled: adding && kind === "gates",
  });

  const milestones = useMemo(() => tasks.filter(t => t.is_milestone), [tasks]);
  const linked = useMemo(
    () => new Set(links.map(l => l.other_project_id).filter(Boolean) as string[]),
    [links],
  );
  const candidates = useMemo(
    () => projects.filter(p => p.id !== projectId && !linked.has(p.id)),
    [projects, projectId, linked],
  );

  function refresh() {
    qc.invalidateQueries({ queryKey: ["project-links", source, projectId] });
    qc.invalidateQueries({ queryKey: ["timeline", source, projectId] });
    qc.invalidateQueries({ queryKey: ["portfolio", source] });
  }

  const add = useMutation({
    mutationFn: () =>
      createProjectLink(
        projectId,
        {
          to_project_id: target,
          kind,
          gate_task_id: kind === "gates" && gateTask ? gateTask : null,
          note,
        },
        source,
      ),
    onSuccess: () => {
      setAdding(false);
      setTarget("");
      setGateTask("");
      setNote("");
      setProblem("");
      refresh();
    },
    onError: err => setProblem(errorText(err)),
  });

  const setStatus = useMutation({
    mutationFn: ({ link, status }: { link: ProjectLink; status: "open" | "waived" }) =>
      updateProjectLink(projectId, link.id, { status }, source),
    onSuccess: refresh,
    onError: err => setProblem(errorText(err)),
  });

  const remove = useMutation({
    mutationFn: (link: ProjectLink) => deleteProjectLink(projectId, link.id, source),
    onSuccess: refresh,
    onError: err => setProblem(errorText(err)),
  });

  return (
    <div className="rounded-xl border bg-card p-5 md:col-span-2">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="h-4 w-4" /> How this fits with other work
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setAdding(a => !a);
              setProblem("");
            }}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
          >
            {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {adding ? "Cancel" : "Link a project"}
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        A link also decides how far Gerry may look: she can read a linked project's goal,
        milestones and gate status, and nothing else.
      </p>

      {adding && (
        <div className="mb-4 space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={kind}
              onChange={e => setKind(e.target.value as ProjectLinkKind)}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {(Object.keys(PHRASES) as ProjectLinkKind[]).map(k => (
                <option key={k} value={k}>
                  This project {PHRASES[k].out}…
                </option>
              ))}
            </select>
            <select
              value={target}
              onChange={e => setTarget(e.target.value)}
              className="min-w-40 rounded-md border bg-background px-2 py-1 text-xs"
            >
              <option value="">Pick a project…</option>
              {candidates.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {kind === "gates" && (
              <select
                value={gateTask}
                onChange={e => setGateTask(e.target.value)}
                className="min-w-40 rounded-md border bg-background px-2 py-1 text-xs"
              >
                <option value="">No condition</option>
                {milestones.map(t => (
                  <option key={t.id} value={t.id}>
                    until {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          {kind === "gates" && milestones.length === 0 && (
            <p className="text-xs text-muted-foreground">
              A gate waits on a milestone. Mark a task in this project as a milestone on the
              timeline first, or leave the gate without a condition and close it by hand.
            </p>
          )}
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Why (optional)"
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={!target || add.isPending}
            onClick={() => add.mutate()}
            className="rounded-md border bg-primary/10 px-3 py-1 text-xs hover:bg-primary/20 disabled:opacity-50"
          >
            Link
          </button>
        </div>
      )}

      {problem && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {problem}
        </p>
      )}

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Not linked to anything. This project stands on its own.
        </p>
      ) : (
        <ul className="divide-y">
          {links.map(link => {
            const phrase = PHRASES[link.kind] ?? PHRASES.depends_on;
            const other = link.other_visible
              ? link.other_project_name
              : "a project you cannot see";
            const sentence =
              link.direction === "out"
                ? `This project ${phrase.out} ${other}`
                : `${other[0].toUpperCase()}${other.slice(1)} ${phrase.out} this project`;
            return (
              <li key={link.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {sentence}
                    {link.gate_task_title && (
                      <span className="text-muted-foreground"> until {link.gate_task_title}</span>
                    )}
                  </p>
                  {link.note && (
                    <p className="truncate text-xs text-muted-foreground">{link.note}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {link.kind === "gates" && (
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        STATUS_STYLES[link.status] ?? STATUS_STYLES.open,
                      )}
                    >
                      {link.status}
                    </span>
                  )}
                  {canEdit && link.kind === "gates" && link.status !== "satisfied" && (
                    <button
                      type="button"
                      onClick={() =>
                        setStatus.mutate({
                          link,
                          status: link.status === "waived" ? "open" : "waived",
                        })
                      }
                      className="rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent"
                    >
                      {link.status === "waived" ? "Reinstate" : "Waive"}
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(link)}
                      title="Remove this link"
                      className="rounded-md border p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
