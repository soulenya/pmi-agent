/**
 * The pages under the current rail item, as a thin tab strip. Drawn only when
 * the item holds more than one page.
 */
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { getPendingSuggestionCount } from "@/api/assistant";
import { listPendingApprovals } from "@/api/chat";
import { railItemFor, railPageFor } from "@/lib/workbench";
import { cn } from "@/lib/utils";

export function SectionTabs() {
  const { pathname } = useLocation();
  const item = railItemFor(pathname);
  const page = railPageFor(pathname);

  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => listPendingApprovals(),
    refetchInterval: 30_000,
    enabled: item?.pages.some((p) => p.badge === "approvals") ?? false,
  });
  const { data: suggestions = 0 } = useQuery({
    queryKey: ["assistant", "suggestions", "count"],
    queryFn: getPendingSuggestionCount,
    refetchInterval: 30_000,
    enabled: item?.pages.some((p) => p.badge === "assistant") ?? false,
  });

  if (!item || item.pages.length < 2) return null;

  return (
    <nav className="flex items-center gap-1 border-t px-4">
      {item.pages.map((p) => {
        const count = p.badge === "approvals" ? approvals.length : p.badge === "assistant" ? suggestions : 0;
        const active = page?.route === p.route;
        return (
          <NavLink
            key={p.route}
            to={p.route}
            className={cn(
              "relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
            {count > 0 && (
              <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-4 text-destructive-foreground">
                {count}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
