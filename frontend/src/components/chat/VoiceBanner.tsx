import { Loader2, Mic, Volume2, X } from "lucide-react";

import type { VoicePhase } from "@/hooks/useVoiceMode";
import { cn } from "@/lib/utils";

/** The strip shown above the input while a conversation is in voice mode. */
export function VoiceBanner({
  phase,
  error,
  onInterrupt,
  onExit,
  compact = false,
}: {
  phase: VoicePhase | null;
  error: string | null;
  onInterrupt: () => void;
  onExit: () => void;
  compact?: boolean;
}) {
  if (!phase) return null;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3",
        compact ? "py-1.5 text-xs" : "py-2 text-sm",
      )}
    >
      {phase === "listening" && (
        <>
          <Mic className="h-4 w-4 shrink-0 animate-pulse text-red-500" />
          <span className="flex-1">Listening — just talk; pause and I'll answer.</span>
        </>
      )}
      {phase === "transcribing" && (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="flex-1">Got it…</span>
        </>
      )}
      {phase === "thinking" && (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="flex-1">Thinking…</span>
        </>
      )}
      {phase === "speaking" && (
        <>
          <Volume2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">Speaking…</span>
          <button onClick={onInterrupt} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
            Interrupt
          </button>
        </>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
      <button
        onClick={onExit}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Exit voice conversation (Esc)"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
