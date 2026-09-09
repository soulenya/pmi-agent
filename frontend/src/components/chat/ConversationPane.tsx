/**
 * One conversation with Gerry: the messages, the stream, the tool activity and
 * the input box. The assistant panel, the project's Chat tab and anything else
 * that wants to talk to Gerry in place renders this and supplies the chrome.
 *
 * The socket is always the local one. A hub project's conversation is kept on
 * the hub but answered from here, where the knowledge base and the Google
 * account live, so it is pulled before the first turn and pushed after each.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, RotateCcw, Send, Square, Wrench } from "lucide-react";

import { listMessages, stopTurn } from "@/api/chat";
import { grantDriveEdit } from "@/api/google";
import { syncHubConversation } from "@/api/hub";
import { getSettings } from "@/api/settings";
import type { Source } from "@/api/tasks";
import { MessageBubble, type ArtifactLink } from "@/components/chat/MessageBubble";
import { VoiceBanner } from "@/components/chat/VoiceBanner";
import ConfirmDriveEditModal, { type DriveEditRequest } from "@/components/ConfirmDriveEditModal";
import { ModelSwitcher } from "@/components/ModelSwitcher";
import { useResizableTextarea } from "@/hooks/useResizableTextarea";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import { modLabel } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useCanvasSinkStore, type TextDropKind } from "@/stores/canvasSinkStore";
import { useChatInputSizeStore } from "@/stores/chatInputSizeStore";
import { useToastStore } from "@/stores/toastStore";
import { useVoiceAssistantStore } from "@/stores/voiceAssistantStore";
import type { Message, WSToolStatusFrame } from "@/types/chat";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "ws://127.0.0.1:8000";

interface ToolActivity {
  tool_name: string;
  status: "running" | "done";
  label: string;
}

const CANVAS_KINDS: { kind: TextDropKind; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "sticky", label: "Sticky note" },
  { kind: "shape", label: "Shape" },
];

function ContextMenu({
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
  onAddToCanvas: (kind: TextDropKind) => void;
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

  const items: { label: string; hint?: string; disabled?: boolean; onClick: () => void }[] = [
    { label: "Copy", hint: modLabel("C"), disabled: !text, onClick: onCopy },
  ];
  if (inInput) {
    items.push({ label: "Paste", hint: modLabel("V"), onClick: onPaste });
  }
  const canvasReady = Boolean(text) && canDropOnCanvas;
  for (const { kind, label } of CANVAS_KINDS) {
    items.push({ label, disabled: !canvasReady, onClick: () => onAddToCanvas(kind) });
  }

  return (
    <div
      ref={ref}
      style={{
        left: Math.min(x, window.innerWidth - 216),
        top: Math.min(y, window.innerHeight - 16 - (items.length + 1) * 28),
      }}
      className="fixed z-[60] w-52 rounded-md border border-border bg-card py-1 shadow-md"
    >
      {items.map((item, i) => (
        <div key={item.label}>
          {i === items.length - CANVAS_KINDS.length && (
            <div className="mt-1 border-t px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {canDropOnCanvas ? "Add to the canvas as" : "Add to the canvas — none open"}
            </div>
          )}
          <button
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
        </div>
      ))}
    </div>
  );
}

export interface ConversationPaneProps {
  conversationId: string | null;
  /** Where the conversation is kept. A hub one is reconciled around each turn. */
  source?: Source;
  /** Prepended to what the user types, so Gerry knows where they are. Not shown. */
  contextPrefix?: string;
  /** A queued question ("Ask Gerry about this"), sent once the socket is open. */
  seed?: string | null;
  onSeedSent?: () => void;
  /** Reported so the host can show a spinner in its own header. */
  onConnectingChange?: (connecting: boolean) => void;
  compact?: boolean;
  placeholder?: string;
  emptyHint?: string;
  className?: string;
  /** The pane the "Talk with Little Gerry" buttons flip into voice mode. */
  voiceHost?: boolean;
}

