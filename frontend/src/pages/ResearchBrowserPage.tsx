import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Compass,
  Eye,
  EyeOff,
  ExternalLink,
  Library,
  Loader2,
  Maximize2,
  MessageSquare,
  Pin,
  Plus,
  RotateCw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  addBookmark,
  browserBack,
  browserForward,
  browserReload,
  browserWindowState,
  capturePage,
  closeBrowser,
  deleteBookmark,
  fitBrowserTo,
  getBrowserState,
  hostOf,
  hideBrowser,
  isBrowserAvailable,
  listBookmarks,
  markFollowingInBar,
  navigateBrowser,
  openBrowser,
  pushPage,
  savePageToKb,
  setFollowing,
  showBrowser,
  takeBrowserActions,
  toUrl,
} from "@/api/browser";
import { addWorkroomItem, listWorkrooms } from "@/api/workrooms";
import { useAskGerry } from "@/hooks/useAskGerry";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import { cn } from "@/lib/utils";

const HOME = "https://duckduckgo.com";

interface Tab {
  id: number;
  url: string;
  title: string;
}

let nextTabId = 1;

export function ResearchBrowserPage() {
  const qc = useQueryClient();
  const askGerry = useAskGerry();
  const available = isBrowserAvailable();

  const [tabs, setTabs] = useState<Tab[]>([{ id: nextTabId++, url: HOME, title: "New tab" }]);
  const [activeId, setActiveId] = useState<number>(1);
  const [address, setAddress] = useState(HOME);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const addressFocused = useRef(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const setSession = useBrowserSessionStore((s) => s.setSession);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const { data: bookmarks = [] } = useQuery({
    queryKey: ["browser", "bookmarks"],
    queryFn: listBookmarks,
  });
  const { data: state } = useQuery({
    queryKey: ["browser", "state"],
    queryFn: getBrowserState,
  });
  const { data: workrooms = [] } = useQuery({
    queryKey: ["workrooms"],
    queryFn: () => listWorkrooms(),
    enabled: pinOpen,
  });
  const following = state?.following ?? false;

  const followMut = useMutation({
    mutationFn: setFollowing,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["browser", "state"] }),
  });
  const bookmarkMut = useMutation({
    mutationFn: ({ url, title }: { url: string; title: string }) => addBookmark(url, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["browser", "bookmarks"] }),
  });
  const unbookmarkMut = useMutation({
    mutationFn: deleteBookmark,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["browser", "bookmarks"] }),
  });

  const updateActive = useCallback(
    (patch: Partial<Tab>) =>
      setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, ...patch } : t))),
    [activeId],
  );

  const fit = useCallback(() => void fitBrowserTo(slotRef.current), []);

  // Coming back to this page re-shows the window; leaving it tucks the window
  // away, so it never floats over the rest of the app.
  useEffect(() => {
    if (!available) return;
    if (useBrowserSessionStore.getState().open) {
      setOpened(true);
      void showBrowser();
    }
    return () => void hideBrowser();
  }, [available]);

  useEffect(() => {
    setSession({ open: opened, url: active?.url, title: active?.title });
  }, [opened, active?.url, active?.title, setSession]);

  useEffect(() => {
    void markFollowingInBar(following);
  }, [following]);

  // Keep the window parked over the slot as the app window, the chat panel or
  // the navigation change size.
  useEffect(() => {
    if (!available || !opened) return;
    fit();
    const observer = new ResizeObserver(() => fit());
    if (slotRef.current) observer.observe(slotRef.current);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [available, opened, fit]);

  // Poll the real window so the address bar and tab title follow links the user
  // clicks inside the page — there is no navigation event on the bridge.
  useEffect(() => {
    if (!available || !opened) return;
    const timer = window.setInterval(async () => {
      const s = await browserWindowState();
      if (!s.open) {
        setOpened(false);
        return;
      }
      if (s.url) {
        updateActive({ url: s.url, title: s.title || hostOf(s.url) });
        if (!addressFocused.current) setAddress(s.url);
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [available, opened, updateActive]);

  // While "Browse with Gerry" is on, keep the backend's copy of the page fresh.
  useEffect(() => {
    if (!available || !opened || !following) return;
    let cancelled = false;
    const send = async () => {
      const page = await capturePage();
      if (page && !cancelled && page.text.trim()) await pushPage(page);
    };
    void send();
    const timer = window.setInterval(send, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [available, opened, following, active?.url]);

  const go = async (raw: string) => {
    const url = toUrl(raw);
    if (!url) return;
    setMessage(null);
    setAddress(url);
    updateActive({ url });
    const result = opened ? await navigateBrowser(url) : await openBrowser(url);
    if (result.ok) {
      setOpened(true);
      window.setTimeout(fit, 300);
    } else {
      setMessage(result.error ?? "Could not open that page.");
    }
  };

  const newTab = () => {
    const tab: Tab = { id: nextTabId++, url: HOME, title: "New tab" };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setAddress(HOME);
    void go(HOME);
  };

  const switchTab = (tab: Tab) => {
    setActiveId(tab.id);
    setAddress(tab.url);
    void (opened ? navigateBrowser(tab.url) : go(tab.url));
  };

  const closeTab = (id: number) => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        void closeBrowser();
        setOpened(false);
        return [{ id: nextTabId++, url: HOME, title: "New tab" }];
      }
      if (id === activeId) {
        const fallback = remaining[remaining.length - 1];
        setActiveId(fallback.id);
        setAddress(fallback.url);
        void navigateBrowser(fallback.url);
      }
      return remaining;
    });
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const handleAsk = () =>
    withBusy("ask", async () => {
      const page = await capturePage();
      if (!page || !page.text.trim()) {
        setMessage("There was nothing readable on that page.");
        return;
      }
      const blob = new Blob(
        [`# ${page.title || page.url}\n\nSource: ${page.url}\n\n---\n\n${page.text}\n`],
        { type: "text/markdown" },
      );
      await askGerry({
        title: `About: ${page.title || hostOf(page.url)}`,
        prompt:
          `I'm looking at this page: ${page.url}\n\n` +
          `The full text is attached. Give me the gist, then wait for my questions.`,
        file: { blob, filename: `${hostOf(page.url)}.md` },
      });
    });

  const handleSaveKb = () =>
    withBusy("kb", async () => {
      const page = await capturePage();
      if (!page || !page.text.trim()) {
        setMessage("There was nothing readable on that page.");
        return;
      }
      const saved = await savePageToKb(page);
      setMessage(`Saved "${saved.title}" to the Knowledge Base (${saved.chunk_count} chunks).`);
    });

  const handlePin = (roomId: string, roomTitle: string) =>
    withBusy("pin", async () => {
      setPinOpen(false);
      await addWorkroomItem(roomId, {
        kind: "website",
        ref_id: active.url,
        label: active.title || hostOf(active.url),
      });
      setMessage(`Pinned to ${roomTitle}.`);
      void showBrowser();
    });

  // The bar floating over the browsed page can only queue a request; the work
  // happens here, on the side that holds the login token.
  const runAction = useRef<(action: string) => void>(() => {});
  runAction.current = (action: string) => {
    if (action === "ask") void handleAsk();
    else if (action === "kb") void handleSaveKb();
    else if (action === "follow") followMut.mutate(!following);
    else if (action === "pin") {
      // The picker lives in the main window, which is behind the browser.
      void hideBrowser();
      setPinOpen(true);
    }
  };

  useEffect(() => {
    if (!available || !opened) return;
    const timer = window.setInterval(async () => {
      for (const action of await takeBrowserActions()) runAction.current(action);
    }, 900);
    return () => window.clearInterval(timer);
  }, [available, opened]);

  const currentBookmark = bookmarks.find((b) => b.url === active?.url);

  if (!available) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold">Research Browser</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          The research browser opens a real browser window alongside Little Gerry, so it only
          works in the desktop app — not in a web browser tab.
        </p>
      </div>
    );
  }

  const actionClass =
    "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50";

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      {/* Persistent action rail */}
      <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Compass className="h-5 w-5" /> Research Browser
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in to sites normally. Gerry only sees a page when you ask.
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => followMut.mutate(!following)}
            className={cn(
              actionClass,
              following && "border-primary bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            {following ? (
              <Eye className="h-4 w-4 shrink-0" />
            ) : (
              <EyeOff className="h-4 w-4 shrink-0" />
            )}
            {following ? "Gerry is watching" : "Browse with Gerry"}
          </button>

          <button onClick={handleAsk} disabled={!opened || busy !== null} className={actionClass}>
            {busy === "ask" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4 shrink-0" />
            )}
            Ask Gerry about this page
          </button>

          <button onClick={handleSaveKb} disabled={!opened || busy !== null} className={actionClass}>
            {busy === "kb" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Library className="h-4 w-4 shrink-0" />
            )}
            Save to Knowledge Base
          </button>

          <div className="relative">
            <button
              onClick={() => setPinOpen((v) => !v)}
              disabled={!opened || busy !== null}
              className={actionClass}
            >
              {busy === "pin" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Pin className="h-4 w-4 shrink-0" />
              )}
              Pin to workroom
            </button>
            {pinOpen && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
                {workrooms.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No workrooms yet.</p>
                ) : (
                  workrooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => handlePin(room.id, room.title)}
                      className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {room.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <button onClick={fit} disabled={!opened} className={actionClass}>
            <Maximize2 className="h-4 w-4 shrink-0" />
            Fit to window
          </button>
        </div>

        {following && (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            The page you're on goes with every chat message until you switch this off. Nothing is
            stored.
          </p>
        )}
        {message && <p className="text-xs text-muted-foreground">{message}</p>}

        <div className="min-h-0 flex-1">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bookmarks
          </h2>
          {bookmarks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Use the star in the address bar to save a page.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {bookmarks.map((b) => (
                <li
                  key={b.id}
                  className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"
                >
                  <button
                    onClick={() => void go(b.url)}
                    className="min-w-0 flex-1 truncate text-left text-sm"
                  >
                    {b.title || hostOf(b.url)}
                  </button>
                  <button
                    onClick={() => unbookmarkMut.mutate(b.id)}
                    className="rounded p-1 opacity-0 group-hover:opacity-100"
                    aria-label="Delete bookmark"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Chrome, plus the slot the real browser window is parked over */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => switchTab(tab)}
              className={cn(
                "group flex max-w-[200px] cursor-pointer items-center gap-2 rounded-t-md border-b-2 px-3 py-1.5 text-sm",
                tab.id === activeId
                  ? "border-primary bg-muted font-medium"
                  : "border-transparent hover:bg-muted/50",
              )}
            >
              <span className="truncate">{tab.title || hostOf(tab.url)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="opacity-0 group-hover:opacity-100"
                aria-label="Close tab"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button onClick={newTab} className="rounded p-1.5 hover:bg-muted" aria-label="New tab">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => void browserBack()}
            className="rounded p-2 hover:bg-muted"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => void browserForward()}
            className="rounded p-2 hover:bg-muted"
            aria-label="Forward"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => void browserReload()}
            className="rounded p-2 hover:bg-muted"
            aria-label="Reload"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              void go(address);
            }}
          >
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => (addressFocused.current = true)}
              onBlur={() => (addressFocused.current = false)}
              placeholder="Search or enter an address"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          </form>
          <button
            onClick={() =>
              currentBookmark
                ? unbookmarkMut.mutate(currentBookmark.id)
                : bookmarkMut.mutate({ url: active.url, title: active.title })
            }
            className="rounded p-2 hover:bg-muted"
            aria-label={currentBookmark ? "Remove bookmark" : "Add bookmark"}
          >
            {currentBookmark ? (
              <Star className="h-4 w-4 fill-current text-amber-500" />
            ) : (
              <BookmarkPlus className="h-4 w-4" />
            )}
          </button>
          {opened && (
            <button
              onClick={() => {
                void closeBrowser();
                setOpened(false);
              }}
              className="rounded p-2 hover:bg-muted"
              aria-label="Close browser window"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div
          ref={slotRef}
          className="flex min-h-0 flex-1 items-center justify-center rounded-lg border-2 border-dashed"
        >
          {!opened && (
            <button
              onClick={() => void go(address || HOME)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <ExternalLink className="h-4 w-4" /> Open browser
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
