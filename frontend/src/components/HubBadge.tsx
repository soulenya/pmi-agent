import { Cloud } from "lucide-react";

import type { Source } from "@/api/tasks";
import { cn } from "@/lib/utils";

/** Marks a row that lives on the hub rather than on this computer. */
export function HubBadge({ source, className }: { source: Source; className?: string }) {
  if (source !== "hub") return null;
  return (
    <span
      title="On the hub"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] leading-none text-primary",
        className,
      )}
    >
      <Cloud className="h-2.5 w-2.5" />
      hub
    </span>
  );
}
