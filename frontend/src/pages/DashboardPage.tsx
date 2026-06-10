import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTimezone } from "@/contexts/AppContext";
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
  CalendarDays,
  Users,
  CheckCircle2,
  Circle,
  FolderOpen,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listPendingApprovals, listNotifications, listConversations } from "@/api/chat";
import { listTasks, listProjects } from "@/api/tasks";
import { listMeetings } from "@/api/meetings";
import { getTodayBriefing } from "@/api/regulatory";
import { getGoogleStatus, listGoogleCalendarEvents, type GoogleCalendarEvent } from "@/api/google";
import type { Task } from "@/types/tasks";
import type { MeetingNote } from "@/types/meetings";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isThisWeek(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return d >= startOfWeek && d < endOfWeek;
}

function daysFromNow(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function formatShortDate(iso: string): string {
  const timezone = (() => { try { return localStorage.getItem("pmi-timezone") ?? "UTC"; } catch { return "UTC"; } })();
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timezone });
}

const DASH_STATUS_ICON: Record<string, React.ReactNode> = {
  backlog: <Circle className="h-3 w-3 text-muted-foreground" />,
  todo: <Circle className="h-3 w-3 text-blue-400" />,
  in_progress: <Clock className="h-3 w-3 text-yellow-500" />,
  in_review: <AlertTriangle className="h-3 w-3 text-orange-400" />,
  done: <CheckCircle2 className="h-3 w-3 text-green-500" />,
  cancelled: <Circle className="h-3 w-3 text-muted-foreground/40" />,
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, to, urgent, icon: Icon,
}: {
  label: string; value: number | string; sub?: string; to: string; urgent?: boolean; icon?: React.ElementType;
}) {
  return (
    <NavLink to={to} className="group rounded-xl border bg-card p-5 hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        {Icon && <Icon className={cn("h-4 w-4", urgent ? "text-destructive" : "text-muted-foreground/40")} />}
      </div>
      <p className={cn("text-3xl font-bold mt-2", urgent ? "text-destructive" : "text-foreground")}>{value}</p>
      {sub && <p className={cn("text-xs mt-1", urgent ? "text-destructive/70" : "text-muted-foreground")}>{sub}</p>}
    </NavLink>
  );
}

// ── Agenda items ──────────────────────────────────────────────────────────────

