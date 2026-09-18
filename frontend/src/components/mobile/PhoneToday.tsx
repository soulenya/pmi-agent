/**
 * Today, on a phone: what needs you, what is on today, what is due soon.
 *
 * The desktop page is a three-column dashboard with a briefing, recent chats
 * and the whole Waiting list embedded. On a 390px screen that is four layers
 * of navigation before the first useful line. Here each section is one card,
 * one line per item, and anything that is a page of its own is a link to it.
 */
import { useState } from "react";
import { NavLink } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import type { GoogleCalendarEvent } from "@/api/google";
import type { SourcedTask } from "@/hooks/useAllWork";
import type { MeetingNote } from "@/types/meetings";
import { formatWhen } from "@/lib/formatWhen";
import { cn } from "@/lib/utils";
import { peekTask } from "@/stores/peekStore";

export interface PhoneTodayProps {
  greeting: string;
  dateLabel: string;
  timezone: string;
  counts: { approvals: number; suggestions: number; notifications: number; total: number };
  overdue: SourcedTask[];
  todayEvents: GoogleCalendarEvent[];
  todayTasks: SourcedTask[];
  todayMeetings: MeetingNote[];
  weekTasks: SourcedTask[];
  briefing: string | null | undefined;
  briefingLoading: boolean;
  onRefreshBriefing: () => void;
}

function eventTime(iso: string, timezone: string): string {
  if (!iso.includes("T")) return "All day";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

function Card({
  title,
  icon,
  to,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  to?: string;
  tone?: "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        tone === "warn" && "border-amber-500/40",
        tone === "danger" && "border-destructive/40",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}
          {title}
        </h2>
        {to && (
          <NavLink to={to} className="flex items-center text-xs text-muted-foreground">
            All <ChevronRight className="h-3.5 w-3.5" />
          </NavLink>
        )}
      </div>
      <div className="divide-y border-t">{children}</div>
    </section>
  );
}

const row = "flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-sm active:bg-accent";

function TaskRow({ task, danger }: { task: SourcedTask; danger?: boolean }) {
  return (
    <button type="button" onClick={() => peekTask(task.id, task.source)} className={row}>
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      {task.due_date && (
        <span className={cn("shrink-0 text-xs", danger ? "font-medium text-destructive" : "text-muted-foreground")}>
          {formatWhen(task.due_date, { overdue: true })}
        </span>
      )}
    </button>
  );
}

export function PhoneToday(p: PhoneTodayProps) {
  const [briefingOpen, setBriefingOpen] = useState(false);
  const agenda = p.todayEvents.length + p.todayTasks.length + p.todayMeetings.length;
  const waiting = p.counts.total;

  return (
    <div className="flex flex-col gap-3">
      <div className="px-1">
        <p className="text-lg font-semibold leading-tight">{p.greeting}</p>
        <p className="text-xs text-muted-foreground">{p.dateLabel}</p>
      </div>

      {waiting > 0 && (
        <NavLink
          to="/waiting"
          className="flex min-h-12 items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 active:bg-amber-500/10"
        >
          <Bell className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Waiting for you</span>
            <span className="block truncate text-xs text-muted-foreground">
              {[
                p.counts.approvals > 0 && `${p.counts.approvals} approval${p.counts.approvals === 1 ? "" : "s"}`,
                p.counts.suggestions > 0 && `${p.counts.suggestions} suggestion${p.counts.suggestions === 1 ? "" : "s"}`,
                p.counts.notifications > 0 && `${p.counts.notifications} notification${p.counts.notifications === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </NavLink>
      )}

      {p.overdue.length > 0 && (
        <Card title={`Overdue (${p.overdue.length})`} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} to="/tasks" tone="danger">
          {p.overdue.slice(0, 4).map((t) => <TaskRow key={t.id} task={t} danger />)}
        </Card>
      )}

      <Card title="Today" icon={<CalendarDays className="h-4 w-4 text-primary" />} to="/calendar">
        {agenda === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">Nothing scheduled today.</p>}
        {p.todayEvents.map((e) => (
          <NavLink key={e.id} to="/calendar" className={row}>
            <span className="min-w-0 flex-1 truncate">{e.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{eventTime(e.start, p.timezone)}</span>
          </NavLink>
        ))}
        {p.todayTasks.map((t) => <TaskRow key={t.id} task={t} />)}
        {p.todayMeetings.map((m) => (
          <NavLink key={m.id} to="/meetings" className={row}>
            <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">{m.title}</span>
          </NavLink>
        ))}
      </Card>

      {p.weekTasks.length > 0 && (
        <Card title="Due this week" icon={<Clock className="h-4 w-4 text-orange-500" />} to="/tasks">
          {p.weekTasks.slice(0, 5).map((t) => <TaskRow key={t.id} task={t} />)}
        </Card>
      )}

      <section className="overflow-hidden rounded-xl border bg-card">
        <button
          type="button"
          onClick={() => setBriefingOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-left"
          aria-expanded={briefingOpen}
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" /> Today's briefing
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", briefingOpen && "rotate-180")} />
        </button>
        {briefingOpen && (
          <div className="border-t px-3 py-3">
            {p.briefingLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Generating…
              </p>
            ) : p.briefing ? (
              <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:mb-1 prose-headings:mt-2 prose-ul:my-1 prose-li:my-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.briefing}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No briefing yet.</p>
            )}
            <button
              type="button"
              onClick={p.onRefreshBriefing}
              disabled={p.briefingLoading}
              className="mt-2 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground active:bg-accent disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", p.briefingLoading && "animate-spin")} /> Refresh
            </button>
          </div>
        )}
      </section>

      <NavLink
        to="/chat"
        className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm active:bg-accent"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <span className="flex-1">Ask Gerry</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </NavLink>
    </div>
  );
}
