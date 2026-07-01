import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles, X, HelpCircle } from "lucide-react";
import { BUILD_NUMBER } from "@/version";
import { resolveGuide, type ResolvedGuide } from "@/lib/featureGuide";
import { useFeatureGuideStore } from "@/stores/featureGuideStore";

const SEEN_KEY = "featureGuide.seenBuilds";

function readSeen(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function markSeen(id: string) {
  try {
    const seen = readSeen();
    seen[id] = BUILD_NUMBER;
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

/**
 * "What Gerry can do" — a short snapshot of each section's capabilities.
 *
 * Auto-opens once per build the first time you navigate into a section, and can
 * be reopened any time from the Help button in the header.
 */
export function FeatureGuideModal() {
  const location = useLocation();
  const [active, setActive] = useState<ResolvedGuide | null>(null);
  const pending = useRef<ResolvedGuide | null>(null);

  const requestedId = useFeatureGuideStore((s) => s.requestedId);
  const clearRequest = useFeatureGuideStore((s) => s.clear);

  // Auto-open once per build the first time you enter each section. If the
  // "What's New" popup is showing (fresh update), wait until it's dismissed so
  // the two don't stack.
  useEffect(() => {
    const guide = resolveGuide(location.pathname);
    if (!guide) return;

    const seen = readSeen();
    if ((seen[guide.id] ?? -1) >= BUILD_NUMBER) return;

    if (window.__whatsNewOpen) {
      pending.current = guide;
      return;
    }

    markSeen(guide.id);
    setActive(guide);
  }, [location.pathname]);

  // When "What's New" closes, show the guide we deferred (if any).
  useEffect(() => {
    function onWhatsNewClosed() {
      const guide = pending.current;
      if (guide) {
        pending.current = null;
        markSeen(guide.id);
        setActive(guide);
      }
    }
    window.addEventListener("whatsnew:closed", onWhatsNewClosed);
    return () => window.removeEventListener("whatsnew:closed", onWhatsNewClosed);
  }, []);

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
