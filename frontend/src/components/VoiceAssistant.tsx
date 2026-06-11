/**
 * VoiceAssistant — a persistent "Talk with Little Gerry" hot button.
 *
 * Floats in the bottom-right corner on every page (except Chat, which has its
 * own in-page voice toggle). Clicking it starts a hands-free voice session in a
 * fresh conversation: speak, pause, Gerry answers out loud, then listens again.
 * The conversation appears in the regular chat history so anything Gerry does
 * (files, tasks, …) is reviewable afterwards.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Loader2, MessageSquare, Mic, Volume2, X } from "lucide-react";
import { createConversation } from "@/api/chat";
import { getSettings } from "@/api/settings";
import { speakText } from "@/api/voice";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "ws://127.0.0.1:8000";

export function VoiceAssistant() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: appSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
  });
  const voiceEnabled = appSettings?.google_key_set ?? false;

  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const [starting, setStarting] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamBufferRef = useRef("");
  const pendingRef = useRef<string | null>(null);
  const sendRef = useRef<(text: string) => void>(() => {});

  const { status: voiceStatus, start: voiceStart, stop: voiceStop } = useVoiceConversation({
    onTranscript: (text) => {
      setError(null);
      sendRef.current(text);
    },
    onError: (message) => {
      setError(message);
      if (message.startsWith("Microphone")) deactivateRef.current();
    },
  });

  const playReply = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        if (activeRef.current) void voiceStart();
        return;
      }
      try {
        const blob = await speakText(text);
        audioRef.current?.pause();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        setSpeaking(true);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setSpeaking(false);
          if (activeRef.current) void voiceStart(); // loop: listen for the next turn
        };
        await audio.play();
      } catch {
        setSpeaking(false);
        if (activeRef.current) void voiceStart();
      }
    },
    [voiceStart],
  );

  const openSocket = useCallback(
    (convId: string) => {
      const token = useAuthStore.getState().accessToken;
      const wsUrl = token
        ? `${WS_BASE}/ws/chat/${convId}?token=${encodeURIComponent(token)}`
        : `${WS_BASE}/ws/chat/${convId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Flush an utterance that arrived before the socket finished connecting
        if (pendingRef.current) {
          ws.send(JSON.stringify({ type: "human", content: pendingRef.current }));
          pendingRef.current = null;
        }
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            content?: string;
            detail?: string;
          };
          if (msg.type === "token" && msg.content) {
            streamBufferRef.current += msg.content;
          } else if (msg.type === "done") {
            const finalText = streamBufferRef.current;
            streamBufferRef.current = "";
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            queryClient.invalidateQueries({ queryKey: ["messages", convId] });
            queryClient.invalidateQueries({ queryKey: ["generated-files"] });
            if (activeRef.current) void playReply(finalText);
          } else if (msg.type === "error") {
            streamBufferRef.current = "";
            setError(msg.detail ?? "Something went wrong — try again.");
            if (activeRef.current) void voiceStart(); // don't strand the conversation
          }
        } catch {
          // ignore malformed frames
        }
      };
    },
    [playReply, queryClient, voiceStart],
  );

  const sendUtterance = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "human", content: text }));
    } else {
      pendingRef.current = text; // flushed by ws.onopen
    }
  }, []);
  sendRef.current = sendUtterance;

  const deactivate = useCallback(() => {
    setActive(false);
    activeRef.current = false;
    setSpeaking(false);
    setError(null);
    voiceStop();
    audioRef.current?.pause();
    wsRef.current?.close();
    wsRef.current = null;
    streamBufferRef.current = "";
    pendingRef.current = null;
  }, [voiceStop]);
  const deactivateRef = useRef(deactivate);
  deactivateRef.current = deactivate;

  const activate = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const conv = await createConversation({ title: "Voice session" });
      setConversationId(conv.id);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      openSocket(conv.id);
      setActive(true);
      activeRef.current = true;
      void voiceStart();
    } catch {
      setError("Couldn't start a voice session — check that the app is running.");
    } finally {
      setStarting(false);
    }
  }, [openSocket, queryClient, voiceStart]);

  // Interrupt Gerry mid-sentence: stop playback and listen right away
  const interrupt = useCallback(() => {
    audioRef.current?.pause();
    setSpeaking(false);
    if (activeRef.current) void voiceStart();
  }, [voiceStart]);

  // Esc ends the session
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") deactivateRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // Full cleanup on unmount
  useEffect(
    () => () => {
      deactivateRef.current();
    },
    [],
  );

  if (!voiceEnabled) return null;

  const onChatPage = location.pathname.startsWith("/chat");
  // Chat has its own in-page voice toggle — hide the launcher there, but keep
  // the panel visible if a session is already running.
  if (!active && onChatPage) return null;

  if (!active) {
    return (
      <button
        onClick={() => void activate()}
        disabled={starting}
        title="Talk with Little Gerry"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <AudioLines className="h-5 w-5" />}
        <span className="hidden sm:inline">Talk with Little Gerry</span>
      </button>
    );
  }

  const phase =
    voiceStatus === "listening"
      ? "listening"
      : voiceStatus === "transcribing"
        ? "transcribing"
        : speaking
          ? "speaking"
          : "thinking";

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border bg-background p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <AudioLines className="h-4 w-4 text-primary" />
          Little Gerry
        </div>
        <button
          onClick={deactivate}
          title="End voice session (Esc)"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2.5 text-sm">
        {phase === "listening" && (
          <>
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/10">
              <Mic className="h-4 w-4 text-red-500" />
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500/20" />
            </span>
            <span>Listening — just talk; pause and I'll answer.</span>
          </>
        )}
        {phase === "transcribing" && (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Got it…</span>
          </>
        )}
        {phase === "thinking" && (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Thinking…</span>
          </>
        )}
        {phase === "speaking" && (
          <>
            <Volume2 className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1 text-muted-foreground">Speaking…</span>
            <button
              onClick={interrupt}
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent transition-colors"
            >
              Interrupt
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {conversationId && (
        <button
          onClick={() => navigate(`/chat/${conversationId}`)}
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5",
            "text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          View conversation
        </button>
      )}
    </div>
  );
}
