import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  ClipboardCheck,
  AlertCircle,
  FileText,
  Info,
  MessageSquare,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/api/chat";
import type { Notification } from "@/types/chat";

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

// ── NotificationRow ───────────────────────────────────────────────────────────

function NotificationRow({
  notif,
  onMarkRead,
}: {
  notif: Notification;
  onMarkRead: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b last:border-0 px-4 py-3 transition-colors",
        notif.is_read
          ? "hover:bg-accent/30"
          : "bg-accent/20 hover:bg-accent/40 cursor-pointer"
      )}
      onClick={() => !notif.is_read && onMarkRead(notif.id)}
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
