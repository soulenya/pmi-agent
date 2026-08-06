import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Sparkles,
  Mail,
  ListChecks,
  FileText,
  CheckSquare,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  X,
  ExternalLink,
  Play,
  Clock,
  Undo2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  listSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  completeSuggestion,
  bulkResolveSuggestions,
  undoDismissSuggestion,
  getAssistantSettings,
  updateAssistantSettings,
  getSuggestionStats,
  triggerAssistantScan,
  type AssistantSuggestion,
  type KindStats,
  type SuggestionKind,
} from "@/api/assistant";
import { proposeOdooAction, type OdooWriteAction } from "@/api/odoo";
import { cn } from "@/lib/utils";

const KIND_META: Record<
  SuggestionKind,
  {
    label: string;
    icon: typeof Mail;
    accept: string;
    dismiss: string;
    tint: string;
    blurb: string;
  }
> = {
  followup_email: {
    label: "Email follow-up",
    icon: Mail,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    blurb: "Mail you sent that hasn't been answered",
  },
  followup_task: {
    label: "Task reminder",
    icon: ListChecks,
    accept: "Acknowledge",
    dismiss: "Dismiss",
    tint: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    blurb: "Tasks that have gone quiet",
  },
  task_recommendation: {
    label: "Recommended task",
    icon: CheckSquare,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
    blurb: "Picked out of your mail and chats",
  },
  meeting_import: {
    label: "Meeting summary imported",
    icon: FileText,
    accept: "Keep",
    dismiss: "Remove",
    tint: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    blurb: "New notes filed in your Knowledge Base",
  },
  workroom_todo: {
    label: "Workroom next step",
    icon: CheckSquare,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    blurb: "Moves Gerry suggests toward the room's goal",
  },
  budget_entry: {
    label: "Budget entry",
    icon: Wallet,
    accept: "Add to budget",
    dismiss: "Dismiss",
    tint: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    blurb: "Spending found in your invoice folders",
  },
  gmail_invoice: {
    label: "Invoice in Gmail",
    icon: Mail,
    accept: "File & log",
    dismiss: "Dismiss",
    tint: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
    blurb: "Bills waiting to be filed",
  },
};

interface Group {
  key: string;
  label: string;
  kind: SuggestionKind;
  items: AssistantSuggestion[];
}

/** "Morgan Keane <m@x.com>, other@y.com" → "Morgan Keane". */
function firstRecipient(raw: string): string {
  const first = raw.split(",")[0]?.trim() ?? "";
  const named = first.match(/^"?([^"<]+?)"?\s*</);
  return (named ? named[1] : first.replace(/[<>]/g, "")).trim();
}

/** Group by what a suggestion is ABOUT, falling back to its category. */
function groupOf(s: AssistantSuggestion): { key: string; label: string } {
  const payload = s.payload ?? {};
  if (s.kind === "workroom_todo") {
    const room = String(payload.workroom_title ?? "").trim();
    if (room) return { key: `room:${room}`, label: room };
  }
  if (s.kind === "followup_email") {
    const email = payload.email as { to?: string } | undefined;
    const who = firstRecipient(String(email?.to ?? ""));
    if (who) return { key: `to:${who}`, label: who };
  }
  return { key: `kind:${s.kind}`, label: KIND_META[s.kind].label };
}

/**
 * Share of past decisions that kept the suggestion. Null when there is too
 * little history to judge, which counts as trusted rather than suspect.
 */
function trustOf(stats: KindStats[] | undefined, kind: SuggestionKind): number | null {
  const row = stats?.find((s) => s.kind === kind);
  if (!row) return null;
  const kept = row.accepted + row.completed;
  const resolved = kept + row.dismissed;
  return resolved < 5 ? null : kept / resolved;
}

function SuggestionGroup({
  group,
  trust,
  expanded,
  onToggle,
  onDismissAll,
  busy,
  children,
}: {
  group: Group;
  trust: number | null;
  expanded: boolean;
  onToggle: () => void;
  onDismissAll: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const meta = KIND_META[group.kind];
  const Icon = meta.icon;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 p-4">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className={cn("shrink-0 rounded-lg p-2", meta.tint)}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold">{group.label}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {group.items.length}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {meta.blurb}
            </span>
          </span>
          <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>

        {confirming ? (
          <>
            <button
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onDismissAll();
              }}
              className="shrink-0 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              Dismiss {group.items.length}
            </button>
            <button
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={() => setConfirming(true)}
            title="Dismiss everything in this group"
            className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Dismiss all
          </button>
        )}
      </div>

      {!expanded && trust === 0 && (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          You've dismissed every one of these so far — collapsed by default.
        </p>
      )}

      {expanded && <div className="space-y-3 border-t bg-muted/20 p-4">{children}</div>}
    </div>
  );
}

