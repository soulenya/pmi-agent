/**
 * "Notifications on this device": one switch, with the reason when it cannot
 * be offered. Rendered in Settings → Connections and in the phone's More sheet.
 */
import { useMutation } from "@tanstack/react-query";
import { BellOff, BellRing, Loader2, Send } from "lucide-react";

import { sendTestPush } from "@/api/push";
import { usePush } from "@/hooks/usePush";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

export function PushToggle({ compact = false }: { compact?: boolean }) {
  const { state, error, enable, disable } = usePush();
  const toast = useToastStore((s) => s.push);
  const test = useMutation({
    mutationFn: sendTestPush,
    onSuccess: (r) =>
      toast(r.delivered > 0 ? "success" : "error", r.delivered > 0 ? "Sent. It should appear on this device." : "Nothing was delivered — the subscription may have lapsed. Turn it off and on again."),
    onError: () => toast("error", "The test could not be sent."),
  });

  if (state === "unsupported" && !compact) return null;

  const reason: Record<string, string> = {
    unsupported: "Notifications are only offered in a browser on the hub.",
    needs_home_screen: "On iPhone, add Little Gerry to your home screen first (Share → Add to Home Screen), then open it from there.",
    server_off: "The hub has no push keys yet.",
    denied: "This browser has blocked notifications for the hub. Allow them in the browser's site settings, then come back.",
  };

  const on = state === "on";
  const canToggle = state === "on" || state === "off";

  return (
    <div className={cn("space-y-2", compact ? "" : "rounded-lg border bg-card p-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {on ? <BellRing className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
            Notifications on this device
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {state === "on"
              ? "Team mentions, approvals, due tasks and suggestions reach this device even when the page is closed."
              : reason[state] ?? "The same things that ring the bell — mentions, approvals, due tasks, suggestions."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={!canToggle}
          onClick={() => void (on ? disable() : enable())}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-40",
            on ? "border-primary bg-primary" : "border-border bg-muted",
          )}
        >
          {state === "busy" ? (
            <Loader2 className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all",
                on ? "left-6" : "left-0.5",
              )}
            />
          )}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {on && (
        <button
          type="button"
          onClick={() => test.mutate()}
          disabled={test.isPending}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send a test
        </button>
      )}
    </div>
  );
}
