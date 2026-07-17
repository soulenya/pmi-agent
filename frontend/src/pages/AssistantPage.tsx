import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Mail,
  ListChecks,
  FileText,
  CheckSquare,
  Check,
  X,
  ExternalLink,
  Play,
  Clock,
  Undo2,
  ShieldCheck,
} from "lucide-react";
import {
  listSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  undoDismissSuggestion,
  getAssistantSettings,
  updateAssistantSettings,
  triggerAssistantScan,
  type AssistantSuggestion,
  type SuggestionKind,
} from "@/api/assistant";
import { proposeOdooAction, type OdooWriteAction } from "@/api/odoo";
import { cn } from "@/lib/utils";

const KIND_META: Record<
  SuggestionKind,
  { label: string; icon: typeof Mail; accept: string; dismiss: string; tint: string }
> = {
  followup_email: {
    label: "Email follow-up",
    icon: Mail,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
  followup_task: {
    label: "Task reminder",
    icon: ListChecks,
    accept: "Acknowledge",
    dismiss: "Dismiss",
    tint: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  task_recommendation: {
    label: "Recommended task",
    icon: CheckSquare,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  },
  meeting_import: {
    label: "Meeting summary imported",
    icon: FileText,
    accept: "Keep",
    dismiss: "Remove",
    tint: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  workroom_todo: {
    label: "Workroom next step",
    icon: CheckSquare,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  },
};

function SuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
  busy,
}: {
  suggestion: AssistantSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const meta = KIND_META[suggestion.kind];
  const Icon = meta.icon;
  const [confirming, setConfirming] = useState(false);
  const task = (suggestion.payload?.task ?? null) as
    | { priority?: string; due_in_days?: number | null }
    | null;
  const odooAction = (suggestion.payload?.odoo_action ?? null) as
    | { name: OdooWriteAction; label?: string; params: Record<string, unknown> }
    | null;
  const [proposing, setProposing] = useState(false);
  const [approvalMsg, setApprovalMsg] = useState<string | null>(null);

  const submitForApproval = async () => {
    if (!odooAction) return;
    setProposing(true);
    setApprovalMsg(null);
    try {
      const res = await proposeOdooAction(odooAction.name, odooAction.params);
      setApprovalMsg(`Queued: “${res.title}” — approve it on the Approvals page.`);
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } };
      setApprovalMsg(err.response?.data?.detail ?? "Could not queue the action.");
    } finally {
      setProposing(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={cn("mt-0.5 shrink-0 rounded-lg p-2", meta.tint)}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {meta.label}
            </span>
            <p className="mt-0.5 font-medium">{suggestion.title}</p>
            {suggestion.summary && (
              <p className="mt-0.5 text-sm text-muted-foreground">{suggestion.summary}</p>
            )}
          </div>
        </div>
      </div>

      {task && (task.priority || task.due_in_days != null) && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {task.priority && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium capitalize">
              {task.priority} priority
            </span>
          )}
          {task.due_in_days != null && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium">
              Due in {task.due_in_days} day{task.due_in_days === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          disabled={busy}
          onClick={onAccept}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {meta.accept}
        </button>
        {odooAction && (
          <button
            disabled={busy || proposing || approvalMsg !== null}
            onClick={submitForApproval}
            title="Send this Odoo action to the approval queue"
            className="flex items-center gap-1.5 rounded-md border border-violet-500/50 px-4 py-1.5 text-sm font-medium text-violet-600 hover:bg-violet-500/10 disabled:opacity-50 dark:text-violet-300"
          >
            <ShieldCheck className="h-4 w-4" />
            {odooAction.label ?? "Submit for approval"}
          </button>
        )}
        {confirming ? (
          <>
            <button
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onDismiss();
              }}
              className="flex items-center gap-1.5 rounded-md bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Confirm {meta.dismiss.toLowerCase()}
            </button>
            <button
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            {meta.dismiss}
          </button>
        )}
        {suggestion.source_url && (
          <a
            href={suggestion.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open source
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {approvalMsg && (
        <p className="mt-2 text-xs text-violet-600 dark:text-violet-300">{approvalMsg}</p>
      )}
    </div>
  );
}

export function AssistantPage() {
  const queryClient = useQueryClient();
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  // Short-lived undo affordance shown after a dismissal.
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ["assistant", "suggestions", "pending"],
    queryFn: () => listSuggestions({ status: "pending" }),
    refetchInterval: 30_000,
  });

  const { data: settings } = useQuery({
    queryKey: ["assistant", "settings"],
    queryFn: getAssistantSettings,
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptSuggestion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant"] }),
  });

  const showUndo = (id: string, title: string) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ id, title });
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  };

  const dismissMutation = useMutation({
    mutationFn: (s: AssistantSuggestion) => dismissSuggestion(s.id),
    onSuccess: (_res, s) => {
      queryClient.invalidateQueries({ queryKey: ["assistant"] });
      showUndo(s.id, s.title);
    },
  });

  const undoMutation = useMutation({
    mutationFn: (id: string) => undoDismissSuggestion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assistant"] });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo(null);
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (body: { enabled?: boolean; hour_local?: number }) =>
      updateAssistantSettings(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant", "settings"] }),
  });

  const scanMutation = useMutation({
    mutationFn: triggerAssistantScan,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["assistant"] });
      if (res.skipped === "google_not_connected") {
        setScanMessage("Google account is not connected — connect it on the Google page first.");
      } else {
        setScanMessage(
          `Scan complete: ${res.created} suggestion${res.created === 1 ? "" : "s"}, ` +
            `${res.imported} import${res.imported === 1 ? "" : "s"}.`,
        );
      }
    },
    onError: () => setScanMessage("Scan failed. Check that the backend and Google account are available."),
  });

  const busy = acceptMutation.isPending || dismissMutation.isPending;
  const lastRun = settings?.last_run ? new Date(settings.last_run) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-primary" />
            Daily Assistant
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A once-daily scan of your Gmail and Google Tasks. Approve follow-ups and recommended
            tasks, and review meeting summaries auto-imported into your Knowledge Base.
          </p>
        </div>
      </div>

      {/* Settings + manual scan */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.enabled ?? true}
              onChange={(e) => settingsMutation.mutate({ enabled: e.target.checked })}
              className="h-4 w-4 rounded border-input"
            />
            Daily scan enabled
          </label>

          <label className="flex items-center gap-2 text-sm">
            Run at
            <select
              value={settings?.hour_local ?? 7}
              onChange={(e) => settingsMutation.mutate({ hour_local: Number(e.target.value) })}
              className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            local
          </label>

          <button
            onClick={() => {
              setScanMessage(null);
              scanMutation.mutate();
            }}
            disabled={scanMutation.isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {scanMutation.isPending ? "Scanning…" : "Run scan now"}
          </button>
        </div>

        {lastRun && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Last scan {lastRun.toLocaleString()}
          </p>
        )}
        {scanMessage && (
          <p className="mt-2 text-xs text-muted-foreground">{scanMessage}</p>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && suggestions.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Sparkles className="h-8 w-8 opacity-40" />
          <p className="text-sm">Nothing to review right now.</p>
        </div>
      )}

      {suggestions.map((s) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          busy={busy}
          onAccept={() => acceptMutation.mutate(s.id)}
          onDismiss={() => dismissMutation.mutate(s)}
        />
      ))}

      {undo && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm shadow-lg">
          <span className="max-w-[16rem] truncate text-muted-foreground">
            Dismissed “{undo.title}”
          </span>
          <button
            onClick={() => undoMutation.mutate(undo.id)}
            disabled={undoMutation.isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Undo2 className="h-4 w-4" />
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
