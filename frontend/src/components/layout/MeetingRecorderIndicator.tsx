import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mic, MicOff, Radio, RotateCcw, Square, Trash2, X } from "lucide-react";
import {
  getRecorderStatus,
  setRecorderEnabled,
  startRecording,
  stopRecording,
  recoverRecordings,
  discardRecordings,
} from "@/api/meetings";
import { getSettings } from "@/api/settings";
import type { RecorderStatus } from "@/types/meetings";
import { cn } from "@/lib/utils";

/** Human label for the pill, in the form "Little Gerry is: …". */
function statusLabel(s: RecorderStatus): string {
  switch (s.state) {
    case "recording":
      return "Listening & Transcribing";
    case "processing":
      return "Transcribing…";
    case "meeting_detected":
      return s.enabled ? "Meeting detected" : "Off (meeting in progress)";
    default:
      return s.enabled ? "Ready to record" : "Off";
  }
}

export function MeetingRecorderIndicator() {
  const qc = useQueryClient();

  // Only show once voice/Google is configured (mirrors the voice launcher gate).
  const { data: appSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
  });
  const googleReady = appSettings?.google_key_set ?? false;

  const { data: status } = useQuery({
    queryKey: ["recorder-status"],
    queryFn: getRecorderStatus,
    refetchInterval: 5_000,
    enabled: googleReady,
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setRecorderEnabled(enabled),
    onSuccess: (s) => qc.setQueryData(["recorder-status"], s),
  });

  const startRec = useMutation({
    mutationFn: () => startRecording(),
    onSuccess: (s) => qc.setQueryData(["recorder-status"], s),
  });

  const stopRec = useMutation({
    mutationFn: () => stopRecording(),
    onSuccess: (s) => qc.setQueryData(["recorder-status"], s),
  });

  const recoverRec = useMutation({
    mutationFn: () => recoverRecordings(),
    onSuccess: (s) => qc.setQueryData(["recorder-status"], s),
  });

  const discardRec = useMutation({
    mutationFn: () => discardRecordings(),
    onSuccess: (s) => qc.setQueryData(["recorder-status"], s),
  });

  const [promptPlatform, setPromptPlatform] = useState<string | null>(null);
  const dismissedRef = useRef(false);
  const prevMeetingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!status) return;

    // A new auto-captured meeting note landed → refresh the Meetings list.
    if (status.last_meeting_id && status.last_meeting_id !== prevMeetingIdRef.current) {
      prevMeetingIdRef.current = status.last_meeting_id;
      qc.invalidateQueries({ queryKey: ["meetings"] });
    }

    // Offer to turn the feature on when a meeting starts while it's off.
    if (status.state === "meeting_detected" && !status.enabled) {
      if (!dismissedRef.current) setPromptPlatform(status.platform ?? "A meeting");
    }

    // Reset the one-shot prompt once the meeting is over.
    if (status.state === "idle") {
      dismissedRef.current = false;
      setPromptPlatform(null);
    }
  }, [status, qc]);

  if (!googleReady || !status) return null;

  const recording = status.state === "recording";
  const processing = status.state === "processing";
  const label = statusLabel(status);
  const manualBusy = startRec.isPending || stopRec.isPending;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {status.pending > 0 && status.state !== "processing" && (
          <button
            onClick={() => recoverRec.mutate()}
            disabled={recoverRec.isPending}
            title={`Resume ${status.pending} interrupted recording${status.pending > 1 ? "s" : ""} that didn't finish transcribing`}
            className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-60 dark:text-amber-400"
          >
            {recoverRec.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            <span className="hidden lg:inline">
              Recover {status.pending} recording{status.pending > 1 ? "s" : ""}
            </span>
            <span className="lg:hidden">{status.pending}</span>
          </button>
        )}
        {status.pending > 0 && status.state !== "recording" && (
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${status.pending} interrupted recording${status.pending > 1 ? "s" : ""} without transcribing? This stops Little Gerry from trying to recover ${status.pending > 1 ? "them" : "it"} and can't be undone.`,
                )
              ) {
                discardRec.mutate();
              }
            }}
            disabled={discardRec.isPending}
            title="Delete the interrupted recordings so Little Gerry stops trying to recover them"
            className="flex items-center justify-center rounded-full border border-zinc-400/40 bg-zinc-400/10 p-2 text-xs font-medium text-zinc-500 transition-colors hover:border-red-500/40 hover:bg-red-500/20 hover:text-red-500 disabled:opacity-60 dark:text-zinc-400"
          >
            {discardRec.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {recording || processing ? (
          <button
            onClick={() => stopRec.mutate()}
            disabled={processing || manualBusy}
            title="Stop recording now and save the transcript"
            className="flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-60 dark:text-red-400"
          >
            {processing || manualBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3 w-3 fill-current" />
            )}
            <span className="hidden lg:inline">{processing ? "Saving…" : "Stop recording"}</span>
          </button>
        ) : (
          <button
            onClick={() => startRec.mutate()}
            disabled={manualBusy || !status.supported}
            title={
              status.supported
                ? "Start recording now"
                : "This computer can't capture system audio without a virtual audio device"
            }
            className="flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
          >
            {manualBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            )}
            <span className="hidden lg:inline">Record</span>
          </button>
        )}

        <button
          onClick={() => toggle.mutate(!status.enabled)}
          disabled={toggle.isPending}
          title={
            status.supported
              ? "Toggle automatic meeting recording & transcription"
              : "Meeting detection is on, but this OS can't capture system audio without a virtual audio device"
          }
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60",
            recording
              ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
              : processing
                ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : status.enabled
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted text-muted-foreground hover:bg-accent",
          )}
        >
          {recording ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
          ) : processing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : status.enabled ? (
            <Radio className="h-3.5 w-3.5" />
          ) : (
            <MicOff className="h-3.5 w-3.5" />
          )}
          <span className="hidden lg:inline">Little Gerry is: {label}</span>
          <span className="lg:hidden">{recording ? "Rec" : status.enabled ? "On" : "Off"}</span>
        </button>
      </div>

      {promptPlatform && (
        <MeetingPrompt
          platform={promptPlatform}
          configured={status.configured}
          supported={status.supported}
          enabling={toggle.isPending}
          onEnable={() => {
            toggle.mutate(true);
            setPromptPlatform(null);
          }}
          onDismiss={() => {
            dismissedRef.current = true;
            setPromptPlatform(null);
          }}
        />
      )}
    </>
  );
}

function MeetingPrompt({
  platform,
  configured,
  supported,
  enabling,
  onEnable,
  onDismiss,
}: {
  platform: string;
  configured: boolean;
  supported: boolean;
  enabling: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <div className="flex items-start justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mic className="h-5 w-5" />
            </div>
            <h3 className="font-semibold">{platform} meeting detected</h3>
          </div>
          <button onClick={onDismiss} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pb-4 text-sm text-muted-foreground">
          Little Gerry can listen and transcribe this meeting, then summarize it into
          your meeting notes.
          {!supported && (
            <p className="mt-2 text-amber-600 dark:text-amber-400">
              Note: this computer can’t capture system audio without a virtual audio
              device, so capture may be silent.
            </p>
          )}
          {!configured && (
            <p className="mt-2 text-amber-600 dark:text-amber-400">
              Note: Google Speech-to-Text isn’t configured yet, so the recording won’t
              be transcribed.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onDismiss}
            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            Not now
          </button>
          <button
            onClick={onEnable}
            disabled={enabling}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {enabling && <Loader2 className="h-4 w-4 animate-spin" />}
            Turn on listening & transcribing
          </button>
        </div>
      </div>
    </div>
  );
}
