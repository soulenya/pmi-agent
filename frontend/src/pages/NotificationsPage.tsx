import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, AlertCircle, ClipboardCheck, FileText, Info, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { listNotifications, markNotificationRead, markAllNotificationsRead } from "@/api/chat";
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
  const markRead = useMutation({
    mutationFn: () => markNotificationRead(notif.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

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
      </div>
      {!notif.is_read && (
        <button
          onClick={() => markRead.mutate()}
          disabled={markRead.isPending}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          title="Mark as read"
        >
          <CheckCheck className="h-3.5 w-3.5" />
        </button>
      )}
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
