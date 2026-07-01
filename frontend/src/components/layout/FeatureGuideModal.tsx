import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles, X, HelpCircle } from "lucide-react";
import { BUILD_NUMBER } from "@/version";
import { resolveGuide, type ResolvedGuide } from "@/lib/featureGuide";
import { useFeatureGuideStore } from "@/stores/featureGuideStore";
import { useBootPopupStore } from "@/stores/bootPopupStore";
import { getClientState, setClientState } from "@/api/settings";

const SEEN_KEY = "featureGuide.seenBuilds";

/** Best-effort read of the legacy localStorage record (for a one-time migration). */
function readLegacyLocal(): Record<string, number> | null {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : null;
  } catch {
    return null;
  }
}

/**
 * "What Gerry can do" — a short snapshot of each section's capabilities.
 *
 * Auto-opens once per build the first time you navigate into a section, and can
 * be reopened any time from the Help button in the header.
 *
 * Which sections have been seen (per build) is stored server-side (Postgres) so
 * it survives installer updates that reset the embedded webview's localStorage.
 */
export function FeatureGuideModal() {
  const location = useLocation();
  const [active, setActive] = useState<ResolvedGuide | null>(null);

  // null while loading; a record of section id -> last build the guide was shown.
  const [seen, setSeen] = useState<Record<string, number> | null>(null);
  const seenRef = useRef<Record<string, number> | null>(null);
  seenRef.current = seen;

  const phase = useBootPopupStore((s) => s.phase);
  const requestedId = useFeatureGuideStore((s) => s.requestedId);
  const clearRequest = useFeatureGuideStore((s) => s.clear);

  // Load the seen-map from the server once on mount (migrating any legacy value).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let map: Record<string, number> | null = null;
      try {
        map = await getClientState<Record<string, number>>(SEEN_KEY);
      } catch {
        map = null;
      }
      if (!map) map = readLegacyLocal();
      if (!cancelled) setSeen(map ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function markSeen(id: string) {
    const next = { ...(seenRef.current ?? {}), [id]: BUILD_NUMBER };
    seenRef.current = next;
    setSeen(next);
    void setClientState(SEEN_KEY, next).catch(() => {});
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  // Auto-open once per build the first time you enter each section. Waits until
  // the "What's New" popup has finished (boot phase "done") so they don't stack.
  useEffect(() => {
    if (phase !== "done") return;
    if (seen === null) return; // still loading the seen-map

    const guide = resolveGuide(location.pathname);
    if (!guide) return;
    if ((seen[guide.id] ?? -1) >= BUILD_NUMBER) return;

    markSeen(guide.id);
    setActive(guide);
  }, [location.pathname, phase, seen]);

  // Manual open from the Help button — always shows the current section.
  useEffect(() => {
    if (!requestedId) return;
    const guide = resolveGuide(location.pathname);
    if (guide) setActive(guide);
    clearRequest();
  }, [requestedId, location.pathname, clearRequest]);

  if (!active) return null;

  const Icon = active.icon ?? HelpCircle;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => setActive(null)}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        data-state="open"
      >
        <div className="flex items-start justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> What Gerry can do
              </div>
              <h3 className="font-semibold text-base leading-tight">{active.title}</h3>
            </div>
          </div>
          <button
            onClick={() => setActive(null)}
            className="rounded-md p-1 hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-muted-foreground">{active.tagline}</p>
          <ul className="space-y-2">
            {active.capabilities.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-end px-5 py-3 border-t bg-muted/30">
          <button
            onClick={() => setActive(null)}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
