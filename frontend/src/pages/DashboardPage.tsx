import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MessageSquare,
  CheckSquare,
  ShieldCheck,
  Bell,
  RefreshCw,
  AlertTriangle,
  Clock,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listPendingApprovals, listNotifications, listConversations } from "@/api/chat";
import { listTasks } from "@/api/tasks";
import { getTodayBriefing } from "@/api/regulatory";
import type { Task } from "@/types/tasks";

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  to,
  urgent,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  to: string;
  urgent?: boolean;
  icon?: React.ElementType;
}) {
  return (
    <NavLink
      to={to}
      className="group rounded-lg border bg-card p-5 hover:bg-accent/30 transition-colors"
    >
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && <Icon className={cn("h-4 w-4", urgent ? "text-destructive" : "text-muted-foreground/50")} />}
      </div>
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

// ── Overdue task chip ──────────────────────────────────────────────────────────

function OverdueChip({ task }: { task: Task }) {
  const daysAgo = task.due_date
    ? Math.ceil((Date.now() - new Date(task.due_date).getTime()) / 86_400_000)
    : 0;
  return (
    <NavLink
      to="/tasks"
      className="flex items-center gap-2 rounded-md border bg-destructive/5 px-3 py-2 text-sm hover:bg-destructive/10 transition-colors"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
      <span className="flex-1 truncate text-sm">{task.title}</span>
      <span className="shrink-0 text-xs text-destructive">{daysAgo}d overdue</span>
    </NavLink>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
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

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
    staleTime: 60_000,
  });

  const {
    data: briefing,
    isLoading: briefingLoading,
    refetch: refetchBriefing,
    isFetching,
  } = useQuery({
    queryKey: ["briefing", "today"],
    queryFn: () => getTodayBriefing(),
    staleTime: 5 * 60_000,
  });

  const activeTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const overdueTasks = activeTasks
    .filter((t) => t.due_date && new Date(t.due_date) < new Date())
    .slice(0, 4);
  const unreadNotifications = notifications.filter((n) => !n.is_read);
  const recentConversations = conversations.slice(0, 5);

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Header */}
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
          icon={CheckSquare}
        />
        <StatCard
          label="Pending Approvals"
          value={approvals.length}
          sub={approvals.length > 0 ? "Awaiting decision" : "None pending"}
          to="/approvals"
          urgent={approvals.length > 0}
          icon={ShieldCheck}
        />
        <StatCard
          label="Unread Notifications"
          value={unreadNotifications.length}
          sub="Messages"
          to="/notifications"
          urgent={unreadNotifications.length > 0}
          icon={Bell}
        />
        <StatCard
          label="Conversations"
          value={conversations.length}
          sub="Start a new chat"
          to="/chat"
          icon={MessageSquare}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily briefing — spans 2 cols */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
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

          {briefingLoading || isFetching ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating briefing…
            </div>
          ) : briefing?.full_content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:mb-1 prose-headings:mt-2 prose-ul:my-1 prose-li:my-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {briefing.full_content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No briefing available.</p>
          )}
        </div>

        {/* Right column: overdue tasks + recent conversations */}
        <div className="flex flex-col gap-4">
          {/* Overdue tasks */}
          {overdueTasks.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Overdue
                </h2>
                <NavLink to="/tasks" className="text-xs text-muted-foreground hover:underline">
                  All tasks
                </NavLink>
              </div>
              <div className="space-y-1.5">
                {overdueTasks.map((t) => (
                  <OverdueChip key={t.id} task={t} />
                ))}
              </div>
            </div>
          )}

          {/* Recent conversations */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                Recent Chats
              </h2>
              <NavLink to="/chat" className="text-xs text-muted-foreground hover:underline">
                New chat
              </NavLink>
            </div>
            {recentConversations.length === 0 ? (
              <p className="text-xs text-muted-foreground">No conversations yet.</p>
            ) : (
              <div className="space-y-1">
                {recentConversations.map((c) => (
                  <NavLink
                    key={c.id}
                    to={`/chat/${c.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors group"
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-muted-foreground group-hover:text-foreground">
                      {c.title ?? "Untitled conversation"}
                    </span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </div>
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
    queryFn: () => listTasks(),
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
