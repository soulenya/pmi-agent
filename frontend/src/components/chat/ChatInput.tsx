import { useRef, useEffect, useState, type KeyboardEvent, type FormEvent } from "react";
import { Send, Mic, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcribeAudio } from "@/api/voice";
import { useResizableTextarea } from "@/hooks/useResizableTextarea";
import { useChatInputSizeStore } from "@/stores/chatInputSizeStore";

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Show the microphone button (Google voice key configured). */
  voiceEnabled?: boolean;
}

export function ChatInput({ onSend, disabled = false, placeholder, voiceEnabled = false }: Props) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const mainHeight = useChatInputSizeStore((s) => s.mainHeight);
  const setMainHeight = useChatInputSizeStore((s) => s.setMainHeight);
  const { ref, applyHeight, startResize } = useResizableTextarea({
    manualHeight: mainHeight,
    setManualHeight: setMainHeight,
    autoMax: 320,
    min: 44,
    max: 600,
  });

  // Stop any live recording when the component unmounts
  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const value = ref.current?.value.trim();
    if (!value || disabled) return;
    onSend(value);
    if (ref.current) {
      ref.current.value = "";
      applyHeight();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  async function startRecording() {
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size === 0) return;
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          if (text && ref.current) {
            // Insert into the draft — editable before sending
            const existing = ref.current.value.trim();
            ref.current.value = existing ? `${existing} ${text}` : text;
            ref.current.focus();
            applyHeight();
          } else if (!text) {
            setVoiceError("Didn't catch that — try again.");
          }
        } catch {
          setVoiceError("Transcription failed — check the voice settings.");
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setVoiceError("Microphone unavailable — check browser permissions.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  return (
    <div>
      {voiceError && (
        <p className="mb-1 px-1 text-xs text-destructive">{voiceError}</p>
      )}
      <form
        onSubmit={handleSubmit}
        className="relative flex items-end gap-2 rounded-xl border bg-card p-3 shadow-sm"
      >
        <div
          onPointerDown={startResize}
          onDoubleClick={() => setMainHeight(null)}
          title="Drag to resize • double-click to auto-fit"
          className="absolute -top-1.5 left-1/2 z-10 h-3 w-10 -translate-x-1/2 cursor-ns-resize rounded-full border bg-muted/80 shadow-sm hover:bg-muted-foreground/30"
        />
        <textarea
          ref={ref}
          rows={1}
          disabled={disabled}
          placeholder={
            recording
              ? "Listening… click the square to finish"
              : placeholder ?? "Message Little Gerry… (Shift+Enter for new line)"
          }
          onKeyDown={handleKeyDown}
          onInput={applyHeight}
          className={cn(
            "flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        />
        {voiceEnabled && (
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={disabled || transcribing}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
              recording
                ? "bg-red-500 text-white animate-pulse"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              (disabled || transcribing) && "opacity-40 cursor-not-allowed",
            )}
            aria-label={recording ? "Stop recording" : "Record voice message"}
            title={recording ? "Stop recording" : "Speak your message"}
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          type="submit"
          disabled={disabled}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity",
            disabled && "opacity-40 cursor-not-allowed",
          )}
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
