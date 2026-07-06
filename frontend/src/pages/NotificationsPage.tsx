import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, AlertCircle, ClipboardCheck, FileText, Info, MessageSquare, ShieldCheck, ShieldX, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { listNotifications, markNotificationRead, markAllNotificationsRead, resolveApproval } from "@/api/chat";
import { notificationRoute } from "@/components/NotificationDropdown";
import { pushApprovalOutcomeToast } from "@/stores/toastStore";
import type { Notification } from "@/types/chat";

const TYPE_ICON: Record<string, React.ReactNode> = {
  approval_required: <ClipboardCheck className="h-4 w-4 text-amber-500" />,
  task_due: <AlertCircle className="h-4 w-4 text-destructive" />,
  task_assigned: <CheckCheck className="h-4 w-4 text-blue-500" />,
  document_ingested: <FileText className="h-4 w-4 text-green-500" />,
  briefing_ready: <Info className="h-4 w-4 text-primary" />,
  feedback_submitted: <MessageSquare className="h-4 w-4 text-purple-500" />,
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

function NotificationRow({ notif }: { notif: Notification }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<string | null>(null);
  const markRead = useMutation({
    mutationFn: () => markNotificationRead(notif.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const isApproval =
    notif.type === "approval_required" &&
    notif.entity_type === "approval_intent" &&
    !!notif.entity_id;

  const act = useMutation({
    mutationFn: (approved: boolean) => resolveApproval(notif.entity_id!, { approved }),
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
      if (!notif.is_read) markRead.mutate();
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["email-drafts"] });
    },
    onError: (e: unknown) => {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setOutcome(status === 409 || status === 404 ? "Already handled" : "Failed — open Approvals");
      if (!notif.is_read) markRead.mutate();
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  const route = notificationRoute(notif);

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 transition-colors",
        notif.is_read ? "bg-card opacity-60" : "bg-card hover:bg-accent/30",
      )}
    >
      <div className="mt-0.5 shrink-0">
        {TYPE_ICON[notif.type] ?? <Bell className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm", !notif.is_read && "font-medium")}>{notif.title}</p>
        {notif.message && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{timeAgo(notif.created_at)}</p>
        {isApproval && !outcome && (
          <div className="mt-2 flex items-center gap-2">
            <button
              disabled={act.isPending}
              onClick={() => act.mutate(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {act.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Approve
            </button>
            <button
              disabled={act.isPending}
              onClick={() => act.mutate(false)}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <ShieldX className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        )}
        {outcome && (
          <p className="mt-1.5 text-xs font-medium text-muted-foreground">{outcome}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {route && (
          <Link
            to={route}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            title="Open"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
        {!notif.is_read && (
          <button
            onClick={() => markRead.mutate()}
            disabled={markRead.isPending}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
            title="Mark as read"
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    refetchInterval: 30_000,
  });

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-16">Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="rounded-lg border border-dashed py-20 text-center text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No notifications yet</p>
          <p className="text-sm mt-1">Overdue tasks and approval reminders will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <NotificationRow key={n.id} notif={n} />
          ))}
        </div>
      )}
    </div>
  );
}
