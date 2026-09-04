/**
 * The project's material, worked on in the project.
 *
 * The tab used to hold two links: locally, "Open the workroom", which threw you
 * out of the project you were standing in; on the hub, a sentence telling you to
 * open the hub in a browser, which does not exist and never will. The pins, the
 * journal and the goal were all reachable by the API the whole time — the calls
 * simply had no `source`, so a hub project could not ask for its own room.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  FileText,
  Loader2,
  NotebookPen,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import type { Source } from "@/api/tasks";
import {
  ITEM_KIND_LABELS,
  addWorkroomItem,
  addWorkroomJournal,
  getWorkroom,
  removeWorkroomItem,
  updateWorkroom,
  uploadWorkroomFile,
  type WorkroomItem,
  type WorkroomItemKind,
} from "@/api/workrooms";
import { PinItemPicker, type PickedItem } from "@/components/workrooms/PinItemPicker";
import { useProjectInvalidate } from "@/hooks/useProjectInvalidate";
import { DRAG_MIME, type RailItem } from "./canvas/board";

/** The order pins are grouped in — the kinds people reach for first, first. */
const KIND_ORDER: WorkroomItemKind[] = [
  "kb_doc",
  "drive_doc",
  "generated_file",
  "website",
  "note",
  "task",
  "budget",
  "regulatory_doc",
  "email_thread",
  "odoo_record",
];

/**
 * Document and generated-file BYTES are encrypted under a key held in this
 * computer's keyring, so on a shared project everyone sees the pin but only the
 * install that uploaded it can open the file. Saying so on the item beats
 * letting someone find out by clicking.
 */
const INSTALL_LOCAL: WorkroomItemKind[] = [
  "kb_doc",
  "generated_file",
  "drive_doc",
  "email_thread",
  "odoo_record",
];

/** Where a pin can be opened, when the app has somewhere to send you. */
function itemLink(item: WorkroomItem): string | null {
  switch (item.kind) {
    case "kb_doc":
      return `/documents?doc=${encodeURIComponent(item.ref_id)}`;
    case "task":
      return `/tasks?task=${encodeURIComponent(item.ref_id)}`;
    case "regulatory_doc":
      return `/regulatory?doc=${encodeURIComponent(item.ref_id)}`;
    case "generated_file":
      return "/files";
    default:
      return null;
  }
}

