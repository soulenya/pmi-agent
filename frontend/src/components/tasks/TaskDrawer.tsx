import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Check,
  Circle,
  Clock,
  AlertCircle,
  Tag,
  Trash2,
  Loader2,
  MessageSquare,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  updateTask,
  deleteTask,
  listTaskComments,
  addTaskComment,
  listProjects,
} from "@/api/tasks";
import type { Task, TaskStatus, TaskPriority, TaskUpdate } from "@/types/tasks";

// ── Shared constants ───────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { value: "backlog", label: "Backlog", icon: <Circle className="h-3.5 w-3.5 text-muted-foreground" /> },
  { value: "todo", label: "To Do", icon: <Circle className="h-3.5 w-3.5 text-blue-500" /> },
  { value: "in_progress", label: "In Progress", icon: <Clock className="h-3.5 w-3.5 text-yellow-500" /> },
  { value: "in_review", label: "In Review", icon: <AlertCircle className="h-3.5 w-3.5 text-orange-500" /> },
  { value: "done", label: "Done", icon: <Check className="h-3.5 w-3.5 text-green-500" /> },
  { value: "cancelled", label: "Cancelled", icon: <Circle className="h-3.5 w-3.5 text-muted-foreground/40" /> },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
  { value: "low", label: "Low", color: "text-slate-400" },
  { value: "medium", label: "Medium", color: "text-blue-400" },
  { value: "high", label: "High", color: "text-orange-400" },
  { value: "critical", label: "Critical", color: "text-red-500" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Tag chip input ─────────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const val = input.trim().toLowerCase();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 min-h-[36px]">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
        >
          <Tag className="h-2.5 w-2.5" />
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="ml-0.5 text-primary/60 hover:text-primary"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
          if (e.key === "Backspace" && !input && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={addTag}
        placeholder={tags.length === 0 ? "Add tags…" : ""}
        className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// ── Main drawer ────────────────────────────────────────────────────────────────

interface TaskDrawerProps {
  task: Task;
  onClose: () => void;
  onDeleted: () => void;
}

export function TaskDrawer({ task, onClose, onDeleted }: TaskDrawerProps) {
  const qc = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Editable local state (mirrors task fields)
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(
    task.due_date ? task.due_date.slice(0, 10) : ""
  );
  const [tags, setTags] = useState<string[]>(task.tags ?? []);
  const [projectId, setProjectId] = useState<string>(task.project_id ?? "");
  const [commentText, setCommentText] = useState("");

  // Sync when task prop changes (e.g. cache refresh)
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setDueDate(task.due_date ? task.due_date.slice(0, 10) : "");
    setTags(task.tags ?? []);
    setProjectId(task.project_id ?? "");
  }, [task]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
    staleTime: 60_000,
  });

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ["task-comments", task.id],
    queryFn: () => listTaskComments(task.id),
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (body: TaskUpdate) => updateTask(task.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onDeleted();
    },
  });

  const commentMutation = useMutation({
    mutationFn: (content: string) => addTaskComment(task.id, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-comments", task.id] });
      setCommentText("");
    },
  });

  // Patch helpers — only send changed fields
  function patch(fields: TaskUpdate) {
    updateMutation.mutate(fields);
  }

  const isOverdue =
    dueDate &&
    status !== "done" &&
    status !== "cancelled" &&
    new Date(dueDate) < new Date();

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2">
            {STATUS_OPTIONS.find((s) => s.value === status)?.icon}
            <span className="text-xs font-medium text-muted-foreground">
              {STATUS_OPTIONS.find((s) => s.value === status)?.label}
            </span>
            {updateMutation.isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Title */}
          <div>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                const trimmed = title.trim();
                if (trimmed && trimmed !== task.title) patch({ title: trimmed });
              }}
              rows={2}
              className="w-full resize-none bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground focus:ring-0"
              placeholder="Task title"
            />
          </div>

          {/* Meta row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Status */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => {
                  const v = e.target.value as TaskStatus;
                  setStatus(v);
                  patch({ status: v });
                }}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <select
                value={priority}
                onChange={(e) => {
                  const v = e.target.value as TaskPriority;
                  setPriority(v);
                  patch({ priority: v });
                }}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Due date */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Due Date
                {isOverdue && (
                  <span className="ml-1.5 text-destructive">overdue</span>
                )}
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                onBlur={() => patch({ due_date: dueDate || null })}
                className={cn(
                  "w-full rounded-md border bg-background px-2 py-1.5 text-sm",
                  isOverdue && "border-destructive text-destructive"
                )}
              />
            </div>

            {/* Project */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Project</label>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  patch({ project_id: e.target.value || null });
                }}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">— None —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                if (description !== (task.description ?? "")) {
                  patch({ description: description || undefined });
                }
              }}
              rows={4}
              placeholder="Add a description…"
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Tags</label>
            <TagInput
              tags={tags}
              onChange={(newTags) => {
                setTags(newTags);
                patch({ tags: newTags });
              }}
            />
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Comments */}
          <div className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <MessageSquare className="h-3.5 w-3.5" />
              Comments ({comments.length})
            </h3>

            {commentsLoading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading comments…
              </div>
            ) : comments.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground italic">No comments yet.</p>
            ) : (
              <div className="space-y-3">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      U
                    </div>
                    <div className="flex-1 rounded-lg bg-muted px-3 py-2">
                      <p className="text-sm whitespace-pre-wrap">{c.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{timeAgo(c.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add comment */}
            <div className="flex gap-2 items-end">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (commentText.trim()) commentMutation.mutate(commentText.trim());
                  }
                }}
                rows={2}
                placeholder="Add a comment… (Enter to send)"
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
              />
              <button
                onClick={() => {
                  if (commentText.trim()) commentMutation.mutate(commentText.trim());
                }}
                disabled={!commentText.trim() || commentMutation.isPending}
                className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90"
              >
                {commentMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer — delete */}
        <div className="shrink-0 border-t px-5 py-3 flex justify-end">
          <button
            onClick={() => {
              if (confirm("Delete this task? This cannot be undone.")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 transition-colors"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete task
          </button>
        </div>
      </div>
    </>
  );
}
