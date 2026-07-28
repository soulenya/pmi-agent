import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lightbulb, Settings2, X, XCircle } from "lucide-react";
import { getSystemNotices, type SystemNotice } from "@/api/settings";
import { cn } from "@/lib/utils";

const INFO_DISMISSED_KEY = "systemNotices.dismissed.v1"; // info: dismissed forever

function loadDismissedInfo(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(INFO_DISMISSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function persistDismissedInfo(ids: Set<string>) {
  try {
    window.localStorage.setItem(INFO_DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

const SEVERITY_STYLE: Record<SystemNotice["severity"], { box: string; Icon: React.ElementType }> = {
  error: {
    box: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200",
    Icon: XCircle,
  },
  warning: {
    box: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
    Icon: AlertTriangle,
  },
  info: {
    box: "border-border bg-card text-foreground",
    Icon: Lightbulb,
  },
};

/**
 * Launch pop-down for system notices: offline systems (Google, AI engine),
 * newer-model availability, and one-time configuration tips.
 * error/warning: reappear each app launch (session dismiss).
 * info: dismissed permanently once closed.
 */
export function SystemNoticesBanner() {
  const navigate = useNavigate();
  // Session dismissals (errors/warnings come back next launch)
  const [sessionDismissed, setSessionDismissed] = useState<Set<string>>(new Set());
  const [infoDismissed, setInfoDismissed] = useState<Set<string>>(loadDismissedInfo);

  const { data: notices = [] } = useQuery({
    queryKey: ["system-notices"],
    queryFn: getSystemNotices,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const visible = notices.filter(
    (n) => !sessionDismissed.has(n.id) && !(n.severity === "info" && infoDismissed.has(n.id)),
  );
  if (visible.length === 0) return null;

  function dismiss(n: SystemNotice) {
    if (n.severity === "info") {
      const next = new Set(infoDismissed).add(n.id);
      setInfoDismissed(next);
      persistDismissedInfo(next);
    } else {
      setSessionDismissed((prev) => new Set(prev).add(n.id));
    }
  }

  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[70] flex w-full max-w-xl -translate-x-1/2 flex-col gap-2 px-4">
      {visible.slice(0, 4).map((n) => {
        const { box, Icon } = SEVERITY_STYLE[n.severity] ?? SEVERITY_STYLE.info;
        return (
          <div
            key={n.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-lg",
              box,
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{n.title}</p>
              <p className="text-xs opacity-90">{n.message}</p>
            </div>
            {n.route && (
              <button
                onClick={() => {
                  navigate(n.route);
                  dismiss(n);
                }}
                className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
                title="Open Settings"
              >
                <Settings2 className="h-3 w-3" /> Fix
              </button>
            )}
            <button
              onClick={() => dismiss(n)}
              className="mt-0.5 shrink-0 opacity-60 hover:opacity-100"
              title={n.severity === "info" ? "Dismiss (won't show again)" : "Dismiss for this session"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