/** External destinations open in the browser, not in a route. */
function itemHref(item: WorkroomItem): string | null {
  if (item.kind === "website") return item.ref_id || null;
  if (item.kind === "drive_doc" && item.ref_id) {
    return `https://drive.google.com/open?id=${encodeURIComponent(item.ref_id)}`;
  }
  if (item.kind === "email_thread" && item.ref_id) {
    return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(item.ref_id)}`;
  }
  return null;
}

/** Only some pinned kinds have a card the canvas knows how to draw. */
const CANVAS_KINDS = new Set<WorkroomItemKind>([
  "task",
  "budget",
  "kb_doc",
  "drive_doc",
  "generated_file",
  "regulatory_doc",
  "website",
  "note",
]);

export function ProjectMaterialTab({
  projectId,
  workroomId,
  source,
  canEdit,
  onHub,
}: {
  projectId: string;
  workroomId: string | null;
  source: Source;
  canEdit: boolean;
  onHub: boolean;
}) {
  const invalidate = useProjectInvalidate(projectId, source);
  const [picking, setPicking] = useState<WorkroomItemKind | null>(null);
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [journalDraft, setJournalDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: room, isLoading } = useQuery({
    queryKey: ["workroom", source, workroomId],
    queryFn: () => getWorkroom(workroomId!, source),
    enabled: Boolean(workroomId),
  });

  const pin = useMutation({
    mutationFn: async (picked: { kind: WorkroomItemKind; items: PickedItem[] }) => {
      for (const it of picked.items) {
        await addWorkroomItem(
          workroomId!,
          { kind: picked.kind, ref_id: it.ref_id, label: it.label },
          source,
        );
      }
    },
    onSuccess: () => {
      setPicking(null);
      invalidate();
    },
    onError: () => setError("That could not be pinned."),
  });

  const unpin = useMutation({
    mutationFn: (itemId: string) => removeWorkroomItem(workroomId!, itemId, source),
    onSuccess: invalidate,
    onError: () => setError("That pin could not be removed."),
  });

  const journal = useMutation({
    mutationFn: (entry: string) => addWorkroomJournal(workroomId!, entry, source),
    onSuccess: () => {
      setJournalDraft("");
      invalidate();
    },
    onError: () => setError("The note could not be saved."),
  });

  const goal = useMutation({
    mutationFn: (text: string) => updateWorkroom(workroomId!, { goal: text }, source),
    onSuccess: () => {
      setGoalDraft(null);
      invalidate();
    },
    onError: () => setError("The goal could not be saved."),
  });

  const groups = useMemo(() => {
    const byKind = new Map<WorkroomItemKind, WorkroomItem[]>();
    for (const item of room?.items ?? []) {
      const list = byKind.get(item.kind) ?? [];
      list.push(item);
      byKind.set(item.kind, list);
    }
    return KIND_ORDER.filter((k) => byKind.has(k)).map(
      (k) => [k, byKind.get(k)!] as const,
    );
  }, [room?.items]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0 || !workroomId) return;
    setUploading(true);
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        await uploadWorkroomFile(workroomId, file, source);
      } catch {
        failed.push(file.name);
      }
    }
    setUploading(false);
    if (failed.length > 0) setError(`Could not add: ${failed.join(", ")}`);
    invalidate();
  }

  if (!workroomId) {
    return (
      <p className="text-sm text-muted-foreground">
        This project has no room yet. Start the project conversation and one is made
        with it.
      </p>
    );
  }

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the project's material…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── What the project is for ─────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What this project is for
        </h3>
        {goalDraft === null ? (
          <p
            className={`mt-1 text-sm ${canEdit ? "cursor-text" : ""} ${
              room?.goal ? "" : "text-muted-foreground"
            }`}
            onClick={() => canEdit && setGoalDraft(room?.goal ?? "")}
          >
            {room?.goal || (canEdit ? "Say what this project is for." : "No goal set.")}
          </p>
        ) : (
          <div className="mt-1 space-y-2">
            <textarea
              autoFocus
              rows={3}
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={goal.isPending}
                onClick={() => goal.mutate(goalDraft.trim())}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setGoalDraft(null)}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Pins ────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pinned material ({room?.items.length ?? 0})
          </h3>
          {canEdit && (
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Add a file
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void onFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <select
                value=""
                onChange={(e) => e.target.value && setPicking(e.target.value as WorkroomItemKind)}
                className="rounded-md border bg-background px-2 py-1 text-xs"
              >
                <option value="">Pin something…</option>
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {ITEM_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Nothing pinned yet. Pin a document, a Drive file, a website or a task and Gerry will have it to hand in this project's conversation."
              : "Nothing has been pinned to this project yet."}
          </p>
        ) : (
          groups.map(([kind, items]) => (
            <div key={kind} className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {ITEM_KIND_LABELS[kind]} · {items.length}
              </p>
              <ul className="space-y-1">
                {items.map((item) => {
                  const route = itemLink(item);
                  const href = itemHref(item);
                  const draggable = canEdit && CANVAS_KINDS.has(item.kind);
                  return (
                    <li
                      key={item.id}
                      draggable={draggable}
                      onDragStart={(e) => {
                        const payload: RailItem = {
                          kind: item.kind as RailItem["kind"],
                          refId: item.ref_id,
                          label: item.label,
                        };
                        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                        draggable ? "cursor-grab active:cursor-grabbing" : ""
                      }`}
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {onHub && INSTALL_LOCAL.includes(item.kind) && (
                          <span className="block text-xs text-muted-foreground">
                            Everyone on the project sees this pin, but the file itself
                            only opens on the computer that added it.
                          </span>
                        )}
                      </span>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          title="Open"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {route && !onHub && (
                        <NavLink
                          to={route}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          title="Open"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </NavLink>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => unpin.mutate(item.id)}
                          className="shrink-0 text-muted-foreground hover:text-rose-600"
                          title="Remove this pin"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
        {canEdit && groups.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Drag a pin onto the canvas to put it on the board.
          </p>
        )}
      </section>

      {/* ── Journal ─────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Journal ({room?.journal.length ?? 0})
        </h3>
        {canEdit && (
          <div className="flex gap-2">
            <input
              value={journalDraft}
              onChange={(e) => setJournalDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && journalDraft.trim()) {
                  journal.mutate(journalDraft.trim());
                }
              }}
              placeholder="What happened, what was decided…"
              className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={!journalDraft.trim() || journal.isPending}
              onClick={() => journal.mutate(journalDraft.trim())}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Note
            </button>
          </div>
        )}
        {room?.journal.length ? (
          <ul className="space-y-1">
            {room.journal.map((entry) => (
              <li key={entry.id} className="flex gap-2 rounded-md border px-3 py-2 text-sm">
                <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-pre-wrap">{entry.entry}</span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No entries yet.</p>
        )}
      </section>

      {picking && (
        <PinItemPicker
          kind={picking}
          source={source}
          projectId={projectId}
          onClose={() => setPicking(null)}
          onPick={(items) => pin.mutate({ kind: picking, items })}
        />
      )}
    </div>
  );
}
