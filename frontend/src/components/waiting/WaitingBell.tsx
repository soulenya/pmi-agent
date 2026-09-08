/**
 * The one bell. Its badge is decisions plus unread; the panel is the shared
 * WaitingForYou list with its three tabs.
 */
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Bell, X } from "lucide-react";

import {
  WaitingForYou,
  defaultWaitingTab,
  useWaitingCounts,
  type WaitingTab,
} from "@/components/waiting/WaitingForYou";

export function WaitingBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<WaitingTab | null>(null);
  const counts = useWaitingCounts();
  const active = tab ?? defaultWaitingTab(counts);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Waiting for you"
        aria-label="Waiting for you"
        className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
        {counts.total > 0 && (
          <span
            className={
              counts.approvals > 0
                ? "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white"
                : "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white"
            }
          >
            {counts.total > 9 ? "9+" : counts.total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Bell className="h-4 w-4 text-amber-500" />
                Waiting for you
              </h2>
              <div className="flex items-center gap-1">
                <NavLink
                  to={`/waiting?tab=${active}`}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Full page
                </NavLink>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <WaitingForYou tab={active} onTabChange={setTab} onNavigate={() => setOpen(false)} className="flex-1" />
          </div>
        </>
      )}
    </>
  );
}