export function ConversationPane({
  conversationId,
  source = "local",
  contextPrefix,
  seed,
  onSeedSent,
  onConnectingChange,
  compact = true,
  placeholder = "Message Little Gerry… (Enter to send)",
  emptyHint = "Ask me anything about your work, documents, or tasks.",
  className,
  voiceHost = false,
}: ConversationPaneProps) {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const onHub = source === "hub";

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [turnArtifacts, setTurnArtifacts] = useState<ArtifactLink[]>([]);
  const [pendingDriveEdit, setPendingDriveEdit] = useState<DriveEditRequest | null>(null);
  const [grantingDriveEdit, setGrantingDriveEdit] = useState(false);
  const [driveEditError, setDriveEditError] = useState<string | null>(null);
  const [turnStuck, setTurnStuck] = useState(false);
  const [stopping, setStopping] = useState(false);
  // The conversation whose socket is OPEN, so a seed fires exactly once.
  const [wsReadyConvId, setWsReadyConvId] = useState<string | null>(null);
  // A hub conversation is read only after its copy here is fresh.
  const [synced, setSynced] = useState(!onHub);
  const [syncError, setSyncError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const streamBufferRef = useRef("");

  // ── Voice ────────────────────────────────────────────────────────────────────────────
  const { data: appSettings } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 60_000 });
  const voiceEnabled = appSettings?.google_key_set ?? false;
  const sendRef = useRef<(text: string) => void>(() => {});
  const voice = useVoiceMode({
    onTranscript: (text) => sendRef.current(text),
    speakReplies: (appSettings?.voice_speak_replies ?? false) && voiceEnabled,
  });
  const setVoiceActive = useVoiceAssistantStore((s) => s.setActive);
  const setVoiceSpeaking = useVoiceAssistantStore((s) => s.setSpeaking);
  const toggleRequests = useVoiceAssistantStore((s) => s.toggleRequests);
  const seenToggle = useRef(toggleRequests);
  useEffect(() => {
    if (!voiceHost) return;
    setVoiceActive(voice.voiceMode);
    setVoiceSpeaking(voice.phase === "speaking");
  }, [voiceHost, voice.voiceMode, voice.phase, setVoiceActive, setVoiceSpeaking]);
  useEffect(() => {
    if (!voiceHost || toggleRequests === seenToggle.current) return;
    seenToggle.current = toggleRequests;
    if (voiceEnabled && conversationId) voice.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleRequests, voiceHost]);
  useEffect(() => {
    if (voice.voiceMode) voice.exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    onConnectingChange?.(isConnecting);
  }, [isConnecting, onConnectingChange]);

  const turnRunning =
    streamingContent !== null ||
    (messages.length > 0 && messages[messages.length - 1].role === "user");

  const handleStop = useCallback(async () => {
    if (!conversationId) return;
    setStopping(true);
    try {
      await stopTurn(conversationId);
    } catch {
      /* the turn may still land; leave the UI as it is */
    } finally {
      setStopping(false);
    }
  }, [conversationId]);

  useEffect(() => {
    const waiting =
      messages.length > 0 &&
      messages[messages.length - 1].role === "user" &&
      streamingContent === null;
    // A tool still running on a live socket (a long vision read, a Drive scan)
    // is not a lost turn; offering Resend there starts the same work twice.
    const working =
      wsReadyConvId === conversationId && toolActivities.some((a) => a.status === "running");
    if (!waiting || working) {
      setTurnStuck(false);
      return;
    }
    const t = window.setTimeout(() => setTurnStuck(true), 45_000);
    return () => window.clearTimeout(t);
  }, [messages, streamingContent, toolActivities, wsReadyConvId, conversationId]);

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
  const [menu, setMenu] = useState<{ x: number; y: number; text: string; inInput: boolean } | null>(null);
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

  // ── Hub: pull before the first read ────────────────────────────────────────
  useEffect(() => {
    if (!onHub || !conversationId) {
      setSynced(true);
      setSyncError(null);
      return;
    }
    let cancelled = false;
    setSynced(false);
    setSyncError(null);
    syncHubConversation(conversationId)
      .then(() => {
        if (!cancelled) setSynced(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSyncError("Couldn't reach the hub, so this conversation may be out of date.");
        setSynced(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, onHub]);

  // ── Messages ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setMessages([]);
    setStreamingContent(null);
    setToolActivities([]);
    setTurnArtifacts([]);
  }, [conversationId]);

  // The page prefix is for Gerry, not for the person who typed the question.
  const loadMessages = useCallback(
    (convId: string) =>
      listMessages(convId)
        .then((list) =>
          setMessages(
            list.map((m) =>
              m.role === "user"
                ? { ...m, content: m.content.replace(/^\[Context:[^\]]*\]\s*/, "") }
                : m,
            ),
          ),
        )
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    if (!conversationId || !synced) return;
    void loadMessages(conversationId);
  }, [conversationId, synced, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolActivities, streamingContent]);

  // ── Socket ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!conversationId || !synced || !token) return;
    const convId = conversationId;
    const ws = new WebSocket(`${WS_BASE}/ws/chat/${convId}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    setIsConnecting(true);
    setWsReadyConvId(null);

    ws.onopen = () => {
      setIsConnecting(false);
      setWsReadyConvId(convId);
    };
    ws.onclose = () => {
      setIsConnecting(false);
      setWsReadyConvId(null);
      setToolActivities([]);
    };

    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data);
        if (frame.type === "token" && frame.content) {
          setStreamingContent((prev) => (prev ?? "") + frame.content);
          streamBufferRef.current += frame.content;
          voice.onToken(frame.content);
          setToolActivities([]);
          return;
        }
        if (frame.type === "tool_status") {
          const ts = frame as WSToolStatusFrame;
          setToolActivities((prev) => {
            const idx = [...prev].reverse().findIndex((a) => a.tool_name === ts.tool_name);
            const trueIdx = idx >= 0 ? prev.length - 1 - idx : -1;
            const next = { tool_name: ts.tool_name, status: ts.status, label: ts.label ?? ts.tool_name };
            if (trueIdx >= 0 && prev[trueIdx].status === "running") {
              const copy = [...prev];
              copy[trueIdx] = next;
              return copy;
            }
            return [...prev, next];
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
          const req = frame as DriveEditRequest;
          if (req.file_id) setPendingDriveEdit(req);
          return;
        }
        if (frame.type === "done") {
          const reload = () => loadMessages(convId);
          if (onHub) {
            // The answer has to reach the hub before the rest of the project can read it.
            void syncHubConversation(convId).catch(() => undefined).then(reload);
          } else {
            void reload();
          }
          qc.invalidateQueries({ queryKey: ["conversations"] });
          qc.invalidateQueries({ queryKey: ["approvals"] });
          setStreamingContent(null);
          setToolActivities([]);
          setTurnArtifacts([]);
          const finalText = streamBufferRef.current;
          streamBufferRef.current = "";
          voice.onDone(finalText);
          return;
        }
        if (frame.type === "error") {
          const detail = frame.detail ?? "An error occurred.";
          streamBufferRef.current = "";
          voice.onError();
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
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
    // The voice callbacks are stable; listing them would reopen the socket for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, synced, token, onHub, qc, loadMessages]);

  const send = useCallback(
    (text: string, shownAs: string = text) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !conversationId) return false;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          role: "user" as const,
          content: shownAs,
          agent_type: null,
          model_name: null,
          cited_chunk_ids: [],
          tool_calls: null,
          tool_results: null,
          created_at: new Date().toISOString(),
        },
      ]);
      ws.send(JSON.stringify({ type: "human", content: text, voice: voice.voiceModeRef.current }));
      return true;
    },
    [conversationId, voice.voiceModeRef],
  );

  // What the microphone heard goes the same way as what was typed.
  useEffect(() => {
    sendRef.current = (text) => {
      const full = contextPrefix ? `${contextPrefix}\n\n${text}` : text;
      send(full, text);
    };
  }, [send, contextPrefix]);

  // A seed is self-contained, so it goes without the page prefix.
  useEffect(() => {
    if (!seed || !conversationId || wsReadyConvId !== conversationId) return;
    if (send(seed)) onSeedSent?.();
  }, [seed, conversationId, wsReadyConvId, send, onSeedSent]);

  function sendTyped() {
    const text = inputText.trim();
    if (!text) return;
    const full = contextPrefix ? `${contextPrefix}\n\n${text}` : text;
    if (!send(full, text)) return;
    setInputText("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTyped();
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {syncError && (
        <p className="border-b bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          {syncError}
        </p>
      )}

      <div onContextMenu={openMenu} className="flex-1 space-y-2 overflow-y-auto px-2 py-2">
        {!conversationId && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No conversation open.
          </p>
        )}
        {conversationId && messages.length === 0 && !isConnecting && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">{emptyHint}</p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} compact={compact} />
        ))}
        {streamingContent !== null && (
          <MessageBubble
            message={{
              id: "__streaming__",
              conversation_id: conversationId ?? "",
              role: "assistant",
              content: streamingContent,
              agent_type: null,
              model_name: null,
              cited_chunk_ids: [],
              tool_calls: null,
              tool_results: turnArtifacts,
              created_at: new Date().toISOString(),
            }}
            compact={compact}
          />
        )}
        {toolActivities.map((a) => (
          <div key={a.tool_name} className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
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
        {turnStuck &&
          streamingContent === null &&
          messages.length > 0 &&
          messages[messages.length - 1].role === "user" && (
            <button
              onClick={() => {
                const last = [...messages].reverse().find((m) => m.role === "user");
                if (!last?.content) return;
                setToolActivities([]);
                setTurnStuck(false);
                send(last.content);
              }}
              className="ml-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Send the last message again"
            >
              <RotateCcw className="h-3 w-3" />
              No reply? Resend
            </button>
          )}
        <div ref={endRef} />
      </div>

      <div className="border-t p-2" onContextMenu={openMenu}>
        {voice.voiceMode && (
          <div className="mb-2">
            <VoiceBanner
              phase={voice.phase}
              error={voice.error}
              onInterrupt={voice.interrupt}
              onExit={voice.exit}
              compact={compact}
            />
          </div>
        )}
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
            placeholder={placeholder}
            rows={1}
            disabled={!conversationId}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {voiceEnabled && (
            <button
              onClick={voice.toggle}
              disabled={!conversationId}
              title={voice.voiceMode ? "End voice conversation (Esc)" : "Talk with Little Gerry"}
              aria-label={voice.voiceMode ? "End voice conversation" : "Talk with Little Gerry"}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-40",
                voice.voiceMode ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <AudioLines className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={sendTyped}
            disabled={!inputText.trim() || !conversationId}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* The model belongs to the conversation, so it is chosen here, not in the top bar. */}
        <div className="mt-1 flex justify-end">
          <ModelSwitcher direction="up" />
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          text={menu.text}
          inInput={menu.inInput}
          canDropOnCanvas={Boolean(dropOnCanvas)}
          onCopy={() => void copyText(menu.text)}
          onPaste={() => void pasteIntoInput()}
          onAddToCanvas={(kind) => dropOnCanvas?.(menu.text, kind)}
          onClose={() => setMenu(null)}
        />
      )}

      {pendingDriveEdit && (
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
      )}
    </div>
  );
}
