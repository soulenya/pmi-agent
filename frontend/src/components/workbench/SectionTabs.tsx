/**
 * The pages under the current rail item, as a thin tab strip. Drawn only when
 * the item holds more than one page.
 */
import { NavLink, useLocation } from "react-router-dom";

import { useWaitingCounts } from "@/components/waiting/WaitingForYou";
import { railItemFor, railPageFor } from "@/lib/workbench";
import { cn } from "@/lib/utils";

export function SectionTabs() {
  const { pathname } = useLocation();
  const item = railItemFor(pathname);
  const page = railPageFor(pathname);
  const counts = useWaitingCounts();

  if (!item || item.pages.length < 2) return null;
  const Icon = item.icon;

  return (
    <nav
      aria-label={`${item.label} sections`}
      className="flex items-end gap-1.5 border-t bg-muted/40 px-4 pt-2 shadow-[inset_0_-1px_0_0_hsl(var(--primary)/0.6)]"
    >
      <span className="mb-2 mr-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Icon className="h-4 w-4" />
        {item.label}
      </span>
      {item.pages.map((p) => {
        const count = p.badge === "waiting" ? counts.total : p.badge === "assistant" ? counts.suggestions : 0;
        const active = page?.route === p.route;
        return (
          <NavLink
            key={p.route}
            to={p.route}
            aria-current={active ? "page" : undefined}
            className={cn(
              // Folder tabs: every tab is outlined; the active one is filled, outlined in the
              // accent colour, and its bottom edge opens onto the page so it reads as the one you are in.
              "relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-base transition-colors",
              active
                ? "z-10 border-primary bg-background font-semibold text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background"
                : "border-border bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {p.label}
            {count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs font-semibold leading-5",
                  active ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground",
                )}
              >
                {count}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