/** Room to-dos are stored as "[Room] Do the thing"; the group header says the room. */
function stripRoomPrefix(title: string): string {
  return title.replace(/^\[[^\]]+\]\s*/, "") || title;
}

function SuggestionCard({
  suggestion,
  displayTitle,
  onAccept,
  onComplete,
  onDismiss,
  busy,
  selected,
  onToggleSelect,
}: {
  suggestion: AssistantSuggestion;
  displayTitle?: string;
  onAccept: () => void;
  onComplete: () => void;
  onDismiss: () => void;
  busy: boolean;
  selected: boolean;
  onToggleSelect: () => void;
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
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm",
        selected && "border-primary/60 ring-1 ring-primary/40",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            title="Select for bulk action"
            className="mt-2.5 h-4 w-4 shrink-0 rounded border-input"
          />
          <span className={cn("mt-0.5 shrink-0 rounded-lg p-2", meta.tint)}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {meta.label}
            </span>
            <p className="mt-0.5 font-medium">{displayTitle ?? suggestion.title}</p>
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={busy}
          onClick={onAccept}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {meta.accept}
        </button>
        <button
          disabled={busy}
          onClick={onComplete}
          title="I already did this — don't recommend it again"
          className="flex items-center gap-1.5 rounded-md border border-emerald-500/50 px-4 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300"
        >
          <CheckCheck className="h-4 w-4" />
          Already done
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
  // Multi-select for bulk complete/dismiss.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Group open/closed overrides; untouched groups follow their trust score.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const { data: stats } = useQuery({
    queryKey: ["assistant", "stats"],
    queryFn: getSuggestionStats,
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

  const completeMutation = useMutation({
    mutationFn: (id: string) => completeSuggestion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant"] }),
  });

  const bulkMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: "complete" | "dismiss" }) =>
      bulkResolveSuggestions(ids, action),
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["assistant"] });
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

  const busy =
    acceptMutation.isPending ||
    dismissMutation.isPending ||
    completeMutation.isPending ||
    bulkMutation.isPending;
  const lastRun = settings?.last_run ? new Date(settings.last_run) : null;

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedCount = suggestions.filter((s) => selected.has(s.id)).length;
  const allSelected = suggestions.length > 0 && selectedCount === suggestions.length;
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(suggestions.map((s) => s.id)));

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const s of suggestions) {
      const { key, label } = groupOf(s);
      const existing = map.get(key);
      if (existing) existing.items.push(s);
      else map.set(key, { key, label, kind: s.kind, items: [s] });
    }
    // Categories you usually keep float to the top; ones you always bin sink.
    return [...map.values()].sort((a, b) => {
      const ta = trustOf(stats, a.kind) ?? 0.75;
      const tb = trustOf(stats, b.kind) ?? 0.75;
      return tb - ta || b.items.length - a.items.length;
    });
  }, [suggestions, stats]);

  // Small groups always show: two cards cost nothing. Big ones must earn it.
  const isExpanded = (g: Group) => {
    const override = expanded[g.key];
    if (override !== undefined) return override;
    if (g.items.length <= 2) return true;
    return (trustOf(stats, g.kind) ?? 1) >= 0.5;
  };

  const toggleGroup = (g: Group) =>
    setExpanded((prev) => ({ ...prev, [g.key]: !isExpanded(g) }));

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

      {suggestions.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-sm">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-input"
            />
            Select all
          </label>
          {selectedCount > 0 ? (
            <>
              <span className="text-sm text-muted-foreground">
                {selectedCount} selected
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  disabled={busy}
                  onClick={() => bulkMutation.mutate({ ids: [...selected], action: "complete" })}
                  title="Mark the selected suggestions as already done — they won't come back"
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  <CheckCheck className="h-4 w-4" />
                  Mark done ({selectedCount})
                </button>
                <button
                  disabled={busy}
                  onClick={() => bulkMutation.mutate({ ids: [...selected], action: "dismiss" })}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Dismiss ({selectedCount})
                </button>
              </div>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              Select suggestions to complete or dismiss them together
            </span>
          )}
        </div>
      )}

      {groups.map((group) => (
        <SuggestionGroup
          key={group.key}
          group={group}
          trust={trustOf(stats, group.kind)}
          expanded={isExpanded(group)}
          onToggle={() => toggleGroup(group)}
          onDismissAll={() =>
            bulkMutation.mutate({
              ids: group.items.map((s) => s.id),
              action: "dismiss",
            })
          }
          busy={busy}
        >
          {group.items.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              displayTitle={stripRoomPrefix(s.title)}
              busy={busy}
              selected={selected.has(s.id)}
              onToggleSelect={() => toggleSelect(s.id)}
              onAccept={() => acceptMutation.mutate(s.id)}
              onComplete={() => completeMutation.mutate(s.id)}
              onDismiss={() => dismissMutation.mutate(s)}
            />
          ))}
        </SuggestionGroup>
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
