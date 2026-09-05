/**
 * One status palette, shared by every surface that draws a task — the Tasks tab
 * and the project canvas — so a colour means the same thing wherever you see it.
 */
import type { TaskStatus } from "@/types/tasks";

export const TASK_STATUSES: {
  id: TaskStatus;
  label: string;
  /** Left-edge colour for a list row. */
  edge: string;
  /** Full-border colour for a canvas card. */
  ring: string;
  dot: string;
}[] = [
  {
    id: "todo",
    label: "To do",
    edge: "border-l-slate-400",
    ring: "border-slate-400",
    dot: "bg-slate-400",
  },
  {
    id: "in_progress",
    label: "In progress",
    edge: "border-l-sky-500",
    ring: "border-sky-500",
    dot: "bg-sky-500",
  },
  {
    id: "in_review",
    label: "In review",
    edge: "border-l-violet-500",
    ring: "border-violet-500",
    dot: "bg-violet-500",
  },
  {
    id: "done",
    label: "Done",
    edge: "border-l-emerald-500",
    ring: "border-emerald-500",
    dot: "bg-emerald-500",
  },
  {
    id: "backlog",
    label: "Backlog",
    edge: "border-l-neutral-300 dark:border-l-neutral-700",
    ring: "border-neutral-300 dark:border-neutral-700",
    dot: "bg-neutral-400",
  },
  {
    id: "cancelled",
    label: "Cancelled",
    edge: "border-l-rose-400",
    ring: "border-rose-400",
    dot: "bg-rose-400",
  },
];

export const STATUS_EDGE: Record<TaskStatus, string> = Object.fromEntries(
  TASK_STATUSES.map((s) => [s.id, s.edge]),
) as Record<TaskStatus, string>;

export const STATUS_RING: Record<TaskStatus, string> = Object.fromEntries(
  TASK_STATUSES.map((s) => [s.id, s.ring]),
) as Record<TaskStatus, string>;
