/**
 * ChatSidebar — the assistant panel that sits beside every page.
 *
 * Collapsed: a 32px tab. Expanded: a resizable docked column, or a free-floating
 * panel when popped out. The conversation itself is a ConversationPane; this
 * file is the chrome around it and the choice of which conversation it shows.
 *
 * Inside a project space the panel is the project's: it shows the project's
 * conversation, names the project in its header, and tells Gerry which project
 * and tab every question came from. Leave the project and it goes back to the
 * conversation you had open before.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ChevronRight,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRight,
  PictureInPicture2,
} from "lucide-react";

import { ConversationPane } from "@/components/chat/ConversationPane";
import { HubBadge } from "@/components/HubBadge";
import {
  useChatSidebarStore,
  type FloatRect,
  DOCK_MIN_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_DEFAULT_WIDTH,
  DOCK_WIDE_WIDTH,
  FLOAT_MIN_WIDTH,
  FLOAT_MIN_HEIGHT,
} from "@/stores/chatSidebarStore";
import { createConversation, listConversations } from "@/api/chat";
import { ensureProjectWorkroom } from "@/api/tasks";
import { projectContextPrefix, useProjectHere } from "@/hooks/useProjectHere";
import { cn } from "@/lib/utils";
import { modLabel } from "@/lib/platform";

const ROUTE_LABELS: Record<string, string> = {
  "/":           "Solar System",
  "/gerry":      "Little Gerry",
  "/dashboard":  "Dashboard",
  "/agents":     "Agents",
  "/chat":       "Chat",
  "/tasks":      "Tasks",
  "/calendar":   "Calendar",
  "/documents":  "Knowledge Base",
  "/meetings":   "Meeting Notes",
  "/inbox":      "Gmail",
  "/regulatory": "Regulatory",
  "/projects":   "Projects",
  "/research":   "Research",
  "/browser":    "Research Browser",
  "/approvals":  "Approvals",
  "/settings":   "Settings",
  "/files":      "Generated Files",
};

function routeLabel(pathname: string): string {
  const exact = ROUTE_LABELS[pathname];
  if (exact) return exact;
  for (const [key, label] of Object.entries(ROUTE_LABELS)) {
    if (pathname.startsWith(key) && key !== "/") return label;
  }
  return "this page";
}

function clampWidth(w: number): number {
  return Math.min(Math.max(Math.round(w), DOCK_MIN_WIDTH), DOCK_MAX_WIDTH);
}

/** Keep a floating panel on screen, leaving its header reachable. */
function clampRect(r: FloatRect): FloatRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(Math.round(r.w), FLOAT_MIN_WIDTH), Math.max(FLOAT_MIN_WIDTH, vw - 16));
  const h = Math.min(Math.max(Math.round(r.h), FLOAT_MIN_HEIGHT), Math.max(FLOAT_MIN_HEIGHT, vh - 16));
  return {
    w,
    h,
    x: Math.min(Math.max(8, Math.round(r.x)), Math.max(8, vw - w - 8)),
    y: Math.min(Math.max(8, Math.round(r.y)), Math.max(8, vh - 56)),
  };
}

function defaultRect(width: number): FloatRect {
  const w = Math.max(FLOAT_MIN_WIDTH, width);
  const h = Math.round(window.innerHeight * 0.7);
  return clampRect({ w, h, x: window.innerWidth - w - 32, y: 72 });
}

// ── ChatSidebarToggle — rendered in Header ─────────────────────────────────

export function ChatSidebarToggle() {
  const toggle = useChatSidebarStore((s) => s.toggle);
  const open   = useChatSidebarStore((s) => s.open);
  return (
    <button
      onClick={toggle}
      title={open ? `Close Little Gerry (${modLabel("/")})` : `Open Little Gerry (${modLabel("/")})`}
      className={cn(
        "flex items-center justify-center rounded-md p-2 transition-colors",
        open ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
      )}
    >
      <Bot className="h-4 w-4" />
    </button>
  );
}

// ── Main sidebar ───────────────────────────────────────────────────────────────

