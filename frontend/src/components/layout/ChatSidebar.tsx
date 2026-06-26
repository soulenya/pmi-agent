/**
 * ChatSidebar — persistent assistant panel visible on all pages.
 * Collapsed: 32px tab showing Bot icon + "ASSISTANT" text.
 * Expanded: 320px panel with full chat interface.
 * Sends page context prefix so the AI knows what the user is viewing.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronRight, Loader2, Send, Wrench } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { useChatSidebarStore } from "@/stores/chatSidebarStore";
import { createConversation, listConversations, listMessages } from "@/api/chat";
import { useAuthStore } from "@/stores/authStore";
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
  const { open, toggle, activeConversationId, setActiveConversationId } = useChatSidebarStore();
  const { accessToken: token } = useAuthStore();
  const location = useLocation();
  const qc = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);

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

  // Keyboard shortcut Ctrl+/ (Cmd+/ on macOS)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); toggle(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

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

      ws.onopen = () => setIsConnecting(false);
      ws.onclose = () => setIsConnecting(false);

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
          if (frame.type === "done") {
            // Reload persisted messages from DB
            if (convId) listMessages(convId).then(setMessages).catch(() => {});
            setStreamingContent(null);
            setToolActivities([]);
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
  return (
    <div className="flex w-80 shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2.5">
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
            onClick={toggle}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Close (Ctrl+/)"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
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
              tool_results: null,
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
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-2">
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
    </div>
  );
}
