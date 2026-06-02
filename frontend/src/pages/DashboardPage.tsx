import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { MessageSquare, CheckSquare, ShieldCheck, Bell, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { listPendingApprovals, listNotifications } from "@/api/chat";
import { listTasks } from "@/api/tasks";
import { getTodayBriefing } from "@/api/regulatory";

function StatCard({
  label,
  value,
  sub,
  to,
  urgent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  to: string;
  urgent?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className="rounded-lg border bg-card p-5 hover:bg-accent/30 transition-colors"
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-3xl font-bold mt-1",
          urgent ? "text-destructive" : "text-foreground"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </NavLink>
  );
}

export function DashboardPage() {
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: listTasks,
    staleTime: 60_000,
  });

  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: listPendingApprovals,
    refetchInterval: 30_000,
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    staleTime: 60_000,
  });

  const { data: briefing, isLoading: briefingLoading, refetch: refetchBriefing, isFetching } = useQuery({
    queryKey: ["briefing", "today"],
    queryFn: () => getTodayBriefing(),
    staleTime: 5 * 60_000,
  });

  const activeTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const overdueTasks = activeTasks.filter(
    (t) => t.due_date && new Date(t.due_date) < new Date()
  );
  const unreadNotifications = notifications.filter((n) => !n.is_read);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          PMI Agent — VACTOR Platform ·{" "}
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Tasks"
          value={activeTasks.length}
          sub={overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : "All on track"}
          to="/tasks"
          urgent={overdueTasks.length > 0}
        />
        <StatCard
          label="Pending Approvals"
          value={approvals.length}
          sub={approvals.length > 0 ? "Awaiting decision" : "None pending"}
          to="/approvals"
          urgent={approvals.length > 0}
        />
        <StatCard
          label="Notifications"
          value={unreadNotifications.length}
          sub="Unread"
          to="/notifications"
          urgent={unreadNotifications.length > 0}
        />
        <StatCard label="Conversations" value="→" sub="Start a new chat" to="/chat" />
      </div>

      {/* Daily briefing */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-base">Today's Briefing</h2>
          <button
            onClick={() => refetchBriefing()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>

        {briefingLoading ? (
          <p className="text-sm text-muted-foreground">Generating briefing…</p>
        ) : briefing ? (
          <div className="space-y-3">
            {briefing.headline && (
              <p className="font-medium text-sm">{briefing.headline}</p>
            )}
            {briefing.full_content && (
              <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {briefing.full_content}
              </pre>
            )}
            {(briefing.priority_items as unknown[])?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Priority Items
                </p>
                <ul className="space-y-1">
                  {(
                    briefing.priority_items as Array<{
                      title: string;
                      priority?: string;
                      due?: string;
                    }>
                  ).map((item, i) => (
                    <li key={i} className="text-sm flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                      {item.title}
                      {item.due && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          due {item.due}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No briefing available.</p>
        )}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="font-semibold text-base mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { to: "/chat", icon: MessageSquare, label: "Ask AI Assistant" },
            { to: "/tasks", icon: CheckSquare, label: "View Tasks" },
            { to: "/regulatory", icon: ShieldCheck, label: "Regulatory Docs" },
            { to: "/approvals", icon: Bell, label: "Approvals" },
          ].map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-accent/30 transition-colors"
            >
              <Icon className="h-5 w-5 text-primary shrink-0" />
              <span className="text-sm font-medium">{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}
