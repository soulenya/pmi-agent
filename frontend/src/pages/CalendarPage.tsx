import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarDays, CheckSquare, Users, X, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/contexts/AppContext";
import { listTasks } from "@/api/tasks";
import { listMeetings } from "@/api/meetings";
import { getGoogleStatus, listGoogleCalendarEvents } from "@/api/google";
import type { Task } from "@/types/tasks";
import type { MeetingNote } from "@/types/meetings";
import type { GoogleCalendarEvent } from "@/api/google";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const cells: (Date | null)[] = [];
  // pad start (Sun=0)
  for (let i = 0; i < firstDay.getDay(); i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  // pad end to full weeks
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Day panel ─────────────────────────────────────────────────────────────────

function DayPanel({
  date,
  tasks,
  meetings,
  gcalEvents,
  onClose,
}: {
  date: Date;
  tasks: Task[];
  meetings: MeetingNote[];
  gcalEvents: GoogleCalendarEvent[];
  onClose: () => void;
}) {
  const timezone = useTimezone();
  return (
    <div className="w-72 shrink-0 rounded-xl border bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold text-sm">
          {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: timezone })}
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {tasks.length === 0 && meetings.length === 0 && gcalEvents.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">Nothing scheduled.</p>
        )}
        {tasks.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Tasks due
            </p>
            <div className="space-y-1">
              {tasks.map((t) => (
                <NavLink
                  key={t.id}
                  to="/tasks"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent text-sm transition-colors"
                >
                  <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="flex-1 truncate">{t.title}</span>
                  <span
                    className={cn(
                      "shrink-0 text-[10px] rounded-full px-1.5 py-0.5",
                      t.priority === "critical"
                        ? "bg-red-100 text-red-700"
                        : t.priority === "high"
                          ? "bg-orange-100 text-orange-700"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {t.priority}
                  </span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
        {meetings.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Meetings
            </p>
            <div className="space-y-1">
              {meetings.map((m) => (
                <NavLink
                  key={m.id}
                  to="/meetings"
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
                >
                  <Users className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm truncate">{m.title}</p>
                    {m.attendees.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {m.attendees.slice(0, 3).join(", ")}
                        {m.attendees.length > 3 && ` +${m.attendees.length - 3}`}
                      </p>
                    )}
                  </div>
                </NavLink>
              ))}
            </div>
          </div>
        )}
        {gcalEvents.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Google Calendar
            </p>
            <div className="space-y-1">
              {gcalEvents.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 bg-purple-50 dark:bg-purple-950/30">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-purple-500" />
                  <div className="min-w-0">
                    <p className="text-sm truncate">{ev.title}</p>
                    {ev.start && (
                      <p className="text-[10px] text-muted-foreground">
                    {new Date(ev.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: timezone })}
                        {ev.end && ` \u2013 ${new Date(ev.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: timezone })}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Calendar page ─────────────────────────────────────────────────────────────

export function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showGCalEvents, setShowGCalEvents] = useState(true);

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
    staleTime: 60_000,
  });

  const { data: meetings = [] } = useQuery({
    queryKey: ["meetings"],
    queryFn: listMeetings,
    staleTime: 60_000,
  });

  const { data: googleStatus } = useQuery({
    queryKey: ["google-status"],
    queryFn: getGoogleStatus,
    staleTime: 60_000,
  });

  const { data: gcalEvents = [], refetch: refetchGcal, isFetching: gcalFetching, error: gcalError } = useQuery({
    queryKey: ["gcal-events"],
    queryFn: () => listGoogleCalendarEvents(30, 60),
    enabled: googleStatus?.connected === true && showGCalEvents,
    staleTime: 300_000,
  });

  // Build lookup maps: date string (YYYY-MM-DD) → items
  const tasksByDate = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.due_date && t.status !== "cancelled") {
      const key = t.due_date.slice(0, 10);
      if (!tasksByDate.has(key)) tasksByDate.set(key, []);
      tasksByDate.get(key)!.push(t);
    }
  }

  const meetingsByDate = new Map<string, MeetingNote[]>();
  for (const m of meetings) {
    if (m.meeting_date) {
      const key = m.meeting_date.slice(0, 10);
      if (!meetingsByDate.has(key)) meetingsByDate.set(key, []);
      meetingsByDate.get(key)!.push(m);
    }
  }

  const gcalByDate = new Map<string, GoogleCalendarEvent[]>();
  for (const ev of gcalEvents) {
    const key = (ev.start ?? "").slice(0, 10);
    if (key) {
      if (!gcalByDate.has(key)) gcalByDate.set(key, []);
      gcalByDate.get(key)!.push(ev);
    }
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const cells = monthGrid(year, month);

  const panelTasks = selectedDate
    ? (tasksByDate.get(
        `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`
      ) ?? [])
    : [];

  const panelMeetings = selectedDate
    ? (meetingsByDate.get(
        `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`
      ) ?? [])
    : [];

  const panelGcal = selectedDate
    ? (gcalByDate.get(
        `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`
      ) ?? [])
    : [];

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Task due dates and meeting schedule</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="rounded-md border p-1.5 hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[130px] text-center font-semibold">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="rounded-md border p-1.5 hover:bg-accent transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDate(today); }}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            Today
          </button>
          {googleStatus?.connected && (
            <button
              onClick={() => refetchGcal()}
              disabled={gcalFetching}
              title="Sync Google Calendar"
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", gcalFetching && "animate-spin")} />
              Sync
            </button>
          )}
        </div>
      </div>

      {/* Google Calendar error */}
      {gcalError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Google Calendar sync failed: {(gcalError as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" /> Task due</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" /> Overdue task</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-500" /> Meeting</span>
        {googleStatus?.connected && (
          <button
            onClick={() => setShowGCalEvents((v) => !v)}
            className={cn("flex items-center gap-1.5 transition-opacity", !showGCalEvents && "opacity-40")}
          >
            <span className="h-2 w-2 rounded-full bg-purple-500" /> Google Calendar
          </button>
        )}
      </div>

      <div className="flex gap-4">
        {/* Calendar grid */}
        <div className="flex-1 rounded-xl border bg-card overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b">
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7">
            {cells.map((date, idx) => {
              if (!date) {
                return <div key={`empty-${idx}`} className="h-24 border-b border-r last:border-r-0 bg-muted/20" />;
              }

              const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
              const dayTasks = tasksByDate.get(dateKey) ?? [];
              const dayMeetings = meetingsByDate.get(dateKey) ?? [];
              const dayGcal = gcalByDate.get(dateKey) ?? [];
              const isToday = isSameDay(date, today);
              const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;
              const hasItems = dayTasks.length > 0 || dayMeetings.length > 0 || dayGcal.length > 0;
              const overdueTasks = dayTasks.filter(t => t.status !== "done" && date < today);

              return (
                <button
                  key={dateKey}
                  onClick={() => setSelectedDate(isSelected ? null : date)}
                  className={cn(
                    "h-24 border-b border-r last:border-r-0 p-1.5 text-left flex flex-col gap-0.5 transition-colors",
                    (idx + 1) % 7 === 0 && "border-r-0",
                    isSelected
                      ? "bg-primary/10"
                      : hasItems
                        ? "hover:bg-accent/50"
                        : "hover:bg-accent/20",
                    date.getMonth() !== month && "opacity-40"
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-medium w-6 h-6 rounded-full flex items-center justify-center",
                      isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <div className="flex flex-wrap gap-0.5 mt-auto">
                    {overdueTasks.slice(0, 3).map((t) => (
                      <span key={t.id} className="h-1.5 w-1.5 rounded-full bg-destructive" title={t.title} />
                    ))}
                    {dayTasks.filter(t => t.status !== "done" && date >= today).slice(0, 3).map((t) => (
                      <span key={t.id} className="h-1.5 w-1.5 rounded-full bg-blue-500" title={t.title} />
                    ))}
                    {dayTasks.filter(t => t.status === "done").slice(0, 2).map((t) => (
                      <span key={t.id} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" title={t.title} />
                    ))}
                    {dayMeetings.slice(0, 3).map((m) => (
                      <span key={m.id} className="h-1.5 w-1.5 rounded-full bg-green-500" title={m.title} />
                    ))}
                    {dayGcal.slice(0, 3).map((ev) => (
                      <span key={ev.id} className="h-1.5 w-1.5 rounded-full bg-purple-500" title={ev.title} />
                    ))}
                  </div>
                  {/* Mini labels for visible items */}
                  <div className="space-y-0.5 mt-0.5">
                    {dayTasks.slice(0, 1).map((t) => (
                      <p key={t.id} className="text-[9px] leading-tight truncate text-muted-foreground">
                        {t.title}
                      </p>
                    ))}
                    {dayMeetings.slice(0, 1).map((m) => (
                      <p key={m.id} className="text-[9px] leading-tight truncate text-green-600 dark:text-green-400">
                        {m.title}
                      </p>
                    ))}
                    {dayGcal.slice(0, 1).map((ev) => (
                      <p key={ev.id} className="text-[9px] leading-tight truncate text-purple-600 dark:text-purple-400">
                        {ev.title}
                      </p>
                    ))}
                    {(dayTasks.length + dayMeetings.length + dayGcal.length) > 2 && (
                      <p className="text-[9px] text-muted-foreground/60">
                        +{dayTasks.length + dayMeetings.length + dayGcal.length - 2} more
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Day detail panel */}
        {selectedDate && (
          <DayPanel
            date={selectedDate}
            tasks={panelTasks}
            meetings={panelMeetings}
            gcalEvents={panelGcal}
            onClose={() => setSelectedDate(null)}
          />
        )}
      </div>
    </div>
  );
}
