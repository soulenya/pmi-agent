/**
 * Global toast stack — bottom-right, survives page changes and component
 * unmounts (e.g. an approval card disappearing from a list after resolving).
 */
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg backdrop-blur",
            t.kind === "success" &&
              "border-green-300 bg-green-50/95 text-green-800 dark:border-green-700 dark:bg-green-950/90 dark:text-green-200",
            t.kind === "error" &&
              "border-destructive/40 bg-destructive/10 text-destructive backdrop-blur-md bg-background/95",
            t.kind === "info" && "border-border bg-background/95 text-foreground",
          )}
        >
          <span className="mt-0.5 shrink-0">
            {t.kind === "success" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : t.kind === "error" ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <Info className="h-4 w-4" />
            )}
          </span>
          <p className="flex-1 leading-snug">{t.text}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
