/**
 * SentenceSpeaker — sentence-streamed text-to-speech.
 *
 * Feed it LLM tokens as they stream in; it cuts complete sentences off the
 * front of the buffer, synthesizes each one immediately (requests run in
 * parallel), and plays the audio clips back in order. The first sentence is
 * audible while the rest of the reply is still being generated — instead of
 * waiting for the full reply plus one big TTS request.
 */
import { speakText } from "@/api/voice";

const MIN_CHUNK = 40; // don't synthesize tiny fragments ("Sure." alone sounds choppy)
const MAX_CHUNK = 400; // force a cut if no sentence boundary shows up (lists, etc.)

export class SentenceSpeaker {
  private buffer = "";
  private queue: Promise<Blob | null>[] = [];
  private playing = false;
  private cancelled = false;
  private finished = false;
  private doneFired = false;
  private startedSpeaking = false;
  private audio: HTMLAudioElement | null = null;

  constructor(
    private opts: {
      /** Fired once, when the first clip actually starts playing. */
      onStart?: () => void;
      /** Fired once, when everything queued has finished playing. */
      onAllDone?: () => void;
    } = {},
  ) {}

  /** Append streamed text; complete sentences are synthesized immediately. */
  feed(text: string): void {
    if (this.cancelled) return;
    this.buffer += text;
    this.extract(false);
  }

  /** The reply is complete — flush whatever remains in the buffer. */
  finish(): void {
    if (this.cancelled) return;
    this.finished = true;
    this.extract(true);
    this.maybeDone();
  }

  /** Stop playback and drop everything queued (barge-in / navigation). */
  cancel(): void {
    this.cancelled = true;
    this.queue = [];
    this.buffer = "";
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
  }

  get spokeAnything(): boolean {
    return this.startedSpeaking;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private extract(flush: boolean): void {
    for (;;) {
      const cut = this.findCut();
      if (cut === -1) break;
      const chunk = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (chunk) this.enqueue(chunk);
    }
    if (flush) {
      const rest = this.buffer.trim();
      this.buffer = "";
      if (rest) this.enqueue(rest);
    }
  }

  /** Index to cut at, or -1 if no complete-enough sentence is buffered yet. */
  private findCut(): number {
    // Sentence terminator (optionally followed by a closing quote/bracket)
    // then whitespace. Decimals like "1,200.50" never match (no whitespace).
    const re = /[.!?…]+[)"'\u201d\u2019]*\s/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buffer)) !== null) {
      const end = m.index + m[0].length;
      if (end >= MIN_CHUNK) return end;
    }
    const nl = this.buffer.indexOf("\n\n");
    if (nl !== -1 && nl >= MIN_CHUNK) return nl + 2;
    if (this.buffer.length > MAX_CHUNK) {
      const sp = this.buffer.lastIndexOf(" ", MAX_CHUNK);
      return sp > MIN_CHUNK ? sp + 1 : MAX_CHUNK;
    }
    return -1;
  }

  private enqueue(chunk: string): void {
    // Kick the TTS request off immediately; playback consumes in order.
    this.queue.push(speakText(chunk).catch(() => null));
    void this.playLoop();
  }

  private async playLoop(): Promise<void> {
    if (this.playing || this.cancelled) return;
    this.playing = true;
    while (this.queue.length > 0 && !this.cancelled) {
      const blob = await this.queue[0];
      if (this.cancelled) break;
      this.queue.shift();
      if (!blob) continue; // a failed chunk never blocks the rest
      if (!this.startedSpeaking) {
        this.startedSpeaking = true;
        this.opts.onStart?.();
      }
      await this.playBlob(blob);
    }
    this.playing = false;
    this.maybeDone();
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audio = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      void audio.play().catch(done);
    });
  }

  private maybeDone(): void {
    if (this.cancelled || this.doneFired) return;
    if (this.finished && !this.playing && this.queue.length === 0 && !this.buffer.trim()) {
      this.doneFired = true;
      this.opts.onAllDone?.();
    }
  }
}
