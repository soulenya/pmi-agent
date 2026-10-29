/**
 * Your notes. Things you told Gerry to remember — by voice, in chat, or typed
 * here — kept for you alone and read back into your briefings and routines.
 *
 * When this install is connected to the hub the notes live there, so the
 * phone and the laptop show one list; anything written while offline stays
 * here and is listed under its own heading.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bot, Loader2, Mic, Pencil, StickyNote, Trash2, Undo2, X } from "lucide-react";

import { createNote, deleteNote, listNotes, updateNote, type Note } from "@/api/notes";
import type { Source } from "@/api/tasks";
import { useDefaultSource, useHubRemote } from "@/hooks/useAllWork";
import { cn } from "@/lib/utils";

type Row = Note & { source_where: Source };

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " · " +
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const SOURCE_ICON: Record<Note["source"], { icon: typeof Mic; title: string }> = {
  voice: { icon: Mic, title: "Dictated" },
  gerry: { icon: Bot, title: "Saved by Gerry in chat" },
  text: { icon: Pencil, title: "Typed" },
};

export function NotesPage() {
  const qc = useQueryClient();
  const writeTo = useDefaultSource();
  const hubRemote = useHubRemote();
  const [draft, setDraft] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");

  const params = { include_archived: showArchived, limit: 300, ...(search.trim() ? { q: search.trim() } : {}) };
  const local = useQuery({
    queryKey: ["notes", "local", params],
    queryFn: () => listNotes(params, "local"),
  });
  const hub = useQuery({
    queryKey: ["notes", "hub", params],
    queryFn: () => listNotes(params, "hub"),
    enabled: hubRemote,
    retry: false,
  });

  const rows: Row[] = useMemo(() => {
    const all: Row[] = [
      ...(hub.data ?? []).map((n) => ({ ...n, source_where: "hub" as const })),
      ...(local.data ?? []).map((n) => ({ ...n, source_where: "local" as const })),
    ];
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [hub.data, local.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["notes"] });

  const add = useMutation({
    mutationFn: () => createNote(draft.trim(), writeTo, "text"),
    onSuccess: () => {
      setDraft("");
      refresh();
    },
  });
  const edit = useMutation({
    mutationFn: (v: { row: Row; content: string }) => updateNote(v.row.id, { content: v.content }, v.row.source_where),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: (v: { row: Row; archived: boolean }) =>
      updateNote(v.row.id, { archived: v.archived }, v.row.source_where),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (row: Row) => deleteNote(row.id, row.source_where),
    onSuccess: refresh,
  });

  const loading = local.isLoading || (hubRemote && hub.isLoading);
  const busy = add.isPending || edit.isPending || archive.isPending || remove.isPending;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <StickyNote className="h-5 w-5 text-amber-500" /> Notes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Things you told Gerry to remember. Only you can see them; Gerry reads them back into your briefing and
          the routines you run. Say “note that…” in any conversation, or type one here.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) add.mutate();
        }}
        className="flex gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
              e.preventDefault();
              add.mutate();
            }
          }}
          rows={2}
          placeholder="Note something… (Enter to save, Shift+Enter for a new line)"
          className="min-w-0 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          className="shrink-0 self-end rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </button>
      </form>
      {add.isError && <p className="text-xs text-destructive">Couldn’t save that. Please try again.</p>}

      <div className="flex items-center gap-3 text-xs">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes"
          className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-ring"
        />
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card">
        {loading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <StickyNote className="h-8 w-8 opacity-40" />
            {search.trim() ? "No notes match that." : "No notes yet. Tell Gerry “note that…” or type one above."}
          </div>
        )}
        <ul className="divide-y">
          {rows.map((row) => (
            <NoteRow
              key={`${row.source_where}-${row.id}`}
              row={row}
              busy={busy}
              onSave={(content) => edit.mutate({ row, content })}
              onArchive={(archived) => archive.mutate({ row, archived })}
              onDelete={() => {
                if (confirm("Delete this note for good? Archiving keeps it out of the way instead.")) remove.mutate(row);
              }}
            />
          ))}
        </ul>
      </div>
      {hubRemote && hub.isError && (
        <p className="text-xs text-muted-foreground">
          Couldn’t reach the hub for your notes there; showing what is on this computer.
        </p>
      )}
    </div>
  );
}

function NoteRow({
  row,
  busy,
  onSave,
  onArchive,
  onDelete,
}: {
  row: Row;
  busy: boolean;
  onSave: (content: string) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.content);
  const Src = SOURCE_ICON[row.source] ?? SOURCE_ICON.text;
  const archived = row.archived_at != null;

  return (
    <li className={cn("group flex gap-3 px-4 py-3", archived && "opacity-60")}>
      <span className="mt-1 shrink-0 text-muted-foreground" title={Src.title}>
        <Src.icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              autoFocus
              className="w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => {
                  onSave(text.trim());
                  setEditing(false);
                }}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setText(row.content);
                  setEditing(false);
                }}
                className="rounded-md border px-3 py-1 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{row.content}</p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {when(row.created_at)}
          {row.source_where === "local" ? " · on this computer" : ""}
          {archived ? " · archived" : ""}
        </p>
      </div>
      {!editing && (
        <div className="flex shrink-0 items-start gap-0.5 opacity-70 md:opacity-0 md:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            title="Edit"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onArchive(!archived)}
            disabled={busy}
            title={archived ? "Bring back" : "Archive"}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {archived ? <Undo2 className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            title="Delete"
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {archived ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </li>
  );
}

export default NotesPage;
