import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { BUILD_NUMBER, BUILD_DATE, CHANGELOG } from "@/version";
import type { ChangelogEntry } from "@/version";

declare global {
  interface Window {
    /** True while the "What's New" popup is showing, so the feature guide waits. */
    __whatsNewOpen?: boolean;
  }
}

const LAST_SEEN_KEY = "whatsNew.lastSeenBuild";

/**
 * Shows a "What's New" popup once after the app updates to a new build.
 *
 * The last build the user acknowledged is stored in localStorage. On a fresh
 * install nothing is shown (we just record the current build); on every later
 * build bump the popup lists each changelog entry the user hasn't seen yet.
 */
export function WhatsNewModal() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);

  useEffect(() => {
    let lastSeen: number | null = null;
    try {
      const raw = window.localStorage.getItem(LAST_SEEN_KEY);
      lastSeen = raw === null ? null : Number.parseInt(raw, 10);
      if (Number.isNaN(lastSeen)) lastSeen = null;
    } catch {
      lastSeen = null;
    }

    // Fresh install (or storage unavailable): record the current build silently.
    if (lastSeen === null) {
      try {
        window.localStorage.setItem(LAST_SEEN_KEY, String(BUILD_NUMBER));
      } catch {
        /* ignore */
      }
      return;
    }

    if (lastSeen < BUILD_NUMBER) {
      const unseen = CHANGELOG.filter((e) => e.build > lastSeen!);
      // Claim the boot moment so the feature guide waits until this is closed.
      window.__whatsNewOpen = true;
      setEntries(unseen.length ? unseen : CHANGELOG.slice(0, 1));
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, String(BUILD_NUMBER));
    } catch {
      /* ignore */
    }
    setEntries(null);
    window.__whatsNewOpen = false;
    window.dispatchEvent(new Event("whatsnew:closed"));
  }

  if (!entries) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            What's New
          </h3>
          <button
            onClick={dismiss}
            className="rounded-md p-1 hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.build} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  b{entry.build}
                </span>
                <span className="text-sm font-medium">{entry.title}</span>
                <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                  {entry.date}
                </span>
              </div>
              <ul className="space-y-1">
                {entry.changes.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-muted-foreground"
                  >
                    <span className="mt-0.5 shrink-0 text-primary">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t bg-muted/30">
          <span className="text-xs text-muted-foreground">
            Build {BUILD_NUMBER} · {BUILD_DATE}
          </span>
          <button
            onClick={dismiss}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
