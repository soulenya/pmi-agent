import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusCircle, Loader2, Pencil, Archive, Check, X, Wrench, Mic, AudioLines, Volume2 } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { SentenceSpeaker } from "@/lib/sentenceSpeaker";
import {
  ApprovalCard,
  usePendingApprovals,
  useResolveApproval,
} from "@/components/approvals/ApprovalCard";
import { ChatInput } from "@/components/chat/ChatInput";
import { AttachmentBar } from "@/components/chat/AttachmentBar";
import ConfirmDeleteModal from "@/components/ConfirmDeleteModal";
import {
  createConversation,
  listConversations,
  listMessages,
  updateConversation,
} from "@/api/chat";
import { getSettings } from "@/api/settings";
import { deleteDocument } from "@/api/documents";
import { speakText } from "@/api/voice";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { useAuthStore } from "@/stores/authStore";
import type { Message, WSToolStatusFrame } from "@/types/chat";
import { cn } from "@/lib/utils";

// WebSocket URL â€” connects to the backend WS endpoint
const WS_BASE = import.meta.env.VITE_WS_BASE ?? "ws://127.0.0.1:8000";

// â”€â”€ Tool activity item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ToolActivity {
  tool_name: string;
  status: "running" | "done";
  label: string;
}

// â”€â”€ ConversationItem â€” sidebar item with inline rename â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ConversationItem({
  id,
  title,
  isActive,
  onClick,
  onRename,
  onArchive,
}: {
  id: string;
  title: string | null;
  isActive: boolean;
  onClick: () => void;
  onRename: (id: string, newTitle: string) => void;
  onArchive: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(title ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) {
      onRename(id, trimmed);
    }
    setEditing(false);
  };

  const cancel = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-md bg-accent px-2 py-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          onBlur={commit}
          className="flex-1 bg-transparent text-sm outline-none text-accent-foreground min-w-0"
        />
        <button onClick={commit} className="shrink-0 text-green-500 hover:text-green-400">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button onClick={cancel} className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded-md text-sm transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <button
        onClick={onClick}
        className="flex-1 truncate px-3 py-2 text-left"
      >
        {title ?? "Untitled conversation"}
      </button>
      {/* Action buttons visible on hover */}
      <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={startEdit}
          title="Rename"
          className="rounded p-1 hover:bg-background/30"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(id); }}
          title="Archive"
          className="rounded p-1 hover:bg-background/30"
        >
          <Archive className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// â”€â”€ Tool activity strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ToolActivityStrip({ activities }: { activities: ToolActivity[] }) {
  if (activities.length === 0) return null;
  const latest = activities[activities.length - 1];
  return (
    <div className="flex items-center gap-2 rounded-xl bg-secondary/70 px-3 py-2 text-xs text-muted-foreground max-w-[75%]">
      <Wrench className={cn("h-3.5 w-3.5 shrink-0", latest.status === "running" && "animate-pulse text-primary")} />
      <span className="truncate">{latest.label}</span>
      {latest.status === "running" && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      )}
    </div>
  );
}

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ document_id: string; title: string } | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

  // ── Voice ──────────────────────────────────────────────────────────────────────────
  const { data: appSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
  });
  const voiceEnabled = appSettings?.google_key_set ?? false;
  // Refs so the WebSocket handler always sees current values
  const speakRepliesRef = useRef(false);
  useEffect(() => {
    speakRepliesRef.current = (appSettings?.voice_speak_replies ?? false) && voiceEnabled;
  }, [appSettings, voiceEnabled]);
  const streamBufferRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Sentence-streamed reply playback (voice mode / speak-replies).
  const speakerRef = useRef<SentenceSpeaker | null>(null);

  // ── Voice Conversation mode (hands-free talk → reply aloud → listen again) ───
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const handleSendRef = useRef<(content: string) => void>(() => {});

  const { status: voiceStatus, start: voiceStart, stop: voiceStop } = useVoiceConversation({
    onTranscript: (text) => {
      setVoiceError(null);
      handleSendRef.current(text);
    },
    onError: (message) => {
      setVoiceError(message);
      if (message.startsWith("Microphone")) setVoiceMode(false); // can't listen — exit mode
    },
  });

  const playReply = useCallback(async (text: string, voiceLoop = false) => {
    if (!text.trim()) return;
    try {
      const blob = await speakText(text);
      audioRef.current?.pause();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      if (voiceLoop) setVoiceSpeaking(true);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (voiceLoop) {
          setVoiceSpeaking(false);
          if (voiceModeRef.current) void voiceStart(); // loop: listen for the user's next turn
        }
      };
      await audio.play();
    } catch {
      // TTS failure should never disrupt the chat
      if (voiceLoop) {
        setVoiceSpeaking(false);
        if (voiceModeRef.current) void voiceStart();
      }
    }
  }, [voiceStart]);

  const exitVoiceMode = useCallback(() => {
    setVoiceMode(false);
    setVoiceSpeaking(false);
    setVoiceError(null);
    voiceStop();
    speakerRef.current?.cancel();
    speakerRef.current = null;
    audioRef.current?.pause();
  }, [voiceStop]);

  const toggleVoiceMode = useCallback(() => {
    if (voiceModeRef.current) {
      exitVoiceMode();
    } else {
      setVoiceError(null);
      setVoiceMode(true);
      void voiceStart();
    }
  }, [exitVoiceMode, voiceStart]);

  // Esc exits voice mode
  useEffect(() => {
    if (!voiceMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitVoiceMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voiceMode, exitVoiceMode]);

  // Release the mic when leaving the page
  useEffect(() => () => voiceStop(), [voiceStop]);

  // Interrupt Gerry mid-sentence: stop playback and listen right away
  const interruptSpeech = useCallback(() => {
    speakerRef.current?.cancel();
    speakerRef.current = null;
    audioRef.current?.pause();
    setVoiceSpeaking(false);
    if (voiceModeRef.current) void voiceStart();
  }, [voiceStart]);

  const voicePhase = !voiceMode
    ? null
    : voiceStatus === "listening"
      ? "listening"
      : voiceStatus === "transcribing"
        ? "transcribing"
        : voiceSpeaking
          ? "speaking"
          : "thinking";

  // Stop playback when leaving the page
  useEffect(() => {
    return () => {
      speakerRef.current?.cancel();
      audioRef.current?.pause();
    };
  }, []);

  // â”€â”€ Conversation list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  // â”€â”€ Messages for active conversation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => listMessages(conversationId!),
    enabled: !!conversationId,
  });

  // Remember the last open conversation so the left rail's chat button can
  // jump straight back to it from anywhere in the app.
  useEffect(() => {
    if (conversationId) {
      try {
        localStorage.setItem("chat.lastConversationId", conversationId);
      } catch {
        /* ignore */
      }
    }
  }, [conversationId]);

  // Approvals Gerry raised in THIS conversation — approve/reject inline.
  const { data: chatApprovals = [] } = usePendingApprovals({
    conversation_id: conversationId,
    enabled: !!conversationId,
    refetchInterval: 20_000,
  });
  const resolveChatApproval = useResolveApproval();

  // â”€â”€ Create conversation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const createConvMutation = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/chat/${conv.id}`);
    },
  });

  // â”€â”€ Rename conversation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      updateConversation(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  // â”€â”€ Archive conversation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const archiveMutation = useMutation({
    mutationFn: (id: string) => updateConversation(id, { is_archived: true }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      // Navigate away if the archived conversation was active
      if (id === conversationId) navigate("/chat");
    },
  });

  // â”€â”€ WebSocket connection for this conversation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!conversationId) return;

    const token = useAuthStore.getState().accessToken;
    const wsUrl = token
      ? `${WS_BASE}/ws/chat/${conversationId}?token=${encodeURIComponent(token)}`
      : `${WS_BASE}/ws/chat/${conversationId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: "token" | "done" | "error" | "tool_status" | "confirm_delete";
          content?: string;
          tool_name?: string;
          status?: string;
          label?: string;
          document_id?: string;
          title?: string;
        };

        if (msg.type === "token" && msg.content) {
          setStreamingContent((prev) => (prev ?? "") + msg.content);
          streamBufferRef.current += msg.content;
          // Clear tool activity once the LLM starts responding
          setToolActivities([]);
          // Sentence-streamed speech — speak the first sentence while the rest
          // of the reply is still generating.
          if (voiceModeRef.current || speakRepliesRef.current) {
            if (!speakerRef.current) {
              speakerRef.current = new SentenceSpeaker({
                onStart: () => {
                  if (voiceModeRef.current) setVoiceSpeaking(true);
                },
                onAllDone: () => {
                  speakerRef.current = null;
                  if (voiceModeRef.current) {
                    setVoiceSpeaking(false);
                    void voiceStart(); // loop: listen for the user's next turn
                  }
                },
              });
            }
            speakerRef.current.feed(msg.content);
          }
        } else if (msg.type === "tool_status") {
          const frame = msg as unknown as WSToolStatusFrame;
          setToolActivities((prev) => {
            // Update existing entry for this tool_name or append
            const idx = [...prev].reverse().findIndex((a: ToolActivity) => a.tool_name === frame.tool_name);
            const trueIdx = idx >= 0 ? prev.length - 1 - idx : -1;
            if (trueIdx >= 0 && prev[trueIdx].status === "running") {
              const next = [...prev];
              next[trueIdx] = { tool_name: frame.tool_name, status: frame.status, label: frame.label };
              return next;
            }
            return [...prev, { tool_name: frame.tool_name, status: frame.status, label: frame.label }];
          });
        } else if (msg.type === "confirm_delete") {
          // An agent requested KB document deletion — show the final popup.
          // Nothing is deleted until the user confirms here.
          if (msg.document_id) {
            setPendingDelete({
              document_id: msg.document_id,
              title: msg.title ?? "this document",
            });
          }
        } else if (msg.type === "done") {
          // Flush streamed message into real message list
          queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
          // Refresh conversations to pick up auto-title if set
          queryClient.invalidateQueries({ queryKey: ["conversations"] });
          // Gerry may have raised an approval during this turn — surface it inline
          queryClient.invalidateQueries({ queryKey: ["approvals"] });
          setStreamingContent(null);
          setToolActivities([]);
          // Speak the reply aloud — sentence-streamed playback normally started
          // during the token stream; these are fallbacks for empty streams.
          const finalText = streamBufferRef.current;
          streamBufferRef.current = "";
          if (speakerRef.current) {
            speakerRef.current.finish();
          } else if (voiceModeRef.current && finalText) {
            void playReply(finalText, true);
          } else if (speakRepliesRef.current && finalText) {
            void playReply(finalText);
          } else if (voiceModeRef.current) {
            void voiceStart(); // empty reply — don't strand the voice loop
          }
        } else if (msg.type === "error") {
          const detail = (msg as unknown as { detail?: string }).detail ?? "An error occurred.";
          setStreamingContent(null);
          setToolActivities([]);
          streamBufferRef.current = "";
          speakerRef.current?.cancel();
          speakerRef.current = null;
          // In voice mode, resume listening so the conversation isn't stranded
          if (voiceModeRef.current) void voiceStart();
          // Inject a synthetic error message into the message list so it's visible in the chat bubble
          queryClient.setQueryData<Message[]>(
            ["messages", conversationId],
            (prev) => [
              ...(prev ?? []),
              {
                id: crypto.randomUUID(),
                conversation_id: conversationId ?? "",
                role: "assistant",
                content: `⚠️ ${detail}`,
                agent_type: null,
                model_name: null,
                cited_chunk_ids: [],
                tool_calls: null,
                tool_results: null,
                created_at: new Date().toISOString(),
              },
            ],
          );
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
      setStreamingContent(null);
      setWsConnected(false);
      setToolActivities([]);
    };
  }, [conversationId, queryClient]);

  // â”€â”€ Auto-scroll to bottom â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Fire pendingMessage once conversation + WebSocket are both ready
  useEffect(() => {
    if (!pendingMessage || !conversationId) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const msg = pendingMessage;
    setPendingMessage(null);
    wsRef.current.send(JSON.stringify({ type: 'human', content: msg }));
    queryClient.setQueryData<Message[]>(
      ['messages', conversationId],
      (prev) => [
        ...(prev ?? []),
        {
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          role: 'user',
          content: msg,
          agent_type: null,
          model_name: null,
          cited_chunk_ids: [],
          tool_calls: null,
          tool_results: null,
          created_at: new Date().toISOString(),
        },
      ],
    );
  }, [pendingMessage, conversationId, wsConnected, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, toolActivities]);

  // â”€â”€ Send message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleSend = useCallback(
    (content: string) => {
      if (!conversationId) {
        // No conversation yet — stash the text then create the conversation
        setPendingMessage(content);
        createConvMutation.mutate();
        return;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "human", content, voice: voiceModeRef.current }),
        );

        // Optimistically add user message to the list
        const optimistic: Message = {
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          role: "user",
          content,
          agent_type: null,
          model_name: null,
          cited_chunk_ids: [],
          tool_calls: null,
          tool_results: null,
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
  handleSendRef.current = handleSend;

  return (
    <div className="flex h-full gap-4">
      {/* â”€â”€ Conversation sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
            <ConversationItem
              key={c.id}
              id={c.id}
              title={c.title}
              isActive={c.id === conversationId}
              onClick={() => navigate(`/chat/${c.id}`)}
              onRename={(id, newTitle) => renameMutation.mutate({ id, title: newTitle })}
              onArchive={(id) => archiveMutation.mutate(id)}
            />
          ))}
        </div>
      </aside>

      {/* â”€â”€ Message thread â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
            {voiceEnabled && (
              <button
                onClick={toggleVoiceMode}
                className={cn(
                  "ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                  voiceMode
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-accent",
                )}
                title={voiceMode ? "Exit voice conversation (Esc)" : "Start a hands-free voice conversation"}
              >
                <AudioLines className="h-3.5 w-3.5" />
                {voiceMode ? "End voice chat" : "Voice chat"}
              </button>
            )}
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

          {/* Approvals raised in this conversation — act on them without leaving chat */}
          {chatApprovals.length > 0 && !streamingContent && (
            <div className="ml-11 max-w-[75%] space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                Waiting for your approval
              </p>
              {chatApprovals.map((intent) => (
                <ApprovalCard
                  key={intent.id}
                  intent={intent}
                  compact
                  onResolve={(approved, reason) =>
                    resolveChatApproval(intent.id, approved, reason)
                  }
                />
              ))}
            </div>
          )}

          {/* Live tool activity indicator (shown while no streaming content yet) */}
          {toolActivities.length > 0 && !streamingContent && (
            <div className="flex flex-row gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <ToolActivityStrip activities={toolActivities} />
            </div>
          )}

          {/* Streaming token buffer */}
          {streamingContent && (
            <MessageBubble
              message={{
                id: "streaming",
                conversation_id: conversationId ?? "",
                role: "assistant",
                content: streamingContent,
                agent_type: null,
                model_name: null,
                cited_chunk_ids: [],
                tool_calls: null,
                tool_results: null,
                created_at: new Date().toISOString(),
              }}
            />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Voice conversation banner */}
        {voiceMode && (
          <div className="mb-2 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            {voicePhase === "listening" && (
              <>
                <Mic className="h-4 w-4 shrink-0 animate-pulse text-red-500" />
                <span className="flex-1">Listening — just talk; pause and I'll answer.</span>
              </>
            )}
            {voicePhase === "transcribing" && (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                <span className="flex-1">Got it…</span>
              </>
            )}
            {voicePhase === "thinking" && (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                <span className="flex-1">Thinking…</span>
              </>
            )}
            {voicePhase === "speaking" && (
              <>
                <Volume2 className="h-4 w-4 shrink-0 text-primary" />
                <span className="flex-1">Speaking…</span>
                <button
                  onClick={interruptSpeech}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  Interrupt
                </button>
              </>
            )}
            {voiceError && (
              <span className="text-xs text-destructive">{voiceError}</span>
            )}
            <button
              onClick={exitVoiceMode}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Exit voice conversation (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Reference-file attachments (not part of the Knowledge Base) */}
        {conversationId && <AttachmentBar conversationId={conversationId} />}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          disabled={!conversationId && createConvMutation.isPending}
          voiceEnabled={voiceEnabled}
          placeholder={
            conversationId
              ? "Message Little Gerry…"
              : "Start typing to create a new conversation…"
          }
        />
      </div>

      {pendingDelete && (
        <ConfirmDeleteModal
          title={pendingDelete.title}
          busy={deletingDoc}
          onConfirm={async () => {
            setDeletingDoc(true);
            try {
              await deleteDocument(pendingDelete.document_id);
              queryClient.invalidateQueries({ queryKey: ["documents"] });
            } finally {
              setDeletingDoc(false);
              setPendingDelete(null);
            }
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