export function ChatSidebar() {
  const {
    open,
    toggle,
    activeConversationId,
    setActiveConversationId,
    pendingMessage,
    setPendingMessage,
    width,
    setWidth,
    popped,
    setPopped,
    floatRect,
    setFloatRect,
  } = useChatSidebarStore();
  const location = useLocation();
  const qc = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);

  // Keyboard shortcut Ctrl+/ (Cmd+/ on macOS)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); toggle(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // ── Panel geometry: docked width, floating position/size ───────────────────
  // Live drag values are kept local and only committed to the persisted store
  // on pointer-up, so a drag doesn't write to localStorage on every frame.
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [dragRect, setDragRect] = useState<FloatRect | null>(null);
  const widthDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const rectDragRef = useRef<
    { mode: "move" | "resize"; startX: number; startY: number; origin: FloatRect } | null
  >(null);

  const effectiveWidth = dragWidth ?? width;
  const rect = dragRect ?? floatRect;

  // Re-clamp a floating panel when the window shrinks so it can't strand offscreen.
  useEffect(() => {
    if (!popped) return;
    function onResize() {
      const current = useChatSidebarStore.getState().floatRect;
      setFloatRect(current ? clampRect(current) : defaultRect(useChatSidebarStore.getState().width));
    }
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [popped, setFloatRect]);

  const startWidthDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    widthDragRef.current = { startX: e.clientX, startW: width };
    setDragWidth(width);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [width]);

  const onWidthDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = widthDragRef.current;
    if (!d) return;
    // Panel is docked on the right, so dragging left widens it.
    setDragWidth(clampWidth(d.startW - (e.clientX - d.startX)));
  }, []);

  const endWidthDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!widthDragRef.current) return;
    widthDragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragWidth((w) => { if (w !== null) setWidth(w); return null; });
  }, [setWidth]);

  const startRectDrag = useCallback(
    (mode: "move" | "resize") => (e: React.PointerEvent<HTMLElement>) => {
      // Never start a drag from an interactive control in the header.
      if (mode === "move" && (e.target as HTMLElement).closest("button, select, input, textarea, a")) {
        return;
      }
      const origin = useChatSidebarStore.getState().floatRect;
      if (!origin) return;
      e.preventDefault();
      rectDragRef.current = { mode, startX: e.clientX, startY: e.clientY, origin };
      setDragRect(origin);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [],
  );

  const onRectDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = rectDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setDragRect(
      clampRect(
        d.mode === "move"
          ? { ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy }
          : { ...d.origin, w: d.origin.w + dx, h: d.origin.h + dy },
      ),
    );
  }, []);

  const endRectDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!rectDragRef.current) return;
    rectDragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragRect((r) => { if (r) setFloatRect(r); return null; });
  }, [setFloatRect]);

  /** Pop out in place: the floating panel opens over the column it left. */
  const popOut = useCallback(() => {
    const box = panelRef.current?.getBoundingClientRect();
    setFloatRect(
      clampRect(
        box
          ? { x: box.left, y: box.top, w: Math.max(FLOAT_MIN_WIDTH, box.width), h: box.height }
          : defaultRect(width),
      ),
    );
    setPopped(true);
  }, [setFloatRect, setPopped, width]);

  const isExpanded = popped
    ? !!rect && rect.w >= window.innerWidth * 0.6
    : effectiveWidth >= DOCK_WIDE_WIDTH;

  const toggleExpanded = useCallback(() => {
    if (!popped) {
      setWidth(effectiveWidth >= DOCK_WIDE_WIDTH ? DOCK_DEFAULT_WIDTH : DOCK_WIDE_WIDTH);
      return;
    }
    const current = useChatSidebarStore.getState().floatRect;
    if (!current) return;
    setFloatRect(
      current.w >= window.innerWidth * 0.6
        ? defaultRect(DOCK_WIDE_WIDTH)
        : clampRect({
            x: window.innerWidth * 0.1,
            y: window.innerHeight * 0.08,
            w: window.innerWidth * 0.8,
            h: window.innerHeight * 0.84,
          }),
    );
  }, [popped, effectiveWidth, setWidth, setFloatRect]);

  // ── Which conversation ─────────────────────────────────────────────────────
  const here = useProjectHere();
  const bound = here !== null;

  const { data: conversations = [], isFetched: conversationsFetched } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
    enabled: open,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setActiveConversationId(conv.id);
    },
  });

  // A project made before every project got a conversation: give it one here.
  const startProjectConversation = useMutation({
    mutationFn: () => ensureProjectWorkroom(here!.id, here!.source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-space", here?.source, here?.id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  // Guard against React StrictMode running this effect twice on mount, which
  // would otherwise create two empty conversations back-to-back.
  const ensuringConvRef = useRef(false);

  // Ensure we have a general conversation when open and not inside a project.
  useEffect(() => {
    // Wait until the list has actually loaded. useQuery returns an empty array
    // as a placeholder before the fetch resolves; acting on that placeholder is
    // what spawned dozens of empty "untitled" conversations.
    if (!open || bound || !conversationsFetched || activeConversationId) return;

    const own = conversations.filter((c) => !c.hub_mirror);
    if (own.length > 0) {
      setActiveConversationId(own[0].id);
      return;
    }

    if (ensuringConvRef.current || createMutation.isPending) return;
    ensuringConvRef.current = true;
    createMutation.mutate(undefined, {
      onSettled: () => {
        ensuringConvRef.current = false;
      },
    });
  }, [
    open,
    bound,
    conversationsFetched,
    activeConversationId,
    conversations,
    createMutation,
    setActiveConversationId,
  ]);

  const conversationId = bound ? here.conversationId : activeConversationId;
  const source = bound ? here.source : "local";

  const isOnChatPage = location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const pageLabel = routeLabel(location.pathname);
  const contextPrefix = bound
    ? projectContextPrefix(here)
    : !isOnChatPage && pageLabel !== "Chat"
      ? `[Context: I am currently viewing the "${pageLabel}" page]`
      : undefined;

  const onSeedSent = useCallback(() => setPendingMessage(null), [setPendingMessage]);

  // ── Collapsed tab ──────────────────────────────────────────────────────────
  if (!open) {
    return (
      <div
        onClick={toggle}
        className="flex w-8 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 border-l bg-muted/30 hover:bg-muted/60 transition-colors"
        title="Open Little Gerry (Ctrl+/)"
      >
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span
          className="text-[9px] font-semibold tracking-widest text-muted-foreground uppercase"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          LITTLE GERRY
        </span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </div>
    );
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  const panelContents = (
    <>
      {/* Header */}
      <div
        onPointerDown={popped ? startRectDrag("move") : undefined}
        onPointerMove={popped ? onRectDrag : undefined}
        onPointerUp={popped ? endRectDrag : undefined}
        onPointerCancel={popped ? endRectDrag : undefined}
        className={cn(
          "flex items-center justify-between gap-2 border-b px-3 py-2.5",
          popped && "cursor-grab select-none active:cursor-grabbing",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-primary" />
          {bound ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold" title={here.name ?? undefined}>
                {here.name ?? "Project"}
              </span>
              <HubBadge source={here.source} />
            </span>
          ) : (
            <span className="text-sm font-semibold">Little Gerry</span>
          )}
          {isConnecting && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!bound && conversations.length > 0 && (
            <select
              value={activeConversationId ?? ""}
              onChange={(e) => setActiveConversationId(e.target.value || null)}
              className="max-w-[120px] truncate rounded border bg-background px-1.5 py-0.5 text-xs"
            >
              {/* A hub mirror is read inside its project, where it is kept in step. */}
              {conversations.filter((c) => !c.hub_mirror).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || "New conversation"}
                </option>
              ))}
            </select>
          )}
          {!bound && (
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New conversation"
            >
              +
            </button>
          )}
          <button
            onClick={toggleExpanded}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={isExpanded ? "Shrink" : "Expand"}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => (popped ? setPopped(false) : popOut())}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={popped ? "Dock back to the side" : "Pop out into a floating window"}
          >
            {popped ? <PanelRight className="h-3.5 w-3.5" /> : <PictureInPicture2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={toggle}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Close (Ctrl+/)"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {bound && (
        <p className="border-b bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
          This is the project's conversation. Gerry knows the project, its goal, what is pinned, and
          which tab you are on.
        </p>
      )}

      {bound && here.loaded && !here.conversationId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This project has no conversation with Gerry yet.
          </p>
          <button
            type="button"
            disabled={startProjectConversation.isPending}
            onClick={() => startProjectConversation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {startProjectConversation.isPending ? "Starting…" : "Start one"}
          </button>
          {startProjectConversation.isError && (
            <p className="text-xs text-rose-600">The conversation could not be started.</p>
          )}
        </div>
      ) : (
        <ConversationPane
          conversationId={conversationId}
          source={source}
          contextPrefix={contextPrefix}
          seed={pendingMessage}
          onSeedSent={onSeedSent}
          onConnectingChange={setIsConnecting}
          compact
          emptyHint={
            bound
              ? `Ask about ${here.name ?? "this project"}: its tasks, its material, what is late, what to do next.`
              : "Ask me anything about your work, documents, or tasks."
          }
        />
      )}
    </>
  );

  // ── Popped out: floats over the app, drag the header to move it ────────────
  if (popped && rect) {
    return (
      <div
        className="fixed z-40 flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      >
        {panelContents}
        <div
          onPointerDown={startRectDrag("resize")}
          onPointerMove={onRectDrag}
          onPointerUp={endRectDrag}
          onPointerCancel={endRectDrag}
          title="Drag to resize"
          className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize rounded-tl border-l border-t bg-muted/60 hover:bg-muted-foreground/30"
        />
      </div>
    );
  }

  // ── Docked column: drag the left edge to resize ────────────────────────────
  return (
    <div
      ref={panelRef}
      className="relative flex shrink-0 flex-col border-l bg-background"
      style={{ width: effectiveWidth }}
    >
      <div
        onPointerDown={startWidthDrag}
        onPointerMove={onWidthDrag}
        onPointerUp={endWidthDrag}
        onPointerCancel={endWidthDrag}
        onDoubleClick={() => setWidth(DOCK_DEFAULT_WIDTH)}
        title="Drag to resize • double-click to reset"
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-ew-resize hover:bg-primary/40"
      />
      {panelContents}
    </div>
  );
}
