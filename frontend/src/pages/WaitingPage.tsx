import { useSearchParams } from "react-router-dom";
import { Bell } from "lucide-react";

import {
  WaitingForYou,
  defaultWaitingTab,
  isWaitingTab,
  useWaitingCounts,
  type WaitingTab,
} from "@/components/waiting/WaitingForYou";

/** /waiting?tab=approvals|suggestions|notifications — the full-page list. */
export function WaitingPage() {
  const [params, setParams] = useSearchParams();
  const counts = useWaitingCounts();
  const raw = params.get("tab");
  const tab: WaitingTab = isWaitingTab(raw) ? raw : defaultWaitingTab(counts);

  const setTab = (t: WaitingTab) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bell className="h-5 w-5 text-amber-500" /> Waiting for you
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Decisions Gerry needs from you, things she suggests, and what happened while you were away.
        </p>
      </div>
      <WaitingForYou tab={tab} onTabChange={setTab} className="min-h-0 flex-1 rounded-xl border bg-card" />
    </div>
  );
}
