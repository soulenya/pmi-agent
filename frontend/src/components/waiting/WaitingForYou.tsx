/**
 * The one list of things waiting on you: approvals, Gerry's suggestions, and
 * notifications. The header bell, the /waiting page and Today all render this
 * same component. Whether an approval can still be acted on is decided by the
 * pending-approvals list, never by a notification's read flag.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCheck,
  ClipboardCheck,
  FileText,
  Info,
  Loader2,
  MessageSquare,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import {
  acceptSuggestion,
  completeSuggestion,
  dismissSuggestion,
  getPendingSuggestionCount,
  listSuggestions,
  type AssistantSuggestion,
} from "@/api/assistant";
import {
  clearExpiredApprovals,
  listNotifications,
  listPendingApprovals,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/api/chat";
import { ApprovalCard, useResolveApproval } from "@/components/approvals/ApprovalCard";
import { formatAgo } from "@/lib/formatWhen";
import { SUGGESTION_KIND_META, stripRoomPrefix } from "@/lib/suggestionKinds";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";
import type { Notification } from "@/types/chat";

/**
 * Every suggestion also writes a notification when it is created. Those echoes
 * live in the Suggestions tab already, so the Notifications tab (and the unread
 * count) leave them out — otherwise each item shows up twice.
 */
export function isSuggestionEcho(n: Notification): boolean {
  return n.entity_type === "assistant_suggestion";
}

/** The server's one-line explanation of a failed request, if it gave one. */
export function apiErrorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

export type WaitingTab = "approvals" | "suggestions" | "notifications";

export const WAITING_TABS: { id: WaitingTab; label: string }[] = [
  { id: "approvals", label: "Approvals" },
  { id: "suggestions", label: "Suggestions" },
  { id: "notifications", label: "Notifications" },
];

export function isWaitingTab(v: string | null | undefined): v is WaitingTab {
  return v === "approvals" || v === "suggestions" || v === "notifications";
}

/** Counts for badges. `total` is what the bell shows: decisions + suggestions + unread. */
export function useWaitingCounts() {
  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => listPendingApprovals(),
    refetchInterval: 30_000,
  });
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    refetchInterval: 30_000,
  });
  const { data: suggestions = 0 } = useQuery({
    queryKey: ["assistant", "suggestions", "count"],
    queryFn: getPendingSuggestionCount,
    refetchInterval: 30_000,
  });
  const unread = notifications.filter((n) => !n.is_read && !isSuggestionEcho(n)).length;
  return {
    approvals: approvals.length,
    suggestions,
    notifications: unread,
    total: approvals.length + suggestions + unread,
  };
}

/** The tab with something in it, decisions first. */
export function defaultWaitingTab(c: { approvals: number; suggestions: number; notifications: number }): WaitingTab {
  if (c.approvals > 0) return "approvals";
  if (c.notifications > 0) return "notifications";
  if (c.suggestions > 0) return "suggestions";
  return "approvals";
}

/** Where a notification takes you when clicked. */
export function notificationRoute(notif: Notification): string | null {
  if (notif.entity_type === "email_draft") return "/inbox?view=drafts";
  switch (notif.type) {
    case "task_due":
    case "task_assigned":
      return "/tasks";
    case "document_ingested":
      return "/documents";
    case "briefing_ready":
      return "/today";
    case "research_complete":
      return "/research";
    case "approval_required":
      return "/waiting?tab=approvals";
    default:
      return null;
  }
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  approval_required: <ClipboardCheck className="h-3.5 w-3.5 text-amber-500" />,
  task_due: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
  task_assigned: <CheckCheck className="h-3.5 w-3.5 text-blue-500" />,
  document_ingested: <FileText className="h-3.5 w-3.5 text-green-500" />,
  briefing_ready: <Info className="h-3.5 w-3.5 text-primary" />,
  feedback_submitted: <MessageSquare className="h-3.5 w-3.5 text-purple-500" />,
};

// ── Notification row ─────────────────────────────────────────────────────────

