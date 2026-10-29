/**
 * The phone's home: Gerry, by voice. One big button to talk, what was said
 * underneath, a small box to type instead. Everything else in the app is a
 * tap away behind the menu.
 *
 * The conversation is the day's voice thread — found if there is one from
 * today, started if not — so a morning's thoughts and an afternoon's
 * questions sit together, and tomorrow starts clean.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Loader2, Mic, Plus, Square } from "lucide-react";

import { createConversation, listConversations } from "@/api/chat";
import { getSettings } from "@/api/settings";
import { ConversationPane } from "@/components/chat/ConversationPane";
import { cn } from "@/lib/utils";
import { useVoiceAssistantStore } from "@/stores/voiceAssistantStore";
import type { Conversation } from "@/types/chat";

const PICK_KEY = "lg.phone.voiceConversation";

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

function todayTitle(): string {
  return `Gerry — ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`;
}

export function MobileGerryPage() {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(PICK_KEY);
    } catch {
      return null;
    }
  });

  const { data: appSettings } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 60_000 });
  const voiceEnabled = appSettings?.google_key_set ?? false;

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
  });

  const create = useMutation({
    mutationFn: () => createConversation({ kind: "voice", title: todayTitle() }),
    onSuccess: (conv: Conversation) => {
      remember(conv.id);
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const remember = useCallback((id: string) => {
    setPicked(id);
    try {
      sessionStorage.setItem(PICK_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  // Today's voice thread: the remembered one if it is still today's, else the
  // newest from today, else a new one.
  const current = useMemo(() => {
    const voice = conversations.filter((c) => (c.kind ?? "general") === "voice" && !c.is_archived);
    const remembered = picked ? voice.find((c) => c.id === picked) : undefined;
    if (remembered && isToday(remembered.updated_at)) return remembered;
    return voice.find((c) => isToday(c.updated_at)) ?? null;
  }, [conversations, picked]);

  useEffect(() => {
    if (isLoading || current || create.isPending || create.isError) return;
    create.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, current]);

  useEffect(() => {
    if (current && current.id !== picked) remember(current.id);
  }, [current, picked, remember]);

  const conversationId = current?.id ?? null;

  const active = useVoiceAssistantStore((s) => s.active);
  const phase = useVoiceAssistantStore((s) => s.phase);
  const voiceError = useVoiceAssistantStore((s) => s.error);
  const requestToggle = useVoiceAssistantStore((s) => s.requestToggle);

  const status = !voiceEnabled
    ? "Voice needs a Google key — ask your administrator. You can still type."
    : !active
      ? "Tap to talk"
      : phase === "listening"
        ? "Listening — pause and I'll answer"
        : phase === "transcribing"
          ? "Got it…"
          : phase === "speaking"
            ? "Speaking — tap to interrupt"
            : "Thinking…";

  return (
    <div className="-m-3 flex h-full flex-col" style={{ height: "calc(100% + 1.5rem)" }}>
      <div className="flex items-center justify-between px-3 pt-2">
        <p className="truncate text-xs text-muted-foreground">{current?.title ?? todayTitle()}</p>
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground active:bg-accent disabled:opacity-50"
          title="Start a fresh conversation"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      <ConversationPane
        conversationId={conversationId}
        compact
        voiceHost
        placeholder="Or type to Gerry…"
        emptyHint="Say hello, ask about your day, or tell me something to note."
        className="min-h-0 flex-1"
      />

      <div
        className="flex flex-col items-center gap-2 border-t bg-card px-4 pb-3 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
      >
        <button
          type="button"
          onClick={() => requestToggle()}
          disabled={!conversationId || !voiceEnabled}
          aria-label={active ? "Stop talking with Gerry" : "Talk with Gerry"}
          aria-pressed={active}
          className={cn(
            "relative flex h-20 w-20 items-center justify-center rounded-full shadow-lg transition-colors disabled:opacity-40",
            active ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground active:bg-primary/90",
          )}
        >
          {active && phase === "listening" && (
            <span className="absolute inset-0 animate-ping rounded-full bg-destructive/40" />
          )}
          {!conversationId ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : active ? (
            phase === "speaking" ? (
              <AudioLines className="h-8 w-8" />
            ) : (
              <Square className="h-7 w-7" />
            )
          ) : (
            <Mic className="h-8 w-8" />
          )}
        </button>
        <p className={cn("text-center text-xs", voiceError ? "text-destructive" : "text-muted-foreground")}>
          {voiceError ?? status}
        </p>
      </div>
    </div>
  );
}

export default MobileGerryPage;
