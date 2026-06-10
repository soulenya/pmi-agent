/**
 * useVoiceConversation — hands-free listening segment for Voice Conversation mode.
 *
 * One "segment" = open the mic, wait for the user to speak, detect ~1.5 s of
 * silence after speech, stop, transcribe, and hand the text to onTranscript.
 * The mic is fully released between segments (no echo while Gerry replies);
 * the caller starts the next segment when the spoken reply finishes.
 */
import { useCallback, useRef, useState } from "react";
import { transcribeAudio } from "@/api/voice";

export type VoiceListenStatus = "idle" | "listening" | "transcribing";

interface Options {
  /** Called with the recognised text once the user finishes speaking. */
  onTranscript: (text: string) => void;
  /** Called on mic/transcription failures (listening resumes automatically when sensible). */
  onError?: (message: string) => void;
}

const SILENCE_MS = 1500; // pause length that ends an utterance
const MAX_SEGMENT_MS = 55_000; // Google STT sync limit is 60 s of audio
const SPEECH_RMS = 0.02; // volume threshold counting as speech

export function useVoiceConversation({ onTranscript, onError }: Options) {
  const [status, setStatus] = useState<VoiceListenStatus>("idle");

  const sessionRef = useRef(0); // increments to invalidate stale segments
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const releaseHardware = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    releaseHardware();
    setStatus("idle");
  }, [releaseHardware]);

  const start = useCallback(async () => {
    const session = ++sessionRef.current;
    releaseHardware();
    setStatus("listening");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      if (session === sessionRef.current) {
        setStatus("idle");
        onErrorRef.current?.("Microphone unavailable — check browser permissions.");
      }
      return;
    }
    if (session !== sessionRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    let spoke = false;
    let lastVoiceAt = 0;
    const startedAt = performance.now();
    let outcome: "transcribe" | "restart" | null = null;

    recorder.onstop = async () => {
      if (session !== sessionRef.current) return;
      releaseHardware();
      if (outcome === "restart") {
        void start(); // silent segment rollover — keep listening
        return;
      }
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size === 0) {
        void start();
        return;
      }
      setStatus("transcribing");
      try {
        const text = (await transcribeAudio(blob)).trim();
        if (session !== sessionRef.current) return;
        if (text) {
          setStatus("idle"); // mic stays released while Gerry thinks/speaks
          onTranscriptRef.current(text);
        } else {
          void start(); // heard noise but no words — keep listening
        }
      } catch {
        if (session !== sessionRef.current) return;
        onErrorRef.current?.("Transcription failed — check the voice settings.");
        void start();
      }
    };

    const tick = () => {
      if (session !== sessionRef.current) return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();

      if (rms > SPEECH_RMS) {
        spoke = true;
        lastVoiceAt = now;
      }

      const tooLong = now - startedAt > MAX_SEGMENT_MS;
      if (spoke && (now - lastVoiceAt > SILENCE_MS || tooLong)) {
        outcome = "transcribe";
        recorder.stop();
        return;
      }
      if (!spoke && tooLong) {
        outcome = "restart"; // nothing said yet — roll the segment to stay under the STT limit
        recorder.stop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    recorder.start();
    rafRef.current = requestAnimationFrame(tick);
  }, [releaseHardware]);

  return { status, start, stop };
}
