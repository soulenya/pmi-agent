import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusCircle, Loader2 } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { createConversation, listConversations, listMessages } from "@/api/chat";
import type { Message } from "@/types/chat";
import { cn } from "@/lib/utils";

// WebSocket URL — connects to the backend WS endpoint
const WS_BASE = import.meta.env.VITE_WS_BASE ?? "ws://127.0.0.1:8000";

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // ── Conversation list ──────────────────────────────────────────────────────
  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  // ── Messages for active conversation ──────────────────────────────────────
  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => listMessages(conversationId!),
    enabled: !!conversationId,
  });

  // ── Create conversation ────────────────────────────────────────────────────
  const createConvMutation = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/chat/${conv.id}`);
    },
  });

  // ── WebSocket connection for this conversation ─────────────────────────────
  useEffect(() => {
    if (!conversationId) return;

    const ws = new WebSocket(`${WS_BASE}/ws/chat/${conversationId}`);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: "token" | "done" | "error";
          content?: string;
        };

        if (msg.type === "token" && msg.content) {
          setStreamingContent((prev) => (prev ?? "") + msg.content);
        } else if (msg.type === "done") {
          // Flush streamed message into real message list
          queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
          setStreamingContent(null);
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
      setStreamingContent(null);
      setWsConnected(false);
    };
  }, [conversationId, queryClient]);

  // ── Auto-scroll to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = useCallback(
    (content: string) => {
      if (!conversationId) {
        // Create a conversation first, then send
        createConvMutation.mutate();
        return;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(content);

        // Optimistically add user message to the list
        const optimistic: Message = {
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          role: "user",
          content,
          cited_chunk_ids: null,
          tool_calls: null,
          tool_results: null,
          token_count: null,
          model_used: null,
          created_at: new Date().toISOString(),
        };
        queryClient.setQueryData<Message[]>(
          ["messages", conversationId],
          (prev) => [...(prev ?? []), optimistic],
        );
      }
    },
    [conversationId, createConvMutation, queryClient],
  );

  return (
    <div className="flex h-full gap-4">
      {/* ── Conversation sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-56 flex-col gap-2 border-r pr-4">
        <button
          onClick={() => createConvMutation.mutate()}
          disabled={createConvMutation.isPending}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          <PlusCircle className="h-4 w-4" />
          New conversation
        </button>

        <div className="flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/chat/${c.id}`)}
              className={cn(
                "w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors",
                c.id === conversationId
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {c.title ?? "Untitled conversation"}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Message thread ────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Status badge */}
        {conversationId && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                wsConnected ? "bg-green-500" : "bg-yellow-500",
              )}
            />
            {wsConnected ? "Connected" : "Connecting…"}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto pb-2">
          {!conversationId && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <p className="text-lg font-medium">How can I help you today?</p>
              <p className="text-sm">
                Start a new conversation or select one from the sidebar.
              </p>
            </div>
          )}

          {messagesLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {/* Streaming token buffer */}
          {streamingContent && (
            <MessageBubble
              message={{
                id: "streaming",
                conversation_id: conversationId ?? "",
                role: "assistant",
                content: streamingContent,
                cited_chunk_ids: null,
                tool_calls: null,
                tool_results: null,
                token_count: null,
                model_used: null,
                created_at: new Date().toISOString(),
              }}
            />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          disabled={!conversationId && createConvMutation.isPending}
          placeholder={
            conversationId
              ? "Message PMI Agent…"
              : "Start typing to create a new conversation…"
          }
        />
      </div>
    </div>
  );
}
