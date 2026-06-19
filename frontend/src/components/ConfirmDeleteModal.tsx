import { AlertTriangle } from "lucide-react";

interface ConfirmDeleteModalProps {
  /** Title of the knowledge base document being deleted. */
  title: string;
  /** Whether the delete request is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Final confirm/cancel popup shown when an agent requests deletion of a
 * knowledge base document. The deletion is only performed when the user
 * clicks Delete here.
 */
export default function ConfirmDeleteModal({
  title,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
        <div className="mb-2 flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <h2 className="text-lg font-bold">Delete document?</h2>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          This will permanently remove{" "}
          <span className="font-semibold text-foreground">&ldquo;{title}&rdquo;</span> and all its
          chunks from the knowledge base. This cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
