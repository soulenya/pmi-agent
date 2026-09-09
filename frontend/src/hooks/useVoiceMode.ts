/**
 * Voice as a mode of any conversation: listen, send, speak the reply, listen
 * again. The host owns the socket; it calls onToken / onDone / onError with
 * what arrives and sends `voice: voiceMode` with what the user says.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { speakText } from "@/api/voice";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { SentenceSpeaker } from "@/lib/sentenceSpeaker";

export type VoicePhase = "listening" | "transcribing" | "thinking" | "speaking";

export interface UseVoiceModeOptions {
  /** What the user said, ready to send. */
  onTranscript: (text: string) => void;
  /** Read replies aloud even outside voice mode (Settings > Voice). */
  speakReplies?: boolean;
}

export function useVoiceMode({ onTranscript, speakReplies = false }: UseVoiceModeOptions) {
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  const speakRepliesRef = useRef(speakReplies);
  useEffect(() => {
    speakRepliesRef.current = speakReplies;
  }, [speakReplies]);

  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speakerRef = useRef<SentenceSpeaker | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const { status, start, stop } = useVoiceConversation({
    onTranscript: (text) => {
      setError(null);
      onTranscriptRef.current(text);
    },
    onError: (message) => {
      setError(message);
      if (message.startsWith("Microphone")) setVoiceMode(false);
    },
  });

  const stopAudio = useCallback(() => {
    speakerRef.current?.cancel();
    speakerRef.current = null;
    audioRef.current?.pause();
    setSpeaking(false);
  }, []);

  const exit = useCallback(() => {
    setVoiceMode(false);
    setError(null);
    stop();
    stopAudio();
  }, [stop, stopAudio]);

  const toggle = useCallback(() => {
    if (voiceModeRef.current) {
      exit();
    } else {
      setError(null);
      setVoiceMode(true);
      void start();
    }
  }, [exit, start]);

  /** Barge in: stop Gerry and listen right away. */
  const interrupt = useCallback(() => {
    stopAudio();
    if (voiceModeRef.current) void start();
  }, [stopAudio, start]);

  useEffect(() => {
    if (!voiceMode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && exit();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voiceMode, exit]);

  // Release the mic and the speaker when the host unmounts.
  useEffect(
    () => () => {
      stop();
      speakerRef.current?.cancel();
      audioRef.current?.pause();
    },
    [stop],
  );

  const playWhole = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const loop = voiceModeRef.current;
      try {
        const blob = await speakText(text);
        audioRef.current?.pause();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        if (loop) setSpeaking(true);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (loop) {
            setSpeaking(false);
            if (voiceModeRef.current) void start();
          }
        };
        await audio.play();
      } catch {
        if (loop) {
          setSpeaking(false);
          if (voiceModeRef.current) void start();
        }
      }
    },
    [start],
  );

  /** Feed a streamed token; the first sentence plays while the rest arrives. */
  const onToken = useCallback(
    (text: string) => {
      if (!voiceModeRef.current && !speakRepliesRef.current) return;
      if (!speakerRef.current) {
        speakerRef.current = new SentenceSpeaker({
          onStart: () => {
            if (voiceModeRef.current) setSpeaking(true);
          },
          onAllDone: () => {
            speakerRef.current = null;
            if (voiceModeRef.current) {
              setSpeaking(false);
              void start();
            }
          },
        });
      }
      speakerRef.current.feed(text);
    },
    [start],
  );

  /** The turn ended; `finalText` covers replies that arrived without tokens. */
  const onDone = useCallback(
    (finalText: string) => {
      if (speakerRef.current) speakerRef.current.finish();
      else if ((voiceModeRef.current || speakRepliesRef.current) && finalText) void playWhole(finalText);
      else if (voiceModeRef.current) void start();
    },
    [playWhole, start],
  );

  /** The turn failed; keep listening so the conversation is not stranded. */
  const onError = useCallback(() => {
    speakerRef.current?.cancel();
    speakerRef.current = null;
    if (voiceModeRef.current) void start();
  }, [start]);

  const phase: VoicePhase | null = !voiceMode
    ? null
    : status === "listening"
      ? "listening"
      : status === "transcribing"
        ? "transcribing"
        : speaking
          ? "speaking"
          : "thinking";

  return { voiceMode, voiceModeRef, phase, error, toggle, exit, interrupt, onToken, onDone, onError };
}
