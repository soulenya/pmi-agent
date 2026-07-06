/**
 * Global approvals drawer — a slide-out panel available on every page so
 * pending approvals can be reviewed without navigating away. The trigger
 * button (with live pending-count badge) lives in the Header.
 */
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { ClipboardCheck, X, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ApprovalCard,
  usePendingApprovals,
  usePendingApprovalCount,
  useResolveApproval,
} from "@/components/approvals/ApprovalCard";

export function ApprovalsDrawer() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const count = usePendingApprovalCount();
  const { data: pending = [], isLoading } = usePendingApprovals({
    enabled: open,
    refetchInterval: 15_000,
  });
  const resolve = useResolveApproval();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Pending approvals"
        className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <ClipboardCheck className="h-[18px] w-[18px]" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <div
            ref={panelRef}
            className={cn(
              "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l bg-background shadow-2xl",
            )}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold">Pending approvals</h2>
                {count > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    {count}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <NavLink
                  to="/approvals"
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

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {isLoading && (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
              {!isLoading && pending.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                  <ShieldCheck className="h-8 w-8 opacity-40" />
                  <p className="text-sm">Nothing needs your approval.</p>
                </div>
              )}
              {pending.map((intent) => (
                <ApprovalCard
                  key={intent.id}
                  intent={intent}
                  compact
                  onResolve={(approved, reason) => resolve(intent.id, approved, reason)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
