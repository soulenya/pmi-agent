/**
 * RoutineRunsCard — what the user's scheduled tasks produced lately, on Today.
 *
 * A weekly update written straight to Drive left no trace on Today and nothing
 * in Generated Files; this card lists each routine's last run with every link
 * it produced (Drive, web, generated files) and the first line of its output.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { CalendarClock, ChevronDown, ChevronRight, ExternalLink, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { formatWhen } from "@/lib/formatWhen";
import { listScheduledTasks, type ScheduledTask } from "@/api/scheduledTasks";
import { FileActionCard, extractFileLinks } from "@/components/chat/MessageBubble";
import { openExternal } from "@/lib/externalLinks";

const URL_RE = /https?:\/\/[^\s<>()[\]"']+/g;
const RECENT_DAYS = 8;

function runLinks(t: ScheduledTask): string[] {
  const out: string[] = [];
  for (const m of (t.last_run_output ?? "").matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:*_]+$/, "");
    if (url.includes("/api/files/")) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function runFiles(t: ScheduledTask): string[] {
  if (t.last_run_status !== "success") return [];
  if (t.last_run_files?.length) return t.last_run_files;
  return extractFileLinks(t.last_run_output ?? "");
}

function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "docs.google.com") {
      const kind = u.pathname.split("/")[1];
      return kind === "document" ? "Google Doc" : kind === "spreadsheets" ? "Google Sheet" : kind === "presentation" ? "Google Slides" : "Google Drive";
    }
    if (u.hostname.endsWith("drive.google.com")) return "Google Drive";
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function firstLine(output: string | null): string {
  const text = (output ?? "").replace(/^#+\s*/gm, "").trim();
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/\*\*/g, "").slice(0, 140);
}

function RunRow({ task }: { task: ScheduledTask }) {
  const [open, setOpen] = useState(false);
  const links = runLinks(task);
  const files = runFiles(task);
  const failed = task.last_run_status && task.last_run_status !== "success";
  return (
    <div className="rounded-md px-2 py-1.5 hover:bg-accent/30 transition-colors">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 text-left"
        title={open ? "Hide the run's output" : "Show the run's output"}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 min-w-0 text-sm truncate">{task.title}</span>
        <span className={cn("shrink-0 text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
          {failed ? "failed · " : ""}
          {task.last_run_at ? formatWhen(task.last_run_at) : "not yet run"}
        </span>
      </button>
      {!open && !failed && (links.length > 0 || files.length > 0 || task.last_run_output) && (
        <div className="ml-5.5 mt-1 flex flex-wrap items-center gap-1.5 pl-[22px]">
          {links.slice(0, 3).map((url) => (
            <button
              key={url}
              type="button"
              onClick={() => openExternal(url)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
            >
              <ExternalLink className="h-3 w-3" />
              {linkLabel(url)}
            </button>
          ))}
          {files.slice(0, 3).map((f) => (
            <span key={f} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" />
              {f.replace(/^[0-9a-f]{8}_/, "")}
            </span>
          ))}
          {links.length === 0 && files.length === 0 && (
            <span className="text-xs text-muted-foreground truncate">{firstLine(task.last_run_output)}</span>
          )}
        </div>
      )}
      {open && (
        <div className="mt-2 space-y-2 pl-[22px]">
          {links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {links.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => openExternal(url)}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                  title={url}
                >
                  <ExternalLink className="h-3 w-3" />
                  {linkLabel(url)}
                </button>
              ))}
            </div>
          )}
          {files.map((f) => (
            <FileActionCard key={f} filename={f} variant="surface" />
          ))}
          {task.last_run_output ? (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:mb-1 prose-headings:mt-2 prose-ul:my-1 prose-li:my-0 max-h-80 overflow-y-auto rounded-md border bg-muted/20 p-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.last_run_output}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No output recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function RoutineRunsCard() {
  const { data: tasks = [] } = useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: listScheduledTasks,
    staleTime: 60_000,
    retry: false,
  });
  const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
  const recent = tasks
    .filter((t) => t.last_run_at && new Date(t.last_run_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.last_run_at!).getTime() - new Date(a.last_run_at!).getTime());
  if (recent.length === 0) return null;
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="font-semibold flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          From your routines
        </h2>
        <NavLink to="/tasks?tab=routines" className="text-xs text-muted-foreground hover:underline">
          Routines &rarr;
        </NavLink>
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {recent.map((t) => (
          <RunRow key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}
