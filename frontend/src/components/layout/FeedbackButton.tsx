import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, X, Bug, Lightbulb, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { submitFeedback, type FeedbackCategory } from "@/api/feedback";

const MAX_LEN = 5000;

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Send feedback — report a bug or request a feature"
        aria-label="Send feedback"
      >
        <MessageSquarePlus className="h-5 w-5" />
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => submitFeedback(category, message.trim(), includeDiagnostics),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      setDone(true);
      setTimeout(onClose, 1400);
    },
  });

  const canSubmit = message.trim().length > 0 && !mutation.isPending;
  const error = mutation.isError
    ? ((mutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
      "Couldn't send feedback. Please try again.")
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquarePlus className="h-4 w-4 text-primary" />
            Send feedback
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="text-sm font-medium">Thanks! Your feedback was sent.</p>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Type</label>
              <div className="grid grid-cols-2 gap-2">
                <CategoryToggle
                  active={category === "bug"}
                  onClick={() => setCategory("bug")}
                  icon={<Bug className="h-4 w-4" />}
                  label="Bug"
                />
                <CategoryToggle
                  active={category === "feature"}
                  onClick={() => setCategory("feature")}
                  icon={<Lightbulb className="h-4 w-4" />}
                  label="Feature"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {category === "bug" ? "Describe the issue" : "Describe the feature"}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
                rows={5}
                autoFocus
                placeholder={
                  category === "bug"
                    ? "What went wrong? Steps to reproduce, what you expected…"
                    : "What would you like added or changed, and why?"
                }
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              <p className="mt-1 text-right text-[10px] text-muted-foreground">
                {message.length}/{MAX_LEN}
              </p>
            </div>

            {category === "bug" && (
              <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeDiagnostics}
                  onChange={(e) => setIncludeDiagnostics(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Attach diagnostic logs (recommended) — app version, OS, and recent
                  crash/update logs so the issue can be fixed without back-and-forth
                </span>
              </label>
            )}

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={!canSubmit}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
