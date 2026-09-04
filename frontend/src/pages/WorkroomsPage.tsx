/**
 * WorkroomsPage — persistent co-work spaces with Gerry.
 *
 * Left: room list + create form. Right: selected room detail — goal,
 * pinned artifacts (9 kinds), progress journal, and "Enter room" which
 * opens the room's dedicated conversation (WORKROOM CONTEXT is injected
 * into every agent turn there).
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  CloudDownload,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageSquare,
  NotebookPen,
  Pin,
  PlusCircle,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import {
  ITEM_KIND_LABELS,
  addWorkroomItem,
  addWorkroomJournal,
  createWorkroom,
  deleteWorkroom,
  getWorkroom,
  joinSharedRoom,
  listSharedRooms,
  listWorkrooms,
  pullWorkroom,
  removeWorkroomItem,
  shareWorkroom,
  updateWorkroom,
  uploadWorkroomFile,
  type WorkroomItemKind,
} from "@/api/workrooms";
import { listScheduledTasks } from "@/api/scheduledTasks";
import {
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
} from "@/api/assistant";
import { DropOverlay } from "@/components/DropOverlay";
import { PinItemPicker, type PickedItem } from "@/components/workrooms/PinItemPicker";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useToastStore } from "@/stores/toastStore";
import { openExternal } from "@/lib/externalLinks";
import { cn } from "@/lib/utils";

const KIND_OPTIONS = Object.entries(ITEM_KIND_LABELS) as [WorkroomItemKind, string][];

const GUIDE_SEEN_KEY = "workrooms-guide-seen";

export function WorkroomsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  // First visit → open the how-to guide automatically.
  useEffect(() => {
    try {
      if (!localStorage.getItem(GUIDE_SEEN_KEY)) setShowGuide(true);
    } catch {
      /* storage unavailable — skip */
    }
  }, []);

  // ?room=<id> — arriving from a task opens that room.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get("room");
    if (!id) return;
    setSelectedId(id);
    const next = new URLSearchParams(searchParams);
    next.delete("room");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const closeGuide = () => {
    setShowGuide(false);
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ["workrooms", showArchived],
    queryFn: () => listWorkrooms(showArchived),
  });

  const { data: room } = useQuery({
    queryKey: ["workroom", selectedId],
    queryFn: () => getWorkroom(selectedId!),
    enabled: !!selectedId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workrooms"] });
    if (selectedId) qc.invalidateQueries({ queryKey: ["workroom", selectedId] });
  };

  const createMutation = useMutation({
    mutationFn: () => createWorkroom(newTitle.trim(), newGoal.trim()),
    onSuccess: (created) => {
      setCreating(false);
      setNewTitle("");
      setNewGoal("");
      setSelectedId(created.id);
      invalidate();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "archived" }) =>
      updateWorkroom(id, { status }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWorkroom(id),
    onSuccess: () => {
      setSelectedId(null);
      invalidate();
    },
  });

  return (
    <div className="flex h-full gap-4">
      {/* ── Room list ─────────────────────────────────────────────────── */}
      <aside className="flex w-72 flex-col gap-2 border-r pr-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h1 className="text-lg font-semibold">Workrooms</h1>
            <button
              onClick={() => setShowGuide(true)}
              className="text-muted-foreground hover:text-foreground"
              title="How Workrooms work"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
            title={showArchived ? "Hide archived rooms" : "Show archived rooms"}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        </div>

        {creating ? (
          <div className="space-y-2 rounded-md border p-3">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Room title (e.g. 510(k) Submission)"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <textarea
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              placeholder="Goal — what are you and Gerry working toward?"
              rows={3}
              className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate()}
                disabled={!newTitle.trim() || createMutation.isPending}
                className="flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {createMutation.isPending ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  "Create room"
                )}
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <PlusCircle className="h-4 w-4" />
            New workroom
          </button>
        )}

        <div className="flex-1 space-y-1 overflow-y-auto">
          {isLoading && (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          )}
          {!isLoading && rooms.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No workrooms yet. Create one to give Gerry a standing goal and
              shared artifacts.
            </div>
          )}
          {rooms.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                r.id === selectedId ? "bg-accent" : "hover:bg-accent/50",
                r.status === "archived" && "opacity-60",
              )}
            >
              <div className="truncate font-medium">{r.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {r.item_count} item{r.item_count === 1 ? "" : "s"}
                {r.share_file_id && " · shared"}
                {r.status === "archived" && " · archived"}
              </div>
            </button>
          ))}

          <SharedRoomsRail onJoined={(id) => { setSelectedId(id); invalidate(); }} />
        </div>
      </aside>

      {/* ── Room detail ───────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {!room ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Pin className="h-8 w-8 opacity-50" />
            <p className="text-lg font-medium">Select a workroom</p>
            <p className="max-w-md text-sm">
              A workroom keeps a goal, pinned documents, and progress notes in
              one place — Gerry carries that context into every conversation in
              the room.
            </p>
          </div>
        ) : (
          <RoomDetail
            key={room.id}
            room={room}
            onEnter={() => room.conversation_id && navigate(`/chat/${room.conversation_id}`)}
            onArchiveToggle={() =>
              statusMutation.mutate({
                id: room.id,
                status: room.status === "active" ? "archived" : "active",
              })
            }
            onDelete={() => {
              if (window.confirm(`Delete workroom "${room.title}"? Pinned items and journal are removed; the conversation is kept.`)) {
                deleteMutation.mutate(room.id);
              }
            }}
            onChanged={invalidate}
          />
        )}
      </div>

      {showGuide && <WorkroomsGuideDialog onClose={closeGuide} />}
    </div>
  );
}

// ── How-to guide dialog — shown on first visit, reopenable anytime ────────

function WorkroomsGuideDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">How Workrooms work</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <p>
            A <strong>Workroom</strong> is a persistent co-work space you share
            with Gerry — built for work that spans days or weeks, like a
            regulatory submission, an audit prep, or a fundraise.
          </p>

          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <MessageSquare className="h-4 w-4 shrink-0" /> The room chat remembers
            </div>
            <p className="text-muted-foreground">
              Every room has its own conversation. Every message you send there
              automatically carries the room's goal, pinned items, and recent
              progress — you never re-explain context between sessions.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <Pin className="h-4 w-4 shrink-0" /> Pin what matters
            </div>
            <p className="text-muted-foreground">
              Pin Drive docs, KB documents, files, notes, email threads, tasks,
              Odoo records, and regulatory documents. You can pin here on the
              room page, from file cards in chat, or just ask Gerry ("pin that
              SOP to this room"). Files Gerry creates in the room, docs she
              imports, and Drive docs she follows pin themselves.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <NotebookPen className="h-4 w-4 shrink-0" /> The journal is the timeline
            </div>
            <p className="text-muted-foreground">
              Log progress yourself or ask Gerry to ("note that we finished
              section 4"). Significant actions are journaled automatically, and
              the latest entries travel with every room message.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <CalendarClock className="h-4 w-4 shrink-0" /> Gerry works between sessions
            </div>
            <p className="text-muted-foreground">
              Give the room a <strong>standing task</strong> ("check for new FDA
              guidance every morning") — runs happen in the room chat. Each
              morning a <strong>digest</strong> posts what changed since
              yesterday, and Gerry proposes <strong>next steps</strong> you can
              accept or dismiss.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <Share2 className="h-4 w-4 shrink-0" /> Co-work with a teammate
            </div>
            <p className="text-muted-foreground">
              <strong>Share to Drive</strong> publishes the room's definition
              (goal + pins) to the company Drive. Teammates see it under
              <strong> Shared on Drive</strong> and can <strong>join</strong> —
              they get their own mirror of the room with their own Gerry, chat,
              and journal. <strong>Push update</strong> publishes your changes;
              <strong> Pull latest</strong> refreshes your mirror (it adds new
              pins, never deletes yours). Chats and journals stay private to
              each person.
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

// ── Shared rooms rail — manifests on the shared Drive not yet joined ───────

function SharedRoomsRail({ onJoined }: { onJoined: (roomId: string) => void }) {
  const push = useToastStore((s) => s.push);
  const qc = useQueryClient();

  // Silently absent when Google is disconnected or the folder is empty.
  const { data: shared = [] } = useQuery({
    queryKey: ["workrooms-shared"],
    queryFn: () => listSharedRooms(),
    staleTime: 120_000,
    retry: false,
  });
  const [joining, setJoining] = useState<string | null>(null);

  const unjoined = shared.filter((s) => !s.joined);
  if (unjoined.length === 0) return null;

  const join = async (fileId: string) => {
    setJoining(fileId);
    try {
      const room = await joinSharedRoom(fileId);
      qc.invalidateQueries({ queryKey: ["workrooms"] });
      qc.invalidateQueries({ queryKey: ["workrooms-shared"] });
      push("success", `Joined "${room.title}" — you now have your own mirror of the room.`);
      onJoined(room.id);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", detail || "Couldn't join the shared room.");
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="space-y-1 border-t pt-2">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Shared on Drive
      </div>
      {unjoined.map((s) => (
        <div key={s.file_id} className="rounded-md border px-3 py-2">
          <div className="truncate text-sm font-medium">{s.title}</div>
          {s.goal && (
            <div className="truncate text-xs text-muted-foreground">{s.goal}</div>
          )}
          <button
            onClick={() => void join(s.file_id)}
            disabled={joining !== null}
            className="mt-1.5 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            {joining === s.file_id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CloudDownload className="h-3 w-3" />
            )}
            Join room
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────

function RoomDetail({
  room,
  onEnter,
  onArchiveToggle,
  onDelete,
  onChanged,
}: {
  room: import("@/api/workrooms").WorkroomDetail;
  onEnter: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [goalDraft, setGoalDraft] = useState(room.goal);
  const [itemKind, setItemKind] = useState<WorkroomItemKind>("drive_doc");
  const [itemLabel, setItemLabel] = useState("");
  const [itemRef, setItemRef] = useState("");
  const [picking, setPicking] = useState(false);
  const [journalDraft, setJournalDraft] = useState("");

  const goalMutation = useMutation({
    mutationFn: () => updateWorkroom(room.id, { goal: goalDraft.trim() }),
    onSuccess: onChanged,
  });

  const addItemMutation = useMutation({
    mutationFn: () =>
      addWorkroomItem(room.id, { kind: itemKind, label: itemLabel.trim(), ref_id: itemRef.trim() }),
    onSuccess: () => {
      setItemLabel("");
      setItemRef("");
      onChanged();
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removeWorkroomItem(room.id, itemId),
    onSuccess: onChanged,
  });

  const pinPickedMutation = useMutation({
    mutationFn: async (items: PickedItem[]) => {
      for (const it of items) {
        await addWorkroomItem(room.id, {
          kind: itemKind,
          label: it.label,
          ref_id: it.ref_id,
        });
      }
      return items.length;
    },
    onSuccess: (count) => {
      setPicking(false);
      push("success", `Pinned ${count} item(s) to "${room.title}".`);
      onChanged();
    },
    onError: () => push("error", "Couldn't pin that item."),
  });

  const journalMutation = useMutation({
    mutationFn: () => addWorkroomJournal(room.id, journalDraft.trim()),
    onSuccess: () => {
      setJournalDraft("");
      onChanged();
    },
  });

  const navigate = useNavigate();
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);

  // Drag-and-drop OS files anywhere on the detail panel → uploaded + pinned.
  const [dropBusy, setDropBusy] = useState(false);
  const { isDragOver, dropProps } = useFileDrop(async (files) => {
    setDropBusy(true);
    let added = 0;
    const failures: string[] = [];
    for (const f of files) {
      try {
        await uploadWorkroomFile(room.id, f);
        added += 1;
      } catch {
        failures.push(f.name);
      }
    }
    setDropBusy(false);
    if (added > 0) push("success", `Pinned ${added} file(s) to "${room.title}".`);
    if (failures.length > 0) push("error", `Couldn't add: ${failures.join(", ")}`);
    onChanged();
  });

  const shareMutation = useMutation({
    mutationFn: () => shareWorkroom(room.id),
    onSuccess: () => {
      push("success", "Room definition shared to Drive — teammates can join it from their Workrooms page.");
      onChanged();
    },
    onError: (e) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", detail || "Couldn't share the room to Drive.");
    },
  });

  const pullMutation = useMutation({
    mutationFn: () => pullWorkroom(room.id),
    onSuccess: (r) => {
      push("success", r.added_items ? `Pulled latest — ${r.added_items} new pinned item(s).` : "Already up to date with the shared definition.");
      onChanged();
    },
    onError: (e) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push("error", detail || "Couldn't pull the shared definition.");
    },
  });

  // Standing tasks bound to this room (scheduled tasks with workroom_id).
  const { data: allScheduled = [] } = useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: listScheduledTasks,
    staleTime: 30_000,
  });
  const standingTasks = allScheduled.filter((t) => t.workroom_id === room.id);

  // Proactive next steps proposed by Gerry for this room.
  const { data: pendingTodos = [] } = useQuery({
    queryKey: ["assistant-suggestions", "workroom_todo"],
    queryFn: () => listSuggestions({ status: "pending", kind: "workroom_todo" }),
    staleTime: 30_000,
  });
  const roomTodos = pendingTodos.filter(
    (s) => (s.payload as { workroom_id?: string })?.workroom_id === room.id,
  );
  const [todoBusy, setTodoBusy] = useState<string | null>(null);

  const resolveTodo = async (id: string, action: "accept" | "dismiss") => {
    setTodoBusy(id);
    try {
      if (action === "accept") await acceptSuggestion(id);
      else await dismissSuggestion(id);
      qc.invalidateQueries({ queryKey: ["assistant-suggestions"] });
      onChanged();
    } finally {
      setTodoBusy(null);
    }
  };

  return (
    <div className="relative space-y-6 pb-8" {...dropProps}>
      <DropOverlay show={isDragOver} label={`Drop files to pin them to "${room.title}"`} />
      {dropBusy && (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Adding dropped files…
        </div>
      )}
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{room.title}</h2>
          <p className="text-xs text-muted-foreground">
            Created {new Date(room.created_at).toLocaleDateString()}
            {room.status === "archived" && " · archived"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onEnter}
            disabled={!room.conversation_id}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <MessageSquare className="h-4 w-4" />
            Enter room
          </button>
          <button
            onClick={() => shareMutation.mutate()}
            disabled={shareMutation.isPending}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
            title={room.share_file_id ? "Update the shared definition on Drive" : "Share this room's definition (goal + pins) to the shared Drive"}
          >
            {shareMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            {room.share_file_id ? "Push update" : "Share to Drive"}
          </button>
          {room.share_file_id && (
            <button
              onClick={() => pullMutation.mutate()}
              disabled={pullMutation.isPending}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
              title="Refresh this room from the shared definition (adds pins, never deletes)"
            >
              {pullMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Pull latest
            </button>
          )}
          <button
            onClick={onArchiveToggle}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
            title={room.status === "active" ? "Archive room" : "Restore room"}
          >
            {room.status === "active" ? (
              <Archive className="h-4 w-4" />
            ) : (
              <ArchiveRestore className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            title="Delete room"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Goal */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Goal</h3>
        <textarea
          value={goalDraft}
          onChange={(e) => setGoalDraft(e.target.value)}
          rows={3}
          placeholder="What is this room working toward?"
          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
        />
        {goalDraft.trim() !== room.goal && (
          <button
            onClick={() => goalMutation.mutate()}
            disabled={goalMutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {goalMutation.isPending ? "Saving…" : "Save goal"}
          </button>
        )}
      </section>

      {/* Pinned items */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Pin className="h-4 w-4" />
          Pinned items
        </h3>
        {room.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing pinned yet. Drag files from your computer anywhere onto this
            panel, or pin Drive docs, KB documents, tasks, email threads and
            more — Gerry sees them every turn in this room.
          </p>
        )}
        <ul className="space-y-1">
          {room.items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {ITEM_KIND_LABELS[it.kind] ?? it.kind}
              </span>
              {it.kind === "website" && it.ref_id ? (
                <button
                  onClick={() => openExternal(it.ref_id)}
                  className="flex-1 truncate text-left text-primary hover:underline"
                  title={it.ref_id}
                >
                  {it.label}
                </button>
              ) : (
                <span className="flex-1 truncate">{it.label}</span>
              )}
              {it.ref_id && (
                <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground sm:block">
                  {it.ref_id}
                </span>
              )}
              <button
                onClick={() => removeItemMutation.mutate(it.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="Remove item"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={itemKind}
            onChange={(e) => setItemKind(e.target.value as WorkroomItemKind)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {KIND_OPTIONS.map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setPicking(true)}
            disabled={pinPickedMutation.isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {pinPickedMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {itemKind === "note" || itemKind === "website"
              ? `Add a ${ITEM_KIND_LABELS[itemKind].toLowerCase()}…`
              : `Browse ${ITEM_KIND_LABELS[itemKind].toLowerCase()}s…`}
          </button>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            Or pin by reference
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={itemLabel}
              onChange={(e) => setItemLabel(e.target.value)}
              placeholder="Label (e.g. QMS Manual draft)"
              className="min-w-[180px] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            />
            <input
              value={itemRef}
              onChange={(e) => setItemRef(e.target.value)}
              placeholder="Reference / ID (optional)"
              className="min-w-[140px] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            />
            <button
              onClick={() => addItemMutation.mutate()}
              disabled={!itemLabel.trim() || addItemMutation.isPending}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
            >
              {addItemMutation.isPending ? "Pinning…" : "Pin"}
            </button>
          </div>
        </details>
        {picking && (
          <PinItemPicker
            kind={itemKind}
            onPick={(items) => pinPickedMutation.mutate(items)}
            onClose={() => setPicking(false)}
          />
        )}
      </section>

      {/* Suggested next steps — proactive to-dos from the daily room scan */}
      {roomTodos.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="h-4 w-4" />
            Suggested next steps
          </h3>
          <ul className="space-y-1">
            {roomTodos.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex-1">
                  <div>{s.title.replace(/^\[[^\]]*\]\s*/, "")}</div>
                  {s.summary && (
                    <div className="text-xs text-muted-foreground">{s.summary}</div>
                  )}
                </div>
                <button
                  onClick={() => void resolveTodo(s.id, "accept")}
                  disabled={todoBusy !== null}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  title="Create a task from this"
                >
                  {todoBusy === s.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Create task
                </button>
                <button
                  onClick={() => void resolveTodo(s.id, "dismiss")}
                  disabled={todoBusy !== null}
                  className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Standing tasks — scheduled tasks bound to this room */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" />
          Standing tasks
          <button
            onClick={() => navigate("/scheduled-tasks")}
            className="ml-auto text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            Manage
          </button>
        </h3>
        {standingTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. Create a scheduled task and pick this room — or just ask
            Gerry in the room chat (e.g. "check for new FDA guidance every
            morning"). Runs post into the room chat and journal.
          </p>
        ) : (
          <ul className="space-y-1">
            {standingTasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="flex-1 truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t.frequency}
                  {t.enabled ? "" : " · disabled"}
                  {t.last_run_status ? ` · last run: ${t.last_run_status}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Journal */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <NotebookPen className="h-4 w-4" />
          Progress journal
        </h3>
        <div className="flex gap-2">
          <input
            value={journalDraft}
            onChange={(e) => setJournalDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && journalDraft.trim()) journalMutation.mutate();
            }}
            placeholder="Log progress (e.g. Sent draft to Lindsey for review)"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={() => journalMutation.mutate()}
            disabled={!journalDraft.trim() || journalMutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            Log
          </button>
        </div>
        {room.journal.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No entries yet. The five most recent entries are shared with Gerry
            in the room chat.
          </p>
        ) : (
          <ul className="space-y-1">
            {room.journal.map((j) => (
              <li key={j.id} className="rounded-md border px-3 py-2 text-sm">
                <span className="mr-2 text-xs text-muted-foreground">
                  {new Date(j.created_at).toLocaleDateString()}
                </span>
                {j.entry}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
