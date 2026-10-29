import { useMemo, useState } from "react";
import { listWorkrooms } from "@/api/workrooms";
import { EXAMPLE_PROGRAM } from "@/lib/brand";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, ExternalLink, GitBranch, Loader2, Play, Plus, Power, Trash2, CalendarClock } from "lucide-react";
import { FileActionCard, extractFileLinks } from "@/components/chat/MessageBubble";
import { StepsEditor, StepsSummary, cleanSteps, stepsHaveGaps } from "@/components/routines/StepsEditor";
import { openExternal } from "@/lib/externalLinks";
import {
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  runScheduledTaskNow,
  type RoutineStep,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduleFrequency,
} from "@/api/scheduledTasks";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Files produced by the last run: the verified list, falling back to links in
 *  the (truncated) output for runs recorded before that list existed. Failed
 *  runs show none — a rejected run's file names are exactly the phantom ones. */
function runFiles(t: ScheduledTask): string[] {
  if (t.last_run_status !== "success") return [];
  if (t.last_run_files?.length) return t.last_run_files;
  return extractFileLinks(t.last_run_output ?? "");
}

function scheduleSummary(t: ScheduledTask): string {
  const time = `${pad(t.hour)}:${pad(t.minute)}`;
  if (t.frequency === "daily") return `Every day at ${time}`;
  if (t.frequency === "weekly") {
    const day = t.day_of_week == null ? "Monday" : WEEKDAYS[t.day_of_week];
    return `Every ${day} at ${time}`;
  }
  const dom = t.day_of_month ?? 1;
  return `Monthly on day ${dom} at ${time}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** What a Drive / web link is, for a short chip. */
function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "docs.google.com") {
      const kind = u.pathname.split("/")[1];
      return kind === "document" ? "Google Doc" : kind === "spreadsheets" ? "Google Sheet" : kind === "presentation" ? "Google Slides" : "Google Drive";
    }
    if (u.hostname.endsWith("drive.google.com")) return "Google Drive";
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The routine's steps, with an editor that saves on demand. */
function StepsPanel({
  task,
  onSave,
  saving,
}: {
  task: ScheduledTask;
  onSave: (steps: RoutineStep[]) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RoutineStep[]>(task.steps ?? []);
  const saved = task.steps ?? [];

  if (!editing) {
    return (
      <div className="rounded-md border bg-muted/20 p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <GitBranch className="h-3 w-3" /> Steps {saved.length ? `(${saved.length})` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setDraft(saved);
              setEditing(true);
            }}
            className="text-xs text-primary hover:underline"
          >
            {saved.length ? "Edit" : "Add steps"}
          </button>
        </div>
        {saved.length ? (
          <StepsSummary steps={saved} />
        ) : (
          <p className="text-xs text-muted-foreground">
            None — the instruction is the whole routine. Steps let you say “if this, then that”.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-md border p-2.5 space-y-2">
      <StepsEditor steps={draft} onChange={setDraft} compact />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || stepsHaveGaps(draft)}
          onClick={() => {
            onSave(cleanSteps(draft));
            setEditing(false);
          }}
          className="rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save steps"}
        </button>
      </div>
    </div>
  );
}

const EMPTY_FORM: ScheduledTaskInput = {
  title: "",
  prompt: "",
  frequency: "weekly",
  day_of_week: 3, // Thursday
  day_of_month: 1,
  hour: 8,
  minute: 0,
  enabled: true,
  steps: [],
};

export function ScheduledTasksPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ScheduledTaskInput>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: listScheduledTasks,
    // Poll quickly while a run is in flight so the outcome appears promptly.
    refetchInterval: (query) =>
      query.state.data?.some((t) => t.last_run_status === "running")
        ? 3_000
        : 30_000,
  });

  const { data: workrooms = [] } = useQuery({
    queryKey: ["workrooms", false],
    queryFn: () => listWorkrooms(false),
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["scheduled-tasks"] });

  const createMutation = useMutation({
    mutationFn: createScheduledTask,
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ScheduledTaskInput> }) =>
      updateScheduledTask(id, body),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteScheduledTask,
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
    },
  });

  const runMutation = useMutation({
    mutationFn: runScheduledTaskNow,
    onSuccess: invalidate,
  });

  const canSubmit = useMemo(
    () => form.title.trim().length > 0 && form.prompt.trim().length > 0 && !stepsHaveGaps(form.steps ?? []),
    [form],
  );

  const submit = () => {
    if (!canSubmit) return;
    const body: ScheduledTaskInput = {
      ...form,
      day_of_week: form.frequency === "weekly" ? form.day_of_week : null,
      day_of_month: form.frequency === "monthly" ? form.day_of_month : null,
      steps: cleanSteps(form.steps ?? []),
    };
    createMutation.mutate(body);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6" /> Routines
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Standing instructions for Little Gerry — a weekly report, a Monday check — that run
            on their own. Generated files land under Knowledge › Made by Gerry.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 shrink-0"
        >
          <Plus className="h-4 w-4" /> New
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Weekly program report"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Instruction for Little Gerry</label>
            <textarea
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder={`Create a Word document summarising the previous week's emails, meetings, and task progress for the ${EXAMPLE_PROGRAM} program, then save it to Generated Files.`}
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <GitBranch className="h-4 w-4 text-muted-foreground" /> Steps (optional)
            </label>
            <p className="text-xs text-muted-foreground">
              A procedure for Gerry to follow in order. A <strong>decision</strong> step is “if this, then
              that, otherwise the other” — she checks the condition when the routine runs and says which way
              it went.
            </p>
            <StepsEditor steps={form.steps ?? []} onChange={(steps) => setForm({ ...form, steps })} />
          </div>
          {workrooms.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Room (optional)</label>
              <select
                value={form.workroom_id ?? ""}
                onChange={(e) =>
                  setForm({ ...form, workroom_id: e.target.value || null })
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">None — runs in its own conversation</option>
                {workrooms.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Standing room tasks run inside the room's chat with the room's
                goal and pinned items, and log each run to the journal.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Frequency</label>
              <select
                value={form.frequency}
                onChange={(e) =>
                  setForm({ ...form, frequency: e.target.value as ScheduleFrequency })
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {form.frequency === "weekly" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Day of week</label>
                <select
                  value={form.day_of_week ?? 0}
                  onChange={(e) =>
                    setForm({ ...form, day_of_week: Number(e.target.value) })
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.frequency === "monthly" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Day of month</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={form.day_of_month ?? 1}
                  onChange={(e) =>
                    setForm({ ...form, day_of_month: Number(e.target.value) })
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Time</label>
              <input
                type="time"
                value={`${pad(form.hour)}:${pad(form.minute)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  setForm({ ...form, hour: h || 0, minute: m || 0 });
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
              }}
              className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit || createMutation.isPending}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? "Creating…" : "Create schedule"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Clock className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No routines yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one to have Little Gerry produce reports on a recurring schedule.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => {
            const isConfirming = confirmDelete === t.id;
            const running =
              t.last_run_status === "running" ||
              (runMutation.isPending && runMutation.variables === t.id);
            return (
              <div key={t.id} className="rounded-xl border p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{scheduleSummary(t)}</p>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-xs " +
                      (t.enabled
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-muted text-muted-foreground")
                    }
                  >
                    {t.enabled ? "Active" : "Paused"}
                  </span>
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2">{t.prompt}</p>

                <StepsPanel
                  task={t}
                  saving={updateMutation.isPending && updateMutation.variables?.id === t.id}
                  onSave={(steps) => updateMutation.mutate({ id: t.id, body: { steps } })}
                />

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Next run: {t.enabled ? formatDate(t.next_run_at) : "—"}</span>
                  <span>Last run: {formatDate(t.last_run_at)}</span>
                  {t.last_run_status && (
                    <span
                      className={
                        t.last_run_status === "success"
                          ? "text-emerald-600"
                          : t.last_run_status === "running"
                            ? "text-sky-600"
                            : "text-destructive"
                      }
                    >
                      {t.last_run_status === "success"
                        ? "✓ succeeded"
                        : t.last_run_status === "running"
                          ? "⟳ running…"
                          : "✗ failed"}
                    </span>
                  )}
                  {t.run_count > 0 && <span>{t.run_count} run(s)</span>}
                </div>

                {t.last_run_output && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Last result
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-foreground">
                      {t.last_run_output}
                    </pre>
                  </details>
                )}

                {t.last_run_status === "success" && (t.last_run_links?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {t.last_run_links!.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => openExternal(url)}
                        title={url}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {linkLabel(url)}
                      </button>
                    ))}
                  </div>
                )}

                {runFiles(t).map((name) => (
                  <FileActionCard
                    key={name}
                    filename={name}
                    conversationId={t.conversation_id ?? undefined}
                    variant="surface"
                  />
                ))}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => runMutation.mutate(t.id)}
                    disabled={running}
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    {running ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {running ? "Running…" : "Run now"}
                  </button>
                  <button
                    onClick={() =>
                      updateMutation.mutate({ id: t.id, body: { enabled: !t.enabled } })
                    }
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                  >
                    <Power className="h-3.5 w-3.5" />
                    {t.enabled ? "Pause" : "Resume"}
                  </button>
                  <div className="ml-auto">
                    {isConfirming ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteMutation.mutate(t.id)}
                          disabled={deleteMutation.isPending}
                          className="rounded-md bg-destructive px-2.5 py-1.5 text-xs text-destructive-foreground hover:bg-destructive/90"
                        >
                          {deleteMutation.isPending ? "Deleting…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(t.id)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
