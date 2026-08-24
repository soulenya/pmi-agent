import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  Loader2,
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
  getBrowserState,
  hostOf,
  isBrowserAvailable,
  listBookmarks,
  navigateBrowser,
  openBrowser,
  pushPage,
  savePageToKb,
  setFollowing,
  toUrl,
} from "@/api/browser";
import { useAskGerry } from "@/hooks/useAskGerry";
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
  const addressFocused = useRef(false);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const { data: bookmarks = [] } = useQuery({
    queryKey: ["browser", "bookmarks"],
    queryFn: listBookmarks,
  });
  const { data: state } = useQuery({
    queryKey: ["browser", "state"],
    queryFn: getBrowserState,
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
    if (result.ok) setOpened(true);
    else setMessage(result.error ?? "Could not open that page.");
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
    void (opened ? navigateBrowser(tab.url) : openBrowser(tab.url).then(() => setOpened(true)));
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

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Globe className="h-6 w-6" /> Research Browser
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse in a separate window. Sign in to sites normally — Gerry only sees a page when
          you ask him to.
        </p>
      </header>

      {/* tabs */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => switchTab(tab)}
            className={cn(
              "group flex max-w-[220px] cursor-pointer items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-sm",
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
              className="opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Close tab"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button onClick={newTab} className="rounded p-2 hover:bg-muted" aria-label="New tab">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* address bar */}
      <div className="flex items-center gap-2">
        <button onClick={() => void browserBack()} className="rounded p-2 hover:bg-muted" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button onClick={() => void browserForward()} className="rounded p-2 hover:bg-muted" aria-label="Forward">
          <ArrowRight className="h-4 w-4" />
        </button>
        <button onClick={() => void browserReload()} className="rounded p-2 hover:bg-muted" aria-label="Reload">
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
        {!opened && (
          <button
            onClick={() => void go(address || HOME)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            <ExternalLink className="h-4 w-4" /> Open browser
          </button>
        )}
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
        <button
          onClick={() => followMut.mutate(!following)}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
            following ? "bg-primary text-primary-foreground" : "border hover:bg-muted",
          )}
        >
          {following ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {following ? "Gerry is watching this window" : "Browse with Gerry"}
        </button>
        <button
          onClick={handleAsk}
          disabled={!opened || busy !== null}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          {busy === "ask" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Ask Gerry about this page
        </button>
        <button
          onClick={handleSaveKb}
          disabled={!opened || busy !== null}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          {busy === "kb" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save to Knowledge Base
        </button>
        {opened && (
          <button
            onClick={() => {
              void closeBrowser();
              setOpened(false);
            }}
            className="ml-auto rounded-md border px-3 py-2 text-sm hover:bg-muted"
          >
            Close browser window
          </button>
        )}
      </div>

      {following && (
        <p className="text-xs text-muted-foreground">
          Gerry sees the page you're on in every chat message until you switch this off. Pages
          are read fresh each time and never stored.
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      {/* bookmarks */}
      <section className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Bookmarks</h2>
        {bookmarks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No bookmarks yet. Use the star in the address bar to save a page.
          </p>
        ) : (
          <ul className="space-y-1">
            {bookmarks.map((b) => (
              <li key={b.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <button onClick={() => void go(b.url)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm">{b.title || b.url}</span>
                  <span className="block truncate text-xs text-muted-foreground">{hostOf(b.url)}</span>
                </button>
                <button
                  onClick={() => unbookmarkMut.mutate(b.id)}
                  className="rounded p-1.5 opacity-0 hover:bg-background group-hover:opacity-100"
                  aria-label="Delete bookmark"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