function NotificationRow({
  notif,
  pendingApproval,
  onMarkRead,
  onNavigate,
}: {
  notif: Notification;
  /** True while the linked approval is still undecided. */
  pendingApproval: boolean;
  onMarkRead: (id: string) => void;
  onNavigate: (path: string) => void;
}) {
  const resolve = useResolveApproval();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const route = notificationRoute(notif);

  async function decide(approved: boolean) {
    if (!notif.entity_id) return;
    setBusy(true);
    try {
      const res = await resolve(notif.entity_id, approved);
      const exec = res.execution_result;
      setOutcome(
        !approved
          ? "Rejected"
          : exec?.status === "executed"
            ? res.intent_type === "send_email"
              ? "Sent"
              : "Approved"
            : exec?.status === "error"
              ? "Approved, but it couldn't be completed"
              : "Approved",
      );
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setOutcome(status === 409 || status === 404 ? "Already handled" : "Failed");
    } finally {
      setBusy(false);
      if (!notif.is_read) onMarkRead(notif.id);
    }
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b px-4 py-3 last:border-0",
        notif.is_read ? "hover:bg-accent/30" : "cursor-pointer bg-accent/20 hover:bg-accent/40",
      )}
      onClick={() => {
        if (!notif.is_read) onMarkRead(notif.id);
        if (route) onNavigate(route);
      }}
    >
      <div className="mt-0.5 shrink-0">{TYPE_ICON[notif.type] ?? <Bell className="h-3.5 w-3.5 text-muted-foreground" />}</div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs leading-snug", !notif.is_read && "font-semibold")}>{notif.title}</p>
        {notif.message && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notif.message}</p>}
        <p className="mt-0.5 text-[10px] text-muted-foreground">{formatAgo(notif.created_at)}</p>
        {pendingApproval && !outcome && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                void decide(true);
              }}
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
              Approve
            </button>
            <button
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                void decide(false);
              }}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <ShieldX className="h-3 w-3" />
              Reject
            </button>
          </div>
        )}
        {outcome && <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{outcome}</p>}
      </div>
      {!notif.is_read && <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </div>
  );
}

// ── Suggestion row ───────────────────────────────────────────────────────────

