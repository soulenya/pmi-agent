/**
 * Shown while this computer is signed in to the hub but the hub is not
 * answering. Everything moved there is missing from the lists and cannot be
 * changed until it is back; the bar says so and keeps trying.
 */
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, RefreshCw } from "lucide-react";
import { useState } from "react";

import { useHubOffline } from "@/hooks/useAllWork";
import { useHubReachStore } from "@/stores/hubReachStore";

export function HubOfflineBar() {
  const offline = useHubOffline();
  const detail = useHubReachStore((s) => s.detail);
  const qc = useQueryClient();
  const [trying, setTrying] = useState(false);

  if (!offline) return null;

  async function retry() {
    setTrying(true);
    try {
      await qc.refetchQueries({ queryKey: ["hub"] });
      await qc.refetchQueries({ queryKey: ["hub-status"] });
    } finally {
      setTrying(false);
    }
  }

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-amber-300 bg-amber-50 px-5 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">The hub can't be reached.</span>{" "}
        {detail ? `${detail} ` : ""}
        Your projects, tasks, budgets and Team live there, so they are missing from these
        lists and can't be changed until it answers. Work kept only on this computer is still
        here.
      </span>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={trying}
        className="flex shrink-0 items-center gap-1 rounded-md border border-amber-400/60 px-2 py-0.5 font-medium hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900/40"
      >
        <RefreshCw className={trying ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
        Try again
      </button>
    </div>
  );
}
