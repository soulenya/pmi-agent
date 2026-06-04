/**
 * ServiceMenu — dropdown in the Sidebar header for service control actions.
 * Mirrors the system tray menu: Restart, Update, Update & Restart, Stop All.
 */
import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  MoreHorizontal,
  RefreshCw,
  Download,
  PowerOff,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { apiClient } from "@/api/client";
import { cn } from "@/lib/utils";

interface ServiceResult {
  success: boolean;
  message: string;
}

async function callService(path: string): Promise<ServiceResult> {
  const { data } = await apiClient.post<ServiceResult>(path);
  return data;
}

const ACTIONS = [
  {
    key: "restart",
    label: "Restart Services",
    icon: RefreshCw,
    path: "/update/restart",
    confirm: false,
    className: "",
  },
  {
    key: "pull",
    label: "Update",
    icon: Download,
    path: "/update/pull",
    confirm: false,
    className: "",
  },
  {
    key: "pull-restart",
    label: "Update & Restart",
    icon: Download,
    path: "/update/pull-restart",
    confirm: false,
    className: "",
  },
  {
    key: "stop",
    label: "Stop All Services",
    icon: PowerOff,
    path: "/update/stop",
    confirm: true,
    className: "text-destructive",
  },
] as const;

export function ServiceMenu() {
  const [open, setOpen] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (path: string) => callService(path),
    onSuccess: (data) => {
      setFeedback({ ok: data.success, msg: data.message });
      setConfirmKey(null);
      setTimeout(() => {
        setFeedback(null);
        setOpen(false);
      }, 2500);
    },
    onError: (e: Error) => {
      setFeedback({ ok: false, msg: e.message });
      setConfirmKey(null);
      setTimeout(() => setFeedback(null), 3000);
    },
  });

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmKey(null);
        setFeedback(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleAction(key: string, path: string, confirm: boolean) {
    if (confirm && confirmKey !== key) {
      setConfirmKey(key);
      return;
    }
    mutation.mutate(path);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setConfirmKey(null); setFeedback(null); }}
        className={cn(
          "rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
        )}
        title="Service controls"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border bg-card shadow-lg">
          {/* Feedback banner */}
          {feedback && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-t-xl px-3 py-2 text-xs",
                feedback.ok ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-destructive/10 text-destructive",
              )}
            >
              {feedback.ok
                ? <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
              <span>{feedback.msg}</span>
            </div>
          )}

          <div className="p-1">
            {ACTIONS.map(({ key, label, icon: Icon, path, confirm, className }) => {
              const isConfirming = confirmKey === key;
              const isRunning = mutation.isPending && mutation.variables === path;

              return (
                <button
                  key={key}
                  onClick={() => handleAction(key, path, confirm)}
                  disabled={mutation.isPending}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    "hover:bg-accent text-foreground",
                    isConfirming && "bg-destructive/10",
                    className,
                  )}
                >
                  {isRunning
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    : <Icon className="h-4 w-4 shrink-0" />}
                  <span>
                    {isConfirming ? `Confirm: ${label}` : label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
