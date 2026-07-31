import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Mic,
  Plus,
  Sparkles,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckSquare,
  Users,
  Calendar,
  Tag,
  ListChecks,
  FileAudio,
  BookPlus,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listMeetings,
  createMeeting,
  summarizeMeeting,
  deleteMeeting,
  extractMeetingActions,
  transcribeMeetingAudio,
  addMeetingToKnowledgeBase,
  getSttCredentialsStatus,
} from "@/api/meetings";
import { createTask } from "@/api/tasks";
import type { MeetingNote, ExtractedAction } from "@/types/meetings";
import { SttCredentialsModal } from "@/components/meetings/SttCredentialsModal";

function apiErr(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;
}

// ── Action Extract Modal ──────────────────────────────────────────────────────

function ActionExtractModal({
  meetingTitle,
  actions,
  onClose,
}: {
  meetingTitle: string;
  actions: ExtractedAction[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set(actions.map((a) => a.index)));
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  async function handleCreate() {
    const toCreate = actions.filter((a) => selected.has(a.index));
    if (!toCreate.length) return;
    setCreating(true);
    try {
      await Promise.all(
        toCreate.map((a) =>
          createTask({
            title: a.title.slice(0, 255),
            description: `Action item from meeting: ${meetingTitle}`,
            priority: "medium",
          })
        )
      );
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setDone(true);
      setTimeout(onClose, 1000);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            Extract Action Items
          </h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {actions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No action items found in this meeting.
          </p>
        ) : (
          <>
            <p className="px-5 pt-3 pb-1 text-xs text-muted-foreground">
              Select the items to create as tasks:
            </p>
            <ul className="px-5 pb-4 space-y-2 max-h-72 overflow-y-auto">
              {actions.map((a) => (
                <li key={a.index} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id={`action-${a.index}`}
                    checked={selected.has(a.index)}
                    onChange={() => toggle(a.index)}
                    className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                  />
                  <label
                    htmlFor={`action-${a.index}`}
                    className="text-sm cursor-pointer leading-snug"
                  >
                    {a.title}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/30">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <button
                onClick={handleCreate}
                disabled={creating || selected.size === 0 || done}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {done ? (
                  <><CheckSquare className="h-3.5 w-3.5" /> Created!</>
                ) : creating ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>
                ) : (
                  <><ListChecks className="h-3.5 w-3.5" /> Create {selected.size} Task{selected.size !== 1 ? "s" : ""}</>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ note }: { note: MeetingNote }) {
  const summarized = !!note.summary;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        summarized
          ? "bg-green-100 text-green-700"
          : "bg-yellow-100 text-yellow-700"
      )}
    >
      {summarized ? "Summarized" : "Unsummarized"}
    </span>
  );
}

// ── New Meeting Form ──────────────────────────────────────────────────────────

function NewMeetingForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [attendeesRaw, setAttendeesRaw] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAudioRef = useRef<File | null>(null);
  const [showCredsModal, setShowCredsModal] = useState(false);

  const credStatusQuery = useQuery({
    queryKey: ["stt-credentials"],
    queryFn: getSttCredentialsStatus,
    staleTime: 60_000,
  });

  async function doTranscribe(f: File) {
    setTranscribeError(null);
    setTranscribing(true);
    try {
      const res = await transcribeMeetingAudio(f);
      const text = res.transcript.trim();
      if (!text) {
        setTranscribeError("No speech was detected in that recording.");
      } else {
        setTranscript((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
        if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
      }
    } catch (err) {
      setTranscribeError(apiErr(err, "Transcription failed. Check your AI key in Settings."));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleAudioUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    // Gate: a meeting recording can't be transcribed without the company
    // transcription key. Prompt to download it first, then resume automatically.
    if (credStatusQuery.data && !credStatusQuery.data.present) {
      pendingAudioRef.current = f;
      setShowCredsModal(true);
      return;
    }
    await doTranscribe(f);
  }

  const mutation = useMutation({
    mutationFn: () =>
      createMeeting({
        title,
        raw_transcript: transcript,
        meeting_date: meetingDate || undefined,
        attendees: attendeesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        tags: tagsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      onClose();
    },
  });

  return (
    <div className="rounded-xl border bg-card shadow-sm p-5 space-y-4">
      <h2 className="font-semibold text-base flex items-center gap-2">
        <Mic className="h-4 w-4 text-primary" />
        New Meeting Notes
      </h2>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Meeting Title *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Weekly Engineering Standup"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Meeting Date</label>
          <input
            type="datetime-local"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Attendees (comma-separated)</label>
          <input
            value={attendeesRaw}
            onChange={(e) => setAttendeesRaw(e.target.value)}
            placeholder="Alice, Bob, Carol"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">Transcript / Notes *</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleAudioUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={transcribing}
            title="Upload a recorded meeting (audio) to transcribe into the transcript"
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-accent transition-colors disabled:opacity-60"
          >
            {transcribing ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing…</>
            ) : (
              <><FileAudio className="h-3.5 w-3.5" /> Upload recording</>
            )}
          </button>
        </div>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={8}
          placeholder="Paste a meeting transcript, upload a recording to transcribe, or type notes here…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        {transcribeError && (
          <p className="text-xs text-destructive">{transcribeError}</p>
        )}
        {transcribing && (
          <p className="text-xs text-muted-foreground">Transcribing the recording — longer meetings can take a minute.</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Tags (comma-separated)</label>
        <input
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="engineering, q2, vactor"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => mutation.mutate()}
          disabled={!title || !transcript || mutation.isPending}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {mutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Save Meeting
        </button>
        <button
          onClick={onClose}
          className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
      </div>

      {showCredsModal && (
        <SttCredentialsModal
          downloadAvailable={credStatusQuery.data?.download_available ?? false}
          onClose={() => {
            setShowCredsModal(false);
            pendingAudioRef.current = null;
          }}
          onReady={async () => {
            setShowCredsModal(false);
            await credStatusQuery.refetch();
            const pending = pendingAudioRef.current;
            pendingAudioRef.current = null;
            if (pending) await doTranscribe(pending);
          }}
        />
      )}
    </div>
  );
}

// ── Meeting Card ──────────────────────────────────────────────────────────────

function MeetingCard({ note, focus = false }: { note: MeetingNote; focus?: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(focus);
  const [extractedActions, setExtractedActions] = useState<ExtractedAction[] | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Arriving from a task: open this meeting and bring it into view.
  useEffect(() => {
    if (!focus) return;
    setExpanded(true);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const summarizeMutation = useMutation({
    mutationFn: () => summarizeMeeting(note.id, { create_tasks: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });

  const extractMutation = useMutation({
    mutationFn: () => extractMeetingActions(note.id),
    onSuccess: (data) => setExtractedActions(data),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMeeting(note.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });

  const addToKbMutation = useMutation({
    mutationFn: () => addMeetingToKnowledgeBase(note.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
    onError: (e) => {
      const detail = (e as { response?: { status?: number; data?: { detail?: { message?: string } | string } } })?.response;
      if (detail?.status === 409) {
        const d = detail.data?.detail;
        window.alert(typeof d === "object" && d?.message ? d.message : "These notes are already in the Knowledge Base.");
        qc.invalidateQueries({ queryKey: ["meetings"] });
      }
    },
  });

  const inKb = Boolean(note.kb_document_id) || addToKbMutation.isSuccess;

  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden",
        focus && "ring-2 ring-primary/40",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate">{note.title}</h3>
            <StatusBadge note={note} />
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(note.meeting_date ?? note.created_at)}
            </span>
            {note.attendees.length > 0 && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {note.attendees.slice(0, 3).join(", ")}
                {note.attendees.length > 3 && ` +${note.attendees.length - 3}`}
              </span>
            )}
            {note.generated_task_ids.length > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckSquare className="h-3 w-3" />
                {note.generated_task_ids.length} tasks created
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!note.summary && (
            <button
              onClick={() => summarizeMutation.mutate()}
              disabled={summarizeMutation.isPending}
              title="Summarize with AI"
              className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {summarizeMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Summarize
            </button>
          )}
          {note.summary && (
            <button
              onClick={() => extractMutation.mutate()}
              disabled={extractMutation.isPending}
              title="Extract action items as tasks"
              className="flex items-center gap-1.5 rounded-md bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-500/20 disabled:opacity-50"
            >
              {extractMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ListChecks className="h-3 w-3" />
              )}
              Extract Actions
            </button>
          )}
          <button
            onClick={() => addToKbMutation.mutate()}
            disabled={addToKbMutation.isPending || inKb}
            title={
              inKb
                ? "Already in the Knowledge Base — delete the KB copy first to re-add, or delete this note if you no longer need it here"
                : "Add this meeting to the knowledge base"
            }
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-70",
              inKb
                ? "bg-green-500/10 text-green-700 dark:text-green-400"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20",
            )}
          >
            {addToKbMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : inKb ? (
              <Check className="h-3 w-3" />
            ) : (
              <BookPlus className="h-3 w-3" />
            )}
            {inKb ? "In Knowledge Base" : "Add to KB"}
          </button>
          <button
            onClick={() => setExpanded((p) => !p)}
            className="rounded-md p-1.5 hover:bg-accent text-muted-foreground"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="rounded-md p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Summary (always visible if present) */}
      {note.summary && (
        <div className="px-5 pb-3">
          <p className="text-sm text-muted-foreground leading-relaxed">{note.summary}</p>
        </div>
      )}

      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="px-5 pb-3 flex flex-wrap gap-1.5">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-5 py-4 space-y-4 bg-muted/30">
          {note.decisions && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Decisions
              </p>
              <pre className="whitespace-pre-wrap text-sm font-sans">{note.decisions}</pre>
            </div>
          )}
          {note.action_items && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Action Items
              </p>
              <pre className="whitespace-pre-wrap text-sm font-sans">{note.action_items}</pre>
            </div>
          )}
          {note.next_steps && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Next Steps
              </p>
              <pre className="whitespace-pre-wrap text-sm font-sans">{note.next_steps}</pre>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Raw Transcript
            </p>
            <pre className="whitespace-pre-wrap text-xs font-mono bg-muted rounded-md p-3 max-h-60 overflow-y-auto">
              {note.raw_transcript}
            </pre>
          </div>
        </div>
      )}

      {/* Action extraction modal */}
      {extractedActions !== null && (
        <ActionExtractModal
          meetingTitle={note.title}
          actions={extractedActions}
          onClose={() => setExtractedActions(null)}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MeetingsPage() {
  const [showForm, setShowForm] = useState(false);
  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: listMeetings,
  });

  // ?meeting=<id> — arriving from a task opens that meeting's detail.
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const id = searchParams.get("meeting");
    if (!id) return;
    setFocusId(id);
    const next = new URLSearchParams(searchParams);
    next.delete("meeting");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const summarized = meetings.filter((m) => !!m.summary).length;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Meeting Notes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Save transcripts and let AI extract decisions, action items, and tasks
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Meeting
          </button>
        )}
      </div>

      {/* Stats */}
      {meetings.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Meetings", value: meetings.length },
            { label: "Summarized", value: summarized },
            {
              label: "Tasks Created",
              value: meetings.reduce((acc, m) => acc + m.generated_task_ids.length, 0),
            },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* New meeting form */}
      {showForm && <NewMeetingForm onClose={() => setShowForm(false)} />}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading meetings…
        </div>
      )}

      {/* Empty state */}
      {!isLoading && meetings.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Mic className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No meeting notes yet</p>
          <p className="text-xs max-w-sm">
            Paste a transcript or type your notes — the AI will extract decisions, action items, and
            automatically create tasks.
          </p>
        </div>
      )}

      {/* List */}
      <div className="space-y-4">
        {meetings.map((m) => (
          <MeetingCard key={m.id} note={m} focus={m.id === focusId} />
        ))}
      </div>
    </div>
  );
}
