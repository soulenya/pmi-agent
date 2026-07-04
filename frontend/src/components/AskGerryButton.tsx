import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { useAskGerry, type AskGerryOptions } from "@/hooks/useAskGerry";
import { cn } from "@/lib/utils";

interface AskGerryButtonProps {
  /** Builds the ask options when clicked. May be async (e.g. to fetch file bytes). */
  build: () => AskGerryOptions | Promise<AskGerryOptions>;
  /** Optional visible label next to the icon. */
  label?: string;
  className?: string;
  title?: string;
}

/**
 * A small "Ask Gerry about this" icon button. Drop it onto any item (task,
 * contact, document, attachment, …) with a `build` callback that returns the
 * conversation title, seed prompt, and optional file to upload.
 */
export function AskGerryButton({ build, label, className, title }: AskGerryButtonProps) {
  const askGerry = useAskGerry();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      title={title ?? "Ask Gerry about this"}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
          const opts = await build();
          await askGerry(opts);
        } catch {
          /* swallow — the button simply does nothing on failure */
        } finally {
          setBusy(false);
        }
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:text-primary disabled:opacity-50",
        className,
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
      {label && <span className="text-xs">{label}</span>}
    </button>
  );
}
