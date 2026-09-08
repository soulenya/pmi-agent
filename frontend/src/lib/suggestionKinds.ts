import { CheckSquare, FileText, ListChecks, Mail, Wallet } from "lucide-react";
import type { SuggestionKind } from "@/api/assistant";

export interface SuggestionKindMeta {
  label: string;
  icon: typeof Mail;
  accept: string;
  dismiss: string;
  tint: string;
  blurb: string;
}

/** Shared by the Suggestions page and the Waiting-for-you list. */
export const SUGGESTION_KIND_META: Record<SuggestionKind, SuggestionKindMeta> = {
  followup_email: {
    label: "Email follow-up",
    icon: Mail,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    blurb: "Mail you sent that hasn't been answered",
  },
  followup_task: {
    label: "Task reminder",
    icon: ListChecks,
    accept: "Acknowledge",
    dismiss: "Dismiss",
    tint: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    blurb: "Tasks that have gone quiet",
  },
  task_recommendation: {
    label: "Recommended task",
    icon: CheckSquare,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
    blurb: "Picked out of your mail and chats",
  },
  meeting_import: {
    label: "Meeting summary imported",
    icon: FileText,
    accept: "Keep",
    dismiss: "Remove",
    tint: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    blurb: "New notes filed in your Knowledge Base",
  },
  workroom_todo: {
    label: "Workroom next step",
    icon: CheckSquare,
    accept: "Create task",
    dismiss: "Dismiss",
    tint: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    blurb: "Moves Gerry suggests toward the room's goal",
  },
  budget_entry: {
    label: "Budget entry",
    icon: Wallet,
    accept: "Add to budget",
    dismiss: "Dismiss",
    tint: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    blurb: "Spending found in your invoice folders",
  },
  gmail_invoice: {
    label: "Invoice in Gmail",
    icon: Mail,
    accept: "File & log",
    dismiss: "Dismiss",
    tint: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
    blurb: "Bills waiting to be filed",
  },
};

/** "[Room name] Do the thing" -> "Do the thing". */
export function stripRoomPrefix(title: string): string {
  return title.replace(/^\[[^\]]+\]\s*/, "") || title;
}
