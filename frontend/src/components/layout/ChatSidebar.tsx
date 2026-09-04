/**
 * ChatSidebar — persistent assistant panel visible on all pages.
 * Collapsed: 32px tab showing Bot icon + "ASSISTANT" text.
 * Expanded: resizable docked column, or a free-floating panel when popped out.
 * Sends page context prefix so the AI knows what the user is viewing.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  PanelRight,
  PictureInPicture2,
  RotateCcw,
  Send,
  Square,
  Wrench,
} from "lucide-react";
import { MessageBubble, type ArtifactLink } from "@/components/chat/MessageBubble";
import ConfirmDriveEditModal, { type DriveEditRequest } from "@/components/ConfirmDriveEditModal";
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
import { createConversation, listConversations, listMessages, stopTurn } from "@/api/chat";
import { grantDriveEdit } from "@/api/google";
import { useAuthStore } from "@/stores/authStore";
import { useCanvasSinkStore } from "@/stores/canvasSinkStore";
import { useToastStore } from "@/stores/toastStore";
import { useResizableTextarea } from "@/hooks/useResizableTextarea";
import { useChatInputSizeStore } from "@/stores/chatInputSizeStore";
import type { Message, WSToolStatusFrame } from "@/types/chat";
import { cn } from "@/lib/utils";
import { modLabel } from "@/lib/platform";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "ws://127.0.0.1:8000";

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
  "/emails":     "Emails",
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

interface ToolActivity {
  tool_name: string;
  status: "running" | "done";
  label: string;
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

// ── Right-click menu ───────────────────────────────────────────────────────

function ChatContextMenu({
  x,
  y,
  text,
  inInput,
  canDropOnCanvas,
  onCopy,
  onPaste,
  onAddToCanvas,
  onClose,
}: {
  x: number;
  y: number;
  text: string;
  inInput: boolean;
  canDropOnCanvas: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onAddToCanvas: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const items: {
    label: string;
    hint?: string;
    disabled?: boolean;
    onClick: () => void;
  }[] = [
    { label: "Copy", hint: modLabel("C"), disabled: !text, onClick: onCopy },
  ];
  if (inInput) {
    items.push({ label: "Paste", hint: modLabel("V"), onClick: onPaste });
  }
  items.push({
    label: "Add to the canvas",
    hint: canDropOnCanvas ? "sticky note" : "no canvas open",
    disabled: !text || !canDropOnCanvas,
    onClick: onAddToCanvas,
  });

  return (
    <div
      ref={ref}
      style={{
        left: Math.min(x, window.innerWidth - 208),
        top: Math.min(y, window.innerHeight - 8 - items.length * 30),
      }}
      className="fixed z-[60] w-52 rounded-md border border-border bg-card py-1 shadow-md"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        >
          <span>{item.label}</span>
          <span className="text-[10px] text-muted-foreground">{item.hint}</span>
        </button>
      ))}
    </div>
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
  const { accessToken: token } = useAuthStore();
  const location = useLocation();
  const qc = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [turnArtifacts, setTurnArtifacts] = useState<ArtifactLink[]>([]);
  const [pendingDriveEdit, setPendingDriveEdit] = useState<DriveEditRequest | null>(null);
  const [grantingDriveEdit, setGrantingDriveEdit] = useState(false);
  const [driveEditError, setDriveEditError] = useState<string | null>(null);
  // True once a sent message has gone 45s with no streaming/tool activity —
  // gates the "No reply? Resend" chip so it never flashes during normal turns.
  const [turnStuck, setTurnStuck] = useState(false);
  const [stopping, setStopping] = useState(false);

  // A turn is in flight while the last message is the user's, or text is streaming.
  const turnRunning =
    streamingContent !== null ||
    (messages.length > 0 && messages[messages.length - 1].role === "user");

  const handleStop = useCallback(async () => {
    if (!activeConversationId) return;
    setStopping(true);
    try {
      await stopTurn(activeConversationId);
    } catch {
      /* the turn may still land; leave the UI as it is */
    } finally {
      setStopping(false);
    }
  }, [activeConversationId]);

  useEffect(() => {
    const waiting =
      messages.length > 0 &&
      messages[messages.length - 1].role === "user" &&
      streamingContent === null;
    if (!waiting) {
      setTurnStuck(false);
      return;
    }
    const t = window.setTimeout(() => setTurnStuck(true), 45_000);
    return () => window.clearTimeout(t);
  }, [messages, streamingContent, toolActivities]);
  // The conversation id whose websocket is currently OPEN, used to fire a
  // queued "Ask Gerry about this" seed message once connected.
  const [wsReadyConvId, setWsReadyConvId] = useState<string | null>(null);

  const wsRef        = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sidebarHeight = useChatInputSizeStore((s) => s.sidebarHeight);
  const setSidebarHeight = useChatInputSizeStore((s) => s.setSidebarHeight);
  const { ref: textareaRef, startResize } = useResizableTextarea({
    value: inputText,
    manualHeight: sidebarHeight,
    setManualHeight: setSidebarHeight,
    autoMax: 220,
    min: 36,
    max: 400,
  });

  // ── Right-click menu ───────────────────────────────────────────────────────
  // The panel sits over every page, so a selection here has to keep its own
  // clipboard keys and needs somewhere obvious to go.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    text: string;
    inInput: boolean;
  } | null>(null);
  const dropOnCanvas = useCanvasSinkStore((s) => s.dropText);
  const pushToast = useToastStore((s) => s.push);

  const openMenu = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const input = el instanceof HTMLTextAreaElement ? el : null;
    const text = input
      ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
      : (window.getSelection()?.toString() ?? "");
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, text, inInput: Boolean(input) });
  }, []);

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        pushToast("error", `The clipboard refused. Use ${modLabel("C")} instead.`);
      }
    },
    [pushToast],
  );

  const pasteIntoInput = useCallback(async () => {
    const el = textareaRef.current;
    if (!el) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      pushToast("error", `The clipboard refused. Use ${modLabel("V")} instead.`);
      return;
    }
    if (!text) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    setInputText(el.value.slice(0, start) + text + el.value.slice(end));
    const caret = start + text.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }, [textareaRef, pushToast]);

  // Keyboard shortcut Ctrl+/ (Cmd+/ on macOS)
  useEffect(() => {    function onKey(e: KeyboardEvent) {
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

  // Conversations list
  const { data: conversations = [], isFetched: conversationsFetched } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
    enabled: open,
    staleTime: 30_000,
  });

  // Create conversation on first open
  const createMutation = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setActiveConversationId(conv.id);
    },
  });

  // Guard against React StrictMode running this effect twice on mount, which
  // would otherwise create two empty conversations back-to-back.
  const ensuringConvRef = useRef(false);

  // Ensure we have an active conversation when open.
  useEffect(() => {
    // Wait until the list has actually loaded. useQuery returns an empty array
    // as a placeholder before the fetch resolves; acting on that placeholder is
    // what spawned dozens of empty "untitled" conversations (one per sidebar
    // open, doubled by StrictMode).
    if (!open || !conversationsFetched || activeConversationId) return;

    if (conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
      return;
    }

    // Genuinely no conversations exist yet — create exactly one.
    if (ensuringConvRef.current || createMutation.isPending) return;
    ensuringConvRef.current = true;
    createMutation.mutate(undefined, {
      onSettled: () => {
        ensuringConvRef.current = false;
      },
    });
  }, [
    open,
    conversationsFetched,
    activeConversationId,
    conversations,
    createMutation,
    setActiveConversationId,
  ]);

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConversationId) return;
    listMessages(activeConversationId).then(setMessages).catch(() => {});
  }, [activeConversationId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolActivities]);

  // WebSocket connect
  const connectWS = useCallback(
    (convId: string) => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (!token) return;
      const ws = new WebSocket(`${WS_BASE}/ws/chat/${convId}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      setIsConnecting(true);
      setWsReadyConvId(null);

      ws.onopen = () => { setIsConnecting(false); setWsReadyConvId(convId); };
      ws.onclose = () => { setIsConnecting(false); setWsReadyConvId(null); };

      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data);
          if (frame.type === "token" && frame.content) {
            setStreamingContent((prev) => (prev ?? "") + frame.content);
            setToolActivities([]);
            return;
          }
          if (frame.type === "tool_status") {
            const ts = frame as WSToolStatusFrame;
            setToolActivities((prev) => {
              const idx = [...prev].reverse().findIndex((a) => a.tool_name === ts.tool_name);
              const trueIdx = idx >= 0 ? prev.length - 1 - idx : -1;
              if (trueIdx >= 0 && prev[trueIdx].status === "running") {
                const next = [...prev];
                next[trueIdx] = { tool_name: ts.tool_name, status: ts.status, label: ts.label ?? ts.tool_name };
                return next;
              }
              return [...prev, { tool_name: ts.tool_name, status: ts.status, label: ts.label ?? ts.tool_name }];
            });
            return;
          }
          if (frame.type === "artifact_link") {
            const art = (frame as { artifact?: ArtifactLink }).artifact;
            if (art?.label) {
              setTurnArtifacts((prev) =>
                prev.some((p) => p.label === art.label && p.route === art.route && p.url === art.url)
                  ? prev
                  : [...prev, art],
              );
            }
            return;
          }
          if (frame.type === "confirm_drive_edit") {
            // Gerry asked to edit one Drive file — no grant exists until Allow.
            const req = frame as DriveEditRequest;
            if (req.file_id) setPendingDriveEdit(req);
            return;
          }
          if (frame.type === "done") {
            // Reload persisted messages from DB
            if (convId) listMessages(convId).then(setMessages).catch(() => {});
            setStreamingContent(null);
            setToolActivities([]);
            setTurnArtifacts([]); // the persisted message carries the chips now
            return;
          }
          if (frame.type === "error") {
            const detail = frame.detail ?? "An error occurred.";
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                conversation_id: convId,
                role: "assistant" as const,
                content: `⚠️ ${detail}`,
                agent_type: null,
                model_name: null,
                cited_chunk_ids: [],
                tool_calls: null,
                tool_results: null,
                created_at: new Date().toISOString(),
              },
            ]);
            setStreamingContent(null);
            setToolActivities([]);
            setTurnArtifacts([]);
          }
        } catch { /* ignore */ }
      };
    },
    [token],
  );

  useEffect(() => {
    if (open && activeConversationId) connectWS(activeConversationId);
    return () => { wsRef.current?.close(); wsRef.current = null; };
  }, [open, activeConversationId, connectWS]);

  // Reset streaming state when conversation changes
  useEffect(() => {
    setStreamingContent(null);
    setToolActivities([]);
  }, [activeConversationId]);

  // Auto-send a queued "Ask Gerry about this" seed message once the websocket
  // for its conversation is open. The seed is self-contained (no page context).
  useEffect(() => {
    if (!pendingMessage || !activeConversationId) return;
    if (wsReadyConvId !== activeConversationId) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        conversation_id: activeConversationId,
        role: "user" as const,
        content: pendingMessage,
        agent_type: null,
        model_name: null,
        cited_chunk_ids: [],
        tool_calls: null,
        tool_results: null,
        created_at: new Date().toISOString(),
      },
    ]);
    ws.send(JSON.stringify({ type: "human", content: pendingMessage }));
    setPendingMessage(null);
  }, [pendingMessage, activeConversationId, wsReadyConvId, setPendingMessage]);

  function sendMessage() {
    const text = inputText.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Prepend page context on non-chat pages
    const isOnChatPage = location.pathname === "/chat" || location.pathname.startsWith("/chat/");
    const label = routeLabel(location.pathname);
    const fullText = (!isOnChatPage && label !== "Chat")
      ? `[Context: I am currently viewing the "${label}" page]\n\n${text}`
      : text;

    // Optimistically add user message
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        conversation_id: activeConversationId ?? "",
        role: "user" as const,
        content: text,
        agent_type: null,
        model_name: null,
        cited_chunk_ids: [],
        tool_calls: null,
        tool_results: null,
        created_at: new Date().toISOString(),
      },
    ]);

    wsRef.current.send(JSON.stringify({ type: "human", content: fullText }));
    setInputText("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

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
          "flex items-center justify-between border-b px-3 py-2.5",
          popped && "cursor-grab select-none active:cursor-grabbing",
        )}
      >
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Little Gerry</span>
          {isConnecting && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1">
          {/* Conversation picker */}
          {conversations.length > 0 && (
            <select
              value={activeConversationId ?? ""}
              onChange={(e) => setActiveConversationId(e.target.value || null)}
              className="rounded border bg-background px-1.5 py-0.5 text-xs max-w-[120px] truncate"
            >
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || "New conversation"}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            title="New conversation"
          >
            +
          </button>
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

      {/* Messages */}
      <div
        onContextMenu={openMenu}
        className="flex-1 overflow-y-auto px-2 py-2 space-y-2"
      >
        {messages.length === 0 && !isConnecting && (
          <p className="text-center text-xs text-muted-foreground py-8 px-4">
            Ask me anything about your work, documents, or tasks.
          </p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} compact />
        ))}
        {streamingContent !== null && (
          <MessageBubble
            message={{
              id: "__streaming__",
              conversation_id: activeConversationId ?? "",
              role: "assistant",
              content: streamingContent,
              agent_type: null,
              model_name: null,
              cited_chunk_ids: [],
              tool_calls: null,
              tool_results: turnArtifacts,
              created_at: new Date().toISOString(),
            }}
            compact
          />
        )}
        {toolActivities.map((a) => (
          <div key={a.tool_name} className="flex items-center gap-2 text-xs text-muted-foreground px-2">
            <Wrench className="h-3 w-3 animate-pulse text-primary" />
            <span className="truncate">{a.label}</span>
          </div>
        ))}
        {turnRunning && (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="ml-2 flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
            title="Stop here. Anything Gerry has already done is kept."
          >
            <Square className="h-3 w-3" />
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
        {/* Hung turn — 45s with no reply and nothing streaming */}
        {turnStuck &&
          streamingContent === null &&
          messages.length > 0 &&
          messages[messages.length - 1].role === "user" && (
            <button
              onClick={() => {
                const last = [...messages].reverse().find((m) => m.role === "user");
                if (!last?.content || wsRef.current?.readyState !== WebSocket.OPEN) return;
                setToolActivities([]);
                setTurnStuck(false);
                setMessages((prev) => [
                  ...prev,
                  { ...last, id: crypto.randomUUID(), created_at: new Date().toISOString() },
                ]);
                wsRef.current.send(JSON.stringify({ type: "human", content: last.content }));
              }}
              className="ml-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Send the last message again"
            >
              <RotateCcw className="h-3 w-3" />
              No reply? Resend
            </button>
          )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-2" onContextMenu={openMenu}>
        <div className="relative flex items-end gap-1.5 rounded-lg border bg-muted/30 px-2.5 py-1.5">
          <div
            onPointerDown={startResize}
            onDoubleClick={() => setSidebarHeight(null)}
            title="Drag to resize • double-click to auto-fit"
            className="absolute -top-1.5 left-1/2 z-10 h-3 w-9 -translate-x-1/2 cursor-ns-resize rounded-full border bg-muted shadow-sm hover:bg-muted-foreground/30"
          />
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Little Gerry… (Enter to send)"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={sendMessage}
            disabled={!inputText.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {menu && (
        <ChatContextMenu
          x={menu.x}
          y={menu.y}
          text={menu.text}
          inInput={menu.inInput}
          canDropOnCanvas={Boolean(dropOnCanvas)}
          onCopy={() => void copyText(menu.text)}
          onPaste={() => void pasteIntoInput()}
          onAddToCanvas={() => dropOnCanvas?.(menu.text)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );

  const driveEditModal = pendingDriveEdit && (
    <ConfirmDriveEditModal
      request={pendingDriveEdit}
      busy={grantingDriveEdit}
      error={driveEditError}
      onAllow={async () => {
        setGrantingDriveEdit(true);
        setDriveEditError(null);
        try {
          await grantDriveEdit(pendingDriveEdit.file_id);
          qc.invalidateQueries({ queryKey: ["drive-edit-grants"] });
          setPendingDriveEdit(null);
        } catch (err) {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setDriveEditError(typeof detail === "string" ? detail : "Couldn't grant permission.");
        } finally {
          setGrantingDriveEdit(false);
        }
      }}
      onDeny={() => {
        setDriveEditError(null);
        setPendingDriveEdit(null);
      }}
    />
  );

  // ── Popped out: floats over the app, drag the header to move it ────────────
  if (popped && rect) {
    return (
      <>
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
        {driveEditModal}
      </>
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
      {driveEditModal}
    </div>
  );
}
