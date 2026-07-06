/**
 * Daily Assistant briefing panel — docked beside the solar system on the home
 * page. One glance shows today's schedule, unread email, tasks due, pending
 * approvals, assistant suggestions and an Odoo snapshot, each linking straight
 * to the right place. Every section loads independently so a slow or
 * disconnected source never blocks the rest.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  CalendarDays,
  Mail,
  ListTodo,
  ClipboardCheck,
  Lightbulb,
  Landmark,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiClient } from "@/api/client";
import { listGoogleCalendarEvents } from "@/api/google";
import { listTasks } from "@/api/tasks";
import { listSuggestions } from "@/api/assistant";
import { getOdooStatus, getOdooBankBalance } from "@/api/odoo";
import { usePendingApprovals } from "@/components/approvals/ApprovalCard";

const GOOGLE_PREFIX = "/api/google";
const OPEN_KEY = "briefingPanel.open";

interface InboxThreadLite {
  thread_id: string;
  subject: string;
  from: string;
  date: string;
}

function senderName(from: string): string {
  return (from.split("<")[0] || from).trim().replace(/^"|"$/g, "") || from;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Section({
  icon,
  title,
  to,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  to: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/60 px-4 py-3 last:border-0">
      <Link
        to={to}
        className="group mb-1.5 flex items-center justify-between"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
          {icon}
          {title}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              {count}
            </span>
          )}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground/70">{text}</p>;
}

export function BriefingPanel() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });

  function toggle() {
    setOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  }

  // Google connection gate for email/calendar sections
  const { data: gstatus } = useQuery<{ connected: boolean }>({
    queryKey: ["google-status"],
    queryFn: async () => (await apiClient.get(`${GOOGLE_PREFIX}/status`)).data,
    staleTime: 60_000,
    enabled: open,
  });
  const gConnected = gstatus?.connected === true;

  // Today's calendar
  const events = useQuery({
    queryKey: ["briefing", "calendar"],
    queryFn: () => listGoogleCalendarEvents(0, 1),
    enabled: open && gConnected,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const todayStr = new Date().toDateString();
  const todaysEvents = (events.data ?? [])
    .filter((e) => new Date(e.start).toDateString() === todayStr)
    .slice(0, 5);

  // Unread email
  const unread = useQuery({
    queryKey: ["briefing", "unread-email"],
    queryFn: async () => {
      const res = await apiClient.get<{ threads: InboxThreadLite[] }>(
        `${GOOGLE_PREFIX}/gmail/inbox`,
        { params: { q: "in:inbox is:unread", max: 5 } },
      );
      return res.data.threads ?? [];
    },
    enabled: open && gConnected,
    refetchInterval: 5 * 60_000,
    retry: false,
  });

  // Tasks due (today or overdue, not finished)
  const tasks = useQuery({
    queryKey: ["briefing", "tasks"],
    queryFn: () => listTasks(),
    enabled: open,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const dueTasks = (tasks.data ?? [])
    .filter(
      (t) =>
        t.due_date &&
        new Date(t.due_date) <= endOfToday &&
        t.status !== "done" &&
        t.status !== "cancelled",
    )
    .slice(0, 5);

  // Pending approvals
  const approvals = usePendingApprovals({ enabled: open });
  const pendingApprovals = approvals.data ?? [];

  // Assistant suggestions
  const suggestions = useQuery({
    queryKey: ["briefing", "suggestions"],
    queryFn: () => listSuggestions({ status: "pending" }),
    enabled: open,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const pendingSuggestions = suggestions.data ?? [];

  // Odoo snapshot
  const odooStatus = useQuery({
    queryKey: ["briefing", "odoo-status"],
    queryFn: getOdooStatus,
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const odooConnected = odooStatus.data?.connected === true;
  const bank = useQuery({
    queryKey: ["briefing", "odoo-bank"],
    queryFn: getOdooBankBalance,
    enabled: open && odooConnected,
    refetchInterval: 15 * 60_000,
    retry: false,
  });

  if (!open) {
    return (
      <button
        onClick={toggle}
        title="Open the Daily Assistant briefing"
        className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur hover:text-foreground"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
        Briefing
        <PanelRightOpen className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-30 flex h-full w-80 flex-col",
        "border-l bg-background/85 backdrop-blur-md",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Link to="/assistant" className="flex items-center gap-2 hover:opacity-80">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold">Daily Assistant</h2>
        </Link>
        <button
          onClick={toggle}
          title="Collapse the briefing"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Today's schedule */}
        <Section
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          title="Today"
          to="/calendar"
          count={todaysEvents.length}
        >
          {!gConnected ? (
            <Empty text="Connect Google to see your schedule." />
          ) : todaysEvents.length === 0 ? (
            <Empty text="No events today." />
          ) : (
            <ul className="space-y-1">
              {todaysEvents.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 font-medium text-muted-foreground">
                    {fmtTime(e.start)}
                  </span>
                  <span className="truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Unread email */}
        <Section
          icon={<Mail className="h-3.5 w-3.5" />}
          title="Unread email"
          to="/inbox"
          count={unread.data?.length}
        >
          {!gConnected ? (
            <Empty text="Connect Google to see your inbox." />
          ) : (unread.data ?? []).length === 0 ? (
            <Empty text="Inbox is clear." />
          ) : (
            <ul className="space-y-1">
              {(unread.data ?? []).map((t) => (
                <li key={t.thread_id} className="text-xs">
                  <span className="font-medium">{senderName(t.from)}</span>
                  <span className="text-muted-foreground"> — </span>
                  <span className="truncate text-muted-foreground">
                    {t.subject || "(no subject)"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Tasks due */}
        <Section
          icon={<ListTodo className="h-3.5 w-3.5" />}
          title="Tasks due"
          to="/tasks"
          count={dueTasks.length}
        >
          {dueTasks.length === 0 ? (
            <Empty text="Nothing due today." />
          ) : (
            <ul className="space-y-1">
              {dueTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      t.priority === "critical" || t.priority === "high"
                        ? "bg-red-400"
                        : "bg-amber-400",
                    )}
                  />
                  <span className="truncate">{t.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Pending approvals */}
        <Section
          icon={<ClipboardCheck className="h-3.5 w-3.5" />}
          title="Approvals"
          to="/approvals"
          count={pendingApprovals.length}
        >
          {pendingApprovals.length === 0 ? (
            <Empty text="Nothing needs your sign-off." />
          ) : (
            <ul className="space-y-1">
              {pendingApprovals.slice(0, 4).map((a) => (
                <li key={a.id} className="truncate text-xs">
                  {a.intent_title}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Suggestions */}
        <Section
          icon={<Lightbulb className="h-3.5 w-3.5" />}
          title="Suggestions"
          to="/assistant"
          count={pendingSuggestions.length}
        >
          {pendingSuggestions.length === 0 ? (
            <Empty text="No suggestions right now." />
          ) : (
            <ul className="space-y-1">
              {pendingSuggestions.slice(0, 4).map((s) => (
                <li key={s.id} className="truncate text-xs">
                  {s.title}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Odoo snapshot */}
        <Section icon={<Landmark className="h-3.5 w-3.5" />} title="Odoo ERP" to="/odoo">
          {!odooConnected ? (
            <Empty text="Odoo is not connected." />
          ) : bank.data && bank.data.accounts.length > 0 ? (
            <ul className="space-y-1">
              {bank.data.accounts.slice(0, 3).map((a, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{a.journal}</span>
                  <span className="shrink-0 font-medium">
                    {a.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}{" "}
                    {bank.data.currency}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="Connected — open for details." />
          )}
        </Section>
      </div>
    </div>
  );
}