function SuggestionRow({ s, busy, onAccept, onDone, onDismiss }: {
  s: AssistantSuggestion;
  busy: boolean;
  onAccept: () => void;
  onDone: () => void;
  onDismiss: () => void;
}) {
  const meta = SUGGESTION_KIND_META[s.kind];
  const Icon = meta.icon;
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="border-b px-4 py-3 last:border-0">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 shrink-0 rounded-md p-1.5", meta.tint)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{meta.label}</p>
          <p className="text-xs font-medium leading-snug">{stripRoomPrefix(s.title)}</p>
          {s.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.summary}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              disabled={busy}
              onClick={onAccept}
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> {meta.accept}
            </button>
            <button
              disabled={busy}
              onClick={onDone}
              title="I already did this"
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300"
            >
              <CheckCheck className="h-3 w-3" /> Already done
            </button>
            {confirming ? (
              <>
                <button
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    onDismiss();
                  }}
                  className="rounded-md bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground disabled:opacity-50"
                >
                  Confirm
                </button>
                <button onClick={() => setConfirming(false)} className="rounded-md border px-2 py-1 text-[11px]">
                  Cancel
                </button>
              </>
            ) : (
              <button
                disabled={busy}
                onClick={() => setConfirming(true)}
                className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <X className="h-3 w-3" /> {meta.dismiss}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

export interface WaitingForYouProps {
  tab: WaitingTab;
  onTabChange: (t: WaitingTab) => void;
  /** Cap rows and link to the full page for the rest (Today, the bell). */
  limit?: number;
  /** Called before navigating away so a host drawer can close. */
  onNavigate?: () => void;
  className?: string;
}

export function WaitingForYou({ tab, onTabChange, limit, onNavigate, className }: WaitingForYouProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const resolve = useResolveApproval();

  const { data: approvals = [], isLoading: approvalsLoading } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => listPendingApprovals(),
    refetchInterval: 15_000,
  });
  const { data: notifications = [], isLoading: notificationsLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    refetchInterval: 30_000,
    select: (rows) => rows.filter((n) => !isSuggestionEcho(n)),
  });
  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery({
    queryKey: ["assistant", "suggestions", "pending"],
    queryFn: () => listSuggestions({ status: "pending" }),
    refetchInterval: 30_000,
    enabled: tab === "suggestions",
  });
  const { data: suggestionCount = 0 } = useQuery({
    queryKey: ["assistant", "suggestions", "count"],
    queryFn: getPendingSuggestionCount,
    refetchInterval: 30_000,
  });

  const pendingIds = useMemo(() => new Set(approvals.map((a) => a.id)), [approvals]);
  const unread = notifications.filter((n) => !n.is_read).length;
  const expired = approvals.filter((a) => a.expires_at && new Date(a.expires_at) < new Date()).length;

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const clearExpired = useMutation({
    mutationFn: clearExpiredApprovals,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }),
  });
  const bump = () => {
    qc.invalidateQueries({ queryKey: ["assistant"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const toast = useToastStore((s) => s.push);
  const settled = (fallback: string) => (res: { message?: string | null }) => {
    bump();
    toast("success", res.message || fallback);
  };
  const failed = (what: string) => (e: unknown) => {
    bump();
    // The API client already toasts 409s (server refused on a rule).
    if ((e as { response?: { status?: number } })?.response?.status === 409) return;
    toast("error", apiErrorText(e, `${what} failed.`), 9000);
  };
  const accept = useMutation({
    mutationFn: (id: string) => acceptSuggestion(id),
    onSuccess: settled("Accepted."),
    onError: failed("Accept"),
  });
  const done = useMutation({
    mutationFn: (id: string) => completeSuggestion(id),
    onSuccess: settled("Marked already done."),
    onError: failed("Already done"),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => dismissSuggestion(id),
    onSuccess: settled("Dismissed."),
    onError: failed("Dismiss"),
  });
  const suggestionBusy = accept.isPending || done.isPending || dismiss.isPending;

  const go = (path: string) => {
    onNavigate?.();
    navigate(path);
  };
  const counts: Record<WaitingTab, number> = {
    approvals: approvals.length,
    suggestions: suggestionCount,
    notifications: unread,
  };

  const cap = <T,>(rows: T[]) => (limit ? rows.slice(0, limit) : rows);
  const more = (n: number) =>
    limit && n > limit ? (
      <button
        type="button"
        onClick={() => go(`/waiting?tab=${tab}`)}
        className="block w-full px-4 py-2 text-left text-xs text-primary hover:underline"
      >
        +{n - limit} more
      </button>
    ) : null;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-1 border-b px-2">
        {WAITING_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={cn(
              "relative -mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs font-medium transition-colors",
              tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {counts[t.id] > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                  t.id === "approvals" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground",
                )}
              >
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pr-1">
          {tab === "approvals" && expired > 0 && (
            <button
              onClick={() => clearExpired.mutate()}
              disabled={clearExpired.isPending}
              className="flex items-center gap-1 text-[11px] text-destructive hover:underline disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Clear {expired} expired
            </button>
          )}
          {tab === "notifications" && unread > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
          {tab === "suggestions" && (
            <NavLink to="/assistant" onClick={onNavigate} className="text-[11px] text-muted-foreground hover:text-foreground">
              All suggestions
            </NavLink>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "approvals" && (
          <div className="space-y-3 p-3">
            {approvalsLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!approvalsLoading && approvals.length === 0 && (
              <Empty icon={<ShieldCheck className="h-8 w-8 opacity-40" />} text="Nothing needs your approval." />
            )}
            {cap(approvals).map((intent) => (
              <ApprovalCard
                key={intent.id}
                intent={intent}
                compact
                onResolve={(approved, reason) => resolve(intent.id, approved, reason)}
              />
            ))}
            {more(approvals.length)}
          </div>
        )}

        {tab === "suggestions" && (
          <div>
            {suggestionsLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {!suggestionsLoading && suggestions.length === 0 && (
              <Empty icon={<Sparkles className="h-8 w-8 opacity-40" />} text="No suggestions right now." />
            )}
            {cap(suggestions).map((s) => (
              <SuggestionRow
                key={s.id}
                s={s}
                busy={suggestionBusy}
                onAccept={() => accept.mutate(s.id)}
                onDone={() => done.mutate(s.id)}
                onDismiss={() => dismiss.mutate(s.id)}
              />
            ))}
            {more(suggestions.length)}
          </div>
        )}

        {tab === "notifications" && (
          <div>
            {notificationsLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {!notificationsLoading && notifications.length === 0 && (
              <Empty icon={<Bell className="h-8 w-8 opacity-40" />} text="No notifications yet." />
            )}
            {cap(notifications).map((n) => (
              <NotificationRow
                key={n.id}
                notif={n}
                pendingApproval={n.entity_type === "approval_intent" && !!n.entity_id && pendingIds.has(n.entity_id)}
                onMarkRead={(id) => markRead.mutate(id)}
                onNavigate={go}
              />
            ))}
            {more(notifications.length)}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  );
}
