import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  ClipboardCheck,
  AlertCircle,
  FileText,
  Info,
  MessageSquare,
  ShieldCheck,
  ShieldX,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  resolveApproval,
} from "@/api/chat";
import type { Notification } from "@/types/chat";
import { pushApprovalOutcomeToast } from "@/stores/toastStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.ReactNode> = {
  approval_required: <ClipboardCheck className="h-3.5 w-3.5 text-amber-500" />,
  task_due: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
  task_assigned: <CheckCheck className="h-3.5 w-3.5 text-blue-500" />,
  document_ingested: <FileText className="h-3.5 w-3.5 text-green-500" />,
  briefing_ready: <Info className="h-3.5 w-3.5 text-primary" />,
  feedback_submitted: <MessageSquare className="h-3.5 w-3.5 text-purple-500" />,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Where a notification should take you when clicked (besides marking read). */
export function notificationRoute(notif: Notification): string | null {
  // Email drafts live in Communications → Email Drafts (they are reviewed
  // there and only reach Approvals once submitted for sending).
  if (notif.entity_type === "email_draft") return "/emails";
  switch (notif.type) {
    case "task_due":
    case "task_assigned":
      return "/tasks";
    case "document_ingested":
      return "/documents";
    case "briefing_ready":
      return "/assistant";
    case "research_complete":
      return "/research";
    case "approval_required":
      return "/approvals";
    default:
      return null;
  }
}

// ── NotificationRow ───────────────────────────────────────────────────────────

function NotificationRow({
  notif,
  onMarkRead,
  onNavigate,
}: {
  notif: Notification;
  onMarkRead: (id: string) => void;
  onNavigate?: (path: string) => void;
}) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<string | null>(null);
  const isApproval =
    notif.type === "approval_required" &&
    notif.entity_type === "approval_intent" &&
    !!notif.entity_id;

  const act = useMutation({
    mutationFn: (approved: boolean) =>
      resolveApproval(notif.entity_id!, { approved }),
    onSuccess: (res, approved) => {
      pushApprovalOutcomeToast(res, approved);
      const exec = res.execution_result;
      setOutcome(
        !approved
          ? "Rejected"
          : exec?.status === "executed"
            ? res.intent_type === "send_email"
              ? "Sent ✓"
              : "Approved ✓"
            : exec?.status === "error"
              ? "Approved, but it couldn't be completed"
              : "Approved",
      );
      onMarkRead(notif.id);
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["email-drafts"] });
    },
    onError: (e: unknown) => {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setOutcome(status === 409 || status === 404 ? "Already handled" : "Failed — open Approvals");
      onMarkRead(notif.id);
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  const route = notificationRoute(notif);

  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b last:border-0 px-4 py-3 transition-colors",
        notif.is_read
          ? "hover:bg-accent/30"
          : "bg-accent/20 hover:bg-accent/40 cursor-pointer"
      )}
      onClick={() => {
        if (!notif.is_read) onMarkRead(notif.id);
        if (route && onNavigate) onNavigate(route);
      }}
    >
      <div className="mt-0.5 shrink-0">
        {TYPE_ICON[notif.type] ?? (
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-xs leading-snug",
            !notif.is_read && "font-semibold"
          )}
        >
          {notif.title}
        </p>
        {notif.message && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {notif.message}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {timeAgo(notif.created_at)}
        </p>
        {/* Act on an approval right here — no page change needed */}
        {isApproval && !outcome && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              disabled={act.isPending}
              onClick={(e) => {
                e.stopPropagation();
                act.mutate(true);
              }}
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {act.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              Approve
            </button>
            <button
              disabled={act.isPending}
              onClick={(e) => {
                e.stopPropagation();
                act.mutate(false);
              }}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <ShieldX className="h-3 w-3" />
              Reject
            </button>
          </div>
        )}
        {outcome && (
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{outcome}</p>
        )}
      </div>
      {!notif.is_read && (
        <div className="mt-1.5 shrink-0 h-2 w-2 rounded-full bg-primary" />
      )}
    </div>
  );
}

// ── NotificationDropdown ──────────────────────────────────────────────────────

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    refetchInterval: 30_000,
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const recent = notifications.slice(0, 10);

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      {/* Bell trigger */}
      <button
        onClick={() => setOpen((x) => !x)}
        className="relative rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border bg-popover shadow-lg">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-semibold">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {unreadCount} new
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications yet
              </p>
            ) : (
              recent.map((n) => (
                <NotificationRow
                  key={n.id}
                  notif={n}
                  onMarkRead={(id) => markRead.mutate(id)}
                  onNavigate={(path) => {
                    setOpen(false);
                    navigate(path);
                  }}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-4 py-2.5">
            <NavLink
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-primary hover:underline"
            >
              View all notifications →
            </NavLink>
          </div>
        </div>
      )}
    </div>
  );
}