function TaskAgendaItem({ task }: { task: Task }) {
  const overdue = task.due_date && new Date(task.due_date) < new Date();
  return (
    <NavLink to="/tasks" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/40 transition-colors">
      <span className="shrink-0">{DASH_STATUS_ICON[task.status]}</span>
      <span className="flex-1 min-w-0 text-sm truncate">{task.title}</span>
      {task.due_date && (
        <span className={cn("shrink-0 text-xs", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
          {overdue ? `${Math.abs(daysFromNow(task.due_date))}d ago` : "Today"}
        </span>
      )}
    </NavLink>
  );
}

function MeetingAgendaItem({ meeting }: { meeting: MeetingNote }) {
  return (
    <NavLink to="/meetings" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/40 transition-colors">
      <Users className="h-3 w-3 shrink-0 text-primary" />
      <span className="flex-1 min-w-0 text-sm truncate">{meeting.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {meeting.attendees.length > 0 ? `${meeting.attendees.length} attendees` : "Meeting"}
      </span>
    </NavLink>
  );
}

function formatEventTime(iso: string, timezone: string): string {
  if (!iso.includes("T")) return "All day";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

function CalendarEventItem({ event, timezone, showDate = false }: { event: GoogleCalendarEvent; timezone: string; showDate?: boolean }) {
  return (
    <NavLink to="/calendar" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/40 transition-colors">
      <CalendarDays className="h-3 w-3 shrink-0 text-sky-500" />
      <span className="flex-1 min-w-0 text-sm truncate">{event.title}</span>
      {event.location && (
        <span className="hidden sm:block shrink-0 max-w-[10rem] truncate text-xs text-muted-foreground/70">{event.location}</span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">
        {showDate && event.start ? `${formatShortDate(event.start)} · ` : ""}
        {formatEventTime(event.start, timezone)}
      </span>
    </NavLink>
  );
}

function WeekTaskRow({ task }: { task: Task }) {
  const days = task.due_date ? daysFromNow(task.due_date) : null;
  return (
    <NavLink to="/tasks" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/40 transition-colors">
      <span className="shrink-0">{DASH_STATUS_ICON[task.status]}</span>
      <span className="flex-1 min-w-0 text-sm truncate">{task.title}</span>
      {task.due_date && (
        <span className={cn("shrink-0 text-xs rounded-full px-1.5 py-0.5", days !== null && days <= 1 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground")}>
          {days === 0 ? "Today" : days === 1 ? "Tomorrow" : formatShortDate(task.due_date)}
        </span>
      )}
    </NavLink>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks"], queryFn: () => listTasks(), staleTime: 60_000 });
  const { data: approvals = [] } = useQuery({ queryKey: ["approvals", "pending"], queryFn: listPendingApprovals, refetchInterval: 30_000 });
  const { data: notifications = [] } = useQuery({ queryKey: ["notifications"], queryFn: listNotifications, staleTime: 60_000 });
  const { data: conversations = [] } = useQuery({ queryKey: ["conversations"], queryFn: listConversations, staleTime: 60_000 });
  const { data: meetings = [] } = useQuery({ queryKey: ["meetings"], queryFn: listMeetings, staleTime: 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => listProjects(false), staleTime: 60_000 });
  const { data: briefing, isLoading: briefingLoading, refetch: refetchBriefing, isFetching } = useQuery({
    queryKey: ["briefing", "today"], queryFn: () => getTodayBriefing(), staleTime: 5 * 60_000,
  });
  // ── Google Calendar (only queried when Google is connected) ──────────────
  const { data: googleStatus } = useQuery({
    queryKey: ["google-status"], queryFn: getGoogleStatus, staleTime: 5 * 60_000, retry: false,
  });
  const { data: calendarEvents = [] } = useQuery({
    queryKey: ["dashboard-calendar"],
    queryFn: () => listGoogleCalendarEvents(0, 7),
    enabled: googleStatus?.connected === true,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const now = new Date();
  const timezone = useTimezone();
  const activeTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const overdueTasks = activeTasks
    .filter((t) => t.due_date && new Date(t.due_date) < now)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
  const todayTasks = activeTasks.filter((t) => isToday(t.due_date));
  const todayMeetings = meetings.filter((m) => isToday(m.meeting_date));
  const todayEvents = calendarEvents
    .filter((e) => isToday(e.start))
    .sort((a, b) => a.start.localeCompare(b.start));
  const upcomingEvents = calendarEvents
    .filter((e) => !isToday(e.start) && new Date(e.start.includes("T") ? e.start : `${e.start}T00:00:00`) > now)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 6);
  const agendaItems = todayTasks.length + todayMeetings.length + todayEvents.length;
  const weekTasks = activeTasks
    .filter((t) => t.due_date && isThisWeek(t.due_date) && !isToday(t.due_date))
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
    .slice(0, 6);
  const unreadNotifications = notifications.filter((n) => !n.is_read);
  const recentConversations = conversations.slice(0, 5);
  const activeProjects = projects.filter((p) => p.status === "active");
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const totalTasks = tasks.filter((t) => t.parent_task_id === null).length;
  const completionPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Good morning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: timezone })}
            {agendaItems > 0 && (
              <span className="ml-2 text-primary font-medium">
                &middot; {agendaItems} item{agendaItems !== 1 ? "s" : ""} on today&apos;s agenda
              </span>
            )}
          </p>
        </div>
        {overdueTasks.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {overdueTasks.length} overdue
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Tasks" value={activeTasks.length} sub={overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : `${completionPct}% complete`} to="/tasks" urgent={overdueTasks.length > 0} icon={CheckSquare} />
        <StatCard label="Pending Approvals" value={approvals.length} sub={approvals.length > 0 ? "Needs your decision" : "All clear"} to="/approvals" urgent={approvals.length > 0} icon={ShieldCheck} />
        <StatCard label="Unread Notifications" value={unreadNotifications.length} sub={unreadNotifications.length > 0 ? "Click to review" : "All caught up"} to="/notifications" urgent={unreadNotifications.length > 0} icon={Bell} />
        <StatCard label="Active Projects" value={activeProjects.length} sub={`${conversations.length} conversation${conversations.length !== 1 ? "s" : ""}`} to="/projects" icon={FolderOpen} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2/3 */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Today's Agenda */}
          {agendaItems > 0 && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  Today&apos;s Agenda
                </h2>
                <span className="text-xs text-muted-foreground">{agendaItems} item{agendaItems !== 1 ? "s" : ""}</span>
              </div>
              <div className="px-3 py-2 space-y-0.5">
                {todayEvents.map((e) => <CalendarEventItem key={e.id} event={e} timezone={timezone} />)}
                {todayTasks.map((t) => <TaskAgendaItem key={t.id} task={t} />)}
                {todayMeetings.map((m) => <MeetingAgendaItem key={m.id} meeting={m} />)}
              </div>
            </div>
          )}

          {/* Daily briefing */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Today&apos;s Briefing
              </h2>
              <button onClick={() => refetchBriefing()} disabled={isFetching} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors">
                <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
                Refresh
              </button>
            </div>
            <div className="px-5 py-4">
              {briefingLoading || isFetching ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating briefing&hellip;
                </div>
              ) : briefing?.full_content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:mb-1 prose-headings:mt-2 prose-ul:my-1 prose-li:my-0">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{briefing.full_content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-2">No briefing available. Click Refresh to generate one.</p>
              )}
            </div>
          </div>

          {/* Upcoming calendar events */}
          {upcomingEvents.length > 0 && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-sky-500" />
                  Upcoming Events
                </h2>
                <NavLink to="/calendar" className="text-xs text-muted-foreground hover:underline">Calendar &rarr;</NavLink>
              </div>
              <div className="px-3 py-2 space-y-0.5">
                {upcomingEvents.map((e) => <CalendarEventItem key={e.id} event={e} timezone={timezone} showDate />)}
              </div>
            </div>
          )}

          {/* Due this week */}
          {weekTasks.length > 0 && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-500" />
                  Due This Week
                </h2>
                <NavLink to="/tasks" className="text-xs text-muted-foreground hover:underline">View all &rarr;</NavLink>
              </div>
              <div className="px-3 py-2 space-y-0.5">
                {weekTasks.map((t) => <WeekTaskRow key={t.id} task={t} />)}
              </div>
            </div>
          )}
        </div>

        {/* Right 1/3 */}
        <div className="flex flex-col gap-4">
          {/* Overdue */}
          {overdueTasks.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden">
              <div className="flex items-center justify-between border-b border-destructive/20 px-4 py-3">
                <h2 className="text-sm font-semibold flex items-center gap-1.5 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" /> Overdue
                </h2>
                <NavLink to="/tasks" className="text-xs text-destructive/70 hover:underline">All &rarr;</NavLink>
              </div>
              <div className="px-3 py-2 space-y-0.5">
                {overdueTasks.slice(0, 5).map((t) => <TaskAgendaItem key={t.id} task={t} />)}
                {overdueTasks.length > 5 && (
                  <NavLink to="/tasks" className="block px-2 py-1 text-xs text-destructive hover:underline">
                    +{overdueTasks.length - 5} more
                  </NavLink>
                )}
              </div>
            </div>
          )}

          {/* Recent chats */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" /> Recent Chats
              </h2>
              <NavLink to="/chat" className="text-xs text-muted-foreground hover:underline">New &rarr;</NavLink>
            </div>
            <div className="px-3 py-2">
              {recentConversations.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet.</p>
              ) : (
                <div className="space-y-0.5">
                  {recentConversations.map((c) => (
                    <NavLink key={c.id} to={`/chat/${c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors group">
                      <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                      <span className="flex-1 truncate text-xs text-muted-foreground group-hover:text-foreground">
                        {c.title ?? "Untitled conversation"}
                      </span>
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30" />
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Quick Actions</h2>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              {[
                { to: "/chat", icon: MessageSquare, label: "Ask AI" },
                { to: "/tasks", icon: CheckSquare, label: "Tasks" },
                { to: "/projects", icon: FolderOpen, label: "Projects" },
                { to: "/approvals", icon: ShieldCheck, label: "Approvals" },
                { to: "/meetings", icon: Users, label: "Meetings" },
                { to: "/calendar", icon: CalendarDays, label: "Calendar" },
              ].map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} className="flex flex-col items-center gap-1.5 rounded-lg border bg-muted/30 py-3 px-2 hover:bg-accent transition-colors">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

