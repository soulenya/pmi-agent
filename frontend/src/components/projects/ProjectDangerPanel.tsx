import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2, Trash2, Undo2 } from "lucide-react";

import { deleteProject, updateProject, type Source } from "@/api/tasks";

export function ProjectDangerPanel({
  projectId,
  projectName,
  source,
  isArchived,
  canEdit,
  isOwner,
  onGone,
}: {
  projectId: string;
  projectName: string;
  source: Source;
  isArchived: boolean;
  canEdit: boolean;
  isOwner: boolean;
  onGone: () => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      updateProject(projectId, { is_archived: archived }, source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["hub", "projects"] });
      qc.invalidateQueries({ queryKey: ["project-space", source, projectId] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteProject(projectId, source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["hub", "projects"] });
      onGone();
    },
  });

  if (!canEdit && !isOwner) return null;

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="mb-1 text-sm font-medium">Archive or delete</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {isArchived
          ? "This project is archived. It is hidden from the project list until you bring it back."
          : "Archiving hides the project without losing anything. Deleting does not come back."}
      </p>

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <button
            type="button"
            disabled={archive.isPending}
            onClick={() => archive.mutate(!isArchived)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {archive.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isArchived ? (
              <Undo2 className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
            {isArchived ? "Bring it back" : "Archive"}
          </button>
        )}

        {isOwner && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        )}
      </div>

      {isOwner && confirming && (
        <div className="mt-3 rounded-md border border-rose-300 p-3 dark:border-rose-900">
          <p className="text-xs text-rose-700 dark:text-rose-400">
            This deletes the project, its tasks, its canvas, its timeline, its pinned
            material and its conversation with Gerry, for everyone on it. Budgets are
            let go of, not deleted — the Google Sheet is untouched.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Type <span className="font-medium text-foreground">{projectName}</span> to
            confirm.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={typed.trim() !== projectName || remove.isPending}
              onClick={() => remove.mutate()}
              className="shrink-0 rounded-md bg-rose-600 px-3 py-1.5 text-xs text-white hover:bg-rose-700 disabled:opacity-40"
            >
              {remove.isPending ? "Deleting…" : "Delete for good"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
              className="shrink-0 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              Cancel
            </button>
          </div>
          {remove.isError && (
            <p className="mt-2 text-xs text-rose-600">
              The project could not be deleted. Only its owner can delete it.
            </p>
          )}
        </div>
      )}

      {archive.isError && (
        <p className="mt-2 text-xs text-rose-600">That could not be changed.</p>
      )}
    </div>
  );
}
