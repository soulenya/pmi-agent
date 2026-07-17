/**
 * WorkroomsPage — persistent co-work spaces with Gerry.
 *
 * Left: room list + create form. Right: selected room detail — goal,
 * pinned artifacts (8 kinds), progress journal, and "Enter room" which
 * opens the room's dedicated conversation (WORKROOM CONTEXT is injected
 * into every agent turn there).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  MessageSquare,
  NotebookPen,
  Pin,
  PlusCircle,
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
  listWorkrooms,
  removeWorkroomItem,
  updateWorkroom,
  type WorkroomItemKind,
} from "@/api/workrooms";
import { cn } from "@/lib/utils";

const KIND_OPTIONS = Object.entries(ITEM_KIND_LABELS) as [WorkroomItemKind, string][];

export function WorkroomsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newGoal, setNewGoal] = useState("");

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
          <h1 className="text-lg font-semibold">Workrooms</h1>
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
                {r.status === "archived" && " · archived"}
              </div>
            </button>
          ))}
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

  const journalMutation = useMutation({
    mutationFn: () => addWorkroomJournal(room.id, journalDraft.trim()),
    onSuccess: () => {
      setJournalDraft("");
      onChanged();
    },
  });

  return (
    <div className="space-y-6 pb-8">
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
            Nothing pinned yet. Pin Drive docs, KB documents, tasks, email
            threads and more — Gerry sees them every turn in this room.
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
              <span className="flex-1 truncate">{it.label}</span>
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
          <input
            value={itemLabel}
            onChange={(e) => setItemLabel(e.target.value)}
            placeholder="Label (e.g. QMS Manual draft)"
            className="min-w-[180px] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <input
            value={itemRef}
            onChange={(e) => setItemRef(e.target.value)}
            placeholder="Reference / ID (optional)"
            className="min-w-[140px] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => addItemMutation.mutate()}
            disabled={!itemLabel.trim() || addItemMutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {addItemMutation.isPending ? "Pinning…" : "Pin"}
          </button>
        </div>
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
