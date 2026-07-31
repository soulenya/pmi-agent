import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Loader2, Mail, MessageSquare, FileText, CalendarDays, LayoutGrid, Link2, PenLine } from "lucide-react";
import { draftGmailReply } from "@/api/google";
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";
import type { Task, TaskSourceKind, TaskSourceRef } from "@/types/tasks";

const KIND_ICON: Record<TaskSourceKind, React.ReactNode> = {
  gmail_thread: <Mail className="h-3.5 w-3.5" />,
  kb_doc: <FileText className="h-3.5 w-3.5" />,
  drive_doc: <FileText className="h-3.5 w-3.5" />,
  regulatory_doc: <FileText className="h-3.5 w-3.5" />,
  meeting: <CalendarDays className="h-3.5 w-3.5" />,
  workroom: <LayoutGrid className="h-3.5 w-3.5" />,
  conversation: <MessageSquare className="h-3.5 w-3.5" />,
  google_task: <ExternalLink className="h-3.5 w-3.5" />,
  url: <Link2 className="h-3.5 w-3.5" />,
};

const KIND_VERB: Record<TaskSourceKind, string> = {
  gmail_thread: "Open email",
  kb_doc: "Open document",
  drive_doc: "Open in Drive",
  regulatory_doc: "Open document",
  meeting: "Open meeting",
  workroom: "Open workroom",
  conversation: "Open chat",
  google_task: "Open in Google Tasks",
  url: "Open link",
};

/** Where a source lives in the app — null means it opens in the browser instead. */
function routeFor(ref: TaskSourceRef): string | null {
  switch (ref.kind) {
    case "gmail_thread":
      return `/inbox?thread=${encodeURIComponent(ref.id)}`;
    case "kb_doc":
      return `/documents?doc=${encodeURIComponent(ref.id)}`;
    case "regulatory_doc":
      return `/regulatory?doc=${encodeURIComponent(ref.id)}`;
    case "meeting":
      return `/meetings?meeting=${encodeURIComponent(ref.id)}`;
    case "workroom":
      return `/workrooms?room=${encodeURIComponent(ref.id)}`;
    case "conversation":
      return `/chat/${encodeURIComponent(ref.id)}`;
    default:
      return null;
  }
}

function externalUrl(ref: TaskSourceRef): string | null {
  if (ref.url) return ref.url;
  if (ref.kind === "google_task") return "https://tasks.google.com/";
  if (ref.kind === "drive_doc" && ref.id) return `https://drive.google.com/file/d/${ref.id}/view`;
  return null;
}

export function sourceSummary(ref: TaskSourceRef): string {
  return `${KIND_VERB[ref.kind] ?? "Source"}: ${ref.label || ref.id}`;
}

/**
 * The "take me to it" row on a task: opens whatever the task is about, and for
 * an email task, hands the thread to Gerry for a drafted reply.
 */
export function TaskSourceActions({
  task,
  className,
}: {
  task: Task;
  className?: string;
}) {
  const ref = task.source_ref;
  const navigate = useNavigate();
  const push = useToastStore((s) => s.push);
  const [drafting, setDrafting] = useState(false);

  const draftReply = useMutation({
    mutationFn: () =>
      draftGmailReply(
        ref?.id ?? "",
        `This reply needs to handle the follow-up: ${task.title}` +
          (task.description ? `\n\nContext:\n${task.description}` : ""),
      ),
    onMutate: () => setDrafting(true),
    onSettled: () => setDrafting(false),
    onSuccess: () =>
      push("success", "Gerry drafted a reply — approve it on the Approvals page."),
    onError: () => push("error", "Couldn't draft a reply for that email."),
  });

  if (!ref) return null;
  const route = routeFor(ref);
  const url = route ? null : externalUrl(ref);
  if (!route && !url) return null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (route) navigate(route);
          else if (url) window.open(url, "_blank", "noopener,noreferrer");
        }}
        title={ref.label || undefined}
        className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
      >
        {KIND_ICON[ref.kind]}
        <span className="truncate">{KIND_VERB[ref.kind]}</span>
      </button>

      {ref.kind === "gmail_thread" && (
        <button
          type="button"
          disabled={drafting}
          onClick={(e) => {
            e.stopPropagation();
            draftReply.mutate();
          }}
          title="Have Gerry draft the reply for this follow-up"
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {drafting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PenLine className="h-3.5 w-3.5" />
          )}
          Gerry draft
        </button>
      )}
    </div>
  );
}
