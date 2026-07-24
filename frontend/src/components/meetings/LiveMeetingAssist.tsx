/**
 * LiveMeetingAssist — the real-time meeting layer, mounted app-wide.
 *
 * Two surfaces driven by one poll of /meetings/live/state:
 *  1. Consent pop-down: slides down when a meeting is detected — the user
 *     chooses what help they want THIS meeting (nothing happens without it).
 *  2. Live panel: docked right (same family as the Gerry sidebar / briefing)
 *     with the rolling transcript and Gerry's whispered assist cards.
 *
 * Disclosure posture (NDA vs public answers) is enforced server-side by
 * construction; the toggles here only express the user's choice.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Mail,
  MessageCircleQuestion,
  Mic,
  Radio,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";
import {
  acceptLive,
  declineLive,
  dismissLive,
  getLiveDefaults,
  getLiveState,
  stopRecording,
  type LiveAssistOptions,
  type LiveCard,
  type LiveSegment,
  type LiveState,
} from "@/api/meetings";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

const POLL_MS = 3_000;

function Toggle({
  checked,
  onChange,
  label,
  hint,
  icon,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-primary"
      />
      <span className="flex items-start gap-1.5">
        {icon}
        <span>
          {label}
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
      </span>
    </label>
  );
}

export function LiveMeetingAssist() {
  const authed = useAuthStore((s) => s.isAuthenticated);
  const navigate = useNavigate();
  const [state, setState] = useState<LiveState>({ active: false });
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [cards, setCards] = useState<LiveCard[]>([]);
  const [options, setOptions] = useState<LiveAssistOptions>({
    transcript: true,
    jargon: true,
    answers: "off",
    thankyou: false,
  });
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  // Draggable panel position (top-left corner); null = default bottom-right.
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = window.localStorage.getItem("liveMeeting.panelPos");
      if (!raw) return null;
      const p = JSON.parse(raw) as { x: number; y: number };
      if (
        typeof p.x === "number" && typeof p.y === "number" &&
        p.x >= 0 && p.y >= 0 &&
        p.x < window.innerWidth - 80 && p.y < window.innerHeight - 48
      ) {
        return p;
      }
    } catch { /* fall through to default */ }
    return null;
  });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const lastSeg = useRef(-1);
  const lastCard = useRef(-1);
  const defaultsLoaded = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const clampPos = (x: number, y: number) => {
    const w = panelRef.current?.offsetWidth ?? 384;
    return {
      x: Math.min(Math.max(8, x), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - 56),
    };
  };

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return; // click, not drag (yet)
    d.moved = true;
    setPanelPos(clampPos(d.origX + dx, d.origY + dy));
  };

  const onHeaderPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved) {
      suppressClickRef.current = true; // a drag is not a collapse-click
      setPanelPos((p) => {
        try {
          if (p) window.localStorage.setItem("liveMeeting.panelPos", JSON.stringify(p));
        } catch { /* ignore */ }
        return p;
      });
    }
  };

  // One poll drives everything; incremental fetch by sequence number.
  useEffect(() => {
    if (!authed) return;
    let disposed = false;
    const tick = async () => {
      try {
        const s = await getLiveState(lastSeg.current, lastCard.current);
        if (disposed) return;
        if (!s.active) {
          if (state.active) {
            setSegments([]);
            setCards([]);
            lastSeg.current = -1;
            lastCard.current = -1;
          }
          setState({ active: false });
          return;
        }
        setState(s);
        if (s.segments?.length) {
          setSegments((prev) => [...prev, ...s.segments!]);
          lastSeg.current = s.segments[s.segments.length - 1].seq;
        }
        if (s.cards?.length) {
          setCards((prev) => [...prev, ...s.cards!]);
          lastCard.current = s.cards[s.cards.length - 1].seq;
        }
        if (s.consent === "pending" && !defaultsLoaded.current) {
          defaultsLoaded.current = true;
          try {
            setOptions(await getLiveDefaults());
          } catch {
            /* keep local defaults */
          }
        }
      } catch {
        /* backend briefly away — keep polling */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // Auto-scroll transcript.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [segments, cards]);

  if (!authed || !state.active) return null;

  // ── Consent pop-down ──────────────────────────────────────────────────
  if (state.consent === "pending") {
    const accept = async () => {
      setBusy(true);
      try {
        await acceptLive(options);
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]">
        <div className="w-full max-w-lg animate-in zoom-in-95 rounded-xl border bg-card p-4 shadow-2xl">
          <div className="mb-2 flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">
              Looks like a {state.platform ?? "video"} call is starting
              {state.party ? ` — ${state.party}` : ""}
            </p>
            <button
              onClick={() => void declineLive()}
              className="ml-auto text-muted-foreground hover:text-foreground"
              title="No thanks — just record per my auto-record setting"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            Want Gerry to follow along? Pick the help you want for this meeting.
            {state.nda_hint && <span className="block pt-1">{state.nda_hint}</span>}
          </p>
          <div className="space-y-0.5">
            <Toggle
              checked={options.transcript}
              onChange={(v) => setOptions((o) => ({ ...o, transcript: v }))}
              label="Live transcript & notes"
              icon={<Radio className="mt-0.5 h-3.5 w-3.5 text-primary" />}
            />
            <Toggle
              checked={options.jargon}
              onChange={(v) => setOptions((o) => ({ ...o, jargon: v }))}
              label="Decode jargon & acronyms in context"
              icon={<BookOpen className="mt-0.5 h-3.5 w-3.5 text-primary" />}
            />
            <Toggle
              checked={options.answers === "nda"}
              onChange={(v) => setOptions((o) => ({ ...o, answers: v ? "nda" : "off" }))}
              label="Suggest answers — UNDER NDA with the other party"
              hint="Gerry may draw on company knowledge and cites what she used."
              icon={<ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-500" />}
            />
            <Toggle
              checked={options.answers === "public"}
              onChange={(v) => setOptions((o) => ({ ...o, answers: v ? "public" : "off" }))}
              label="Suggest answers — NOT under NDA"
              hint="Public knowledge only; Gerry is given no company data at all."
              icon={<ShieldOff className="mt-0.5 h-3.5 w-3.5 text-amber-500" />}
            />
            <Toggle
              checked={options.thankyou}
              onChange={(v) => setOptions((o) => ({ ...o, thankyou: v }))}
              label="Draft a thank-you email afterward"
              hint="Lands in Email Drafts for your review — never auto-sent."
              icon={<Mail className="mt-0.5 h-3.5 w-3.5 text-primary" />}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => void accept()}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Follow along"}
            </button>
            <button
              onClick={() => void declineLive()}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              No thanks
            </button>
            <p className="ml-auto max-w-[45%] text-right text-[10px] leading-tight text-muted-foreground">
              You're responsible for any consent to record required where you are.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.consent === "declined") return null;

  // ── Live panel (accepted or ended) ────────────────────────────────────
  const ended = state.consent === "ended";
  return (
    <div
      ref={panelRef}
      style={panelPos ? { left: panelPos.x, top: panelPos.y, right: "auto", bottom: "auto" } : undefined}
      className={cn(
        "fixed bottom-4 right-4 z-40 flex w-96 flex-col overflow-hidden rounded-xl border bg-card shadow-xl",
        panelOpen ? "h-[70vh]" : "h-12",
      )}
    >
      <div
        className="flex shrink-0 cursor-grab touch-none items-center gap-2 border-b px-3 py-2.5 active:cursor-grabbing"
        title="Drag to move · click to collapse"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          setPanelOpen((v) => !v);
        }}
      >
        {ended ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
        )}
        <p className="text-sm font-semibold">
          {ended ? "Meeting wrapped up" : `Following the ${state.platform ?? "meeting"}`}
        </p>
        <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", !panelOpen && "rotate-180")} />
        {ended && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void dismissLive().then(() => setState({ active: false }));
            }}
            className="text-muted-foreground hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {panelOpen && (
        <>
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {segments.length === 0 && cards.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {state.last_error ?? "Listening — the transcript appears here (15–40 s behind live)."}
              </p>
            )}
            {[...segments.map((s) => ({ t: "seg" as const, seq: s.seq, s })),
              ...cards.map((c) => ({ t: "card" as const, seq: c.seq, c }))]
              .sort((a, b) => a.seq - b.seq)
              .map((item) =>
                item.t === "seg" ? (
                  <p key={`s${item.seq}`} className="text-xs leading-relaxed text-foreground/90">
                    {item.s.text}
                  </p>
                ) : (
                  <div
                    key={`c${item.seq}`}
                    className={cn(
                      "rounded-md border-l-2 bg-accent/50 px-2.5 py-1.5",
                      item.c.kind === "jargon" && "border-blue-400",
                      item.c.kind === "answer" && "border-emerald-400",
                      item.c.kind === "wrapup" && "border-primary",
                    )}
                  >
                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                      {item.c.kind === "jargon" && <BookOpen className="h-3 w-3" />}
                      {item.c.kind === "answer" && <MessageCircleQuestion className="h-3 w-3" />}
                      {item.c.kind === "wrapup" && <CheckCircle2 className="h-3 w-3" />}
                      {item.c.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.c.body}</p>
                    {item.c.route && (
                      <button
                        onClick={() => navigate(item.c.route!)}
                        className="mt-1 text-xs font-medium text-primary hover:underline"
                      >
                        Take me there →
                      </button>
                    )}
                  </div>
                ),
              )}
          </div>
          {!ended && (
            <div className="shrink-0 border-t p-2">
              <button
                onClick={() => void stopRecording()}
                className="w-full rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Stop now and process the note (otherwise it ends automatically when the call does)"
              >
                End &amp; process now
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
