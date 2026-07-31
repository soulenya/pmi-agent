import { AlertTriangle, FileText, ShieldCheck } from "lucide-react";

export interface DriveEditRequest {
  file_id: string;
  file_name: string;
  mime_type?: string;
  file_url?: string;
  reason?: string;
  restricted?: boolean;
}

interface Props {
  request: DriveEditRequest;
  busy?: boolean;
  error?: string | null;
  onAllow: () => void;
  onDeny: () => void;
}

function fileKind(mime?: string): string {
  if (mime === "application/vnd.google-apps.document") return "Google Doc";
  if (mime === "application/vnd.google-apps.spreadsheet") return "Google Sheet";
  if (!mime) return "Drive file";
  if (mime.startsWith("text/")) return "text file";
  return mime;
}

/**
 * Allow/Don't-allow prompt shown when Gerry asks to edit a Drive file.
 * Permission covers this one file only and is written when Allow is clicked.
 */
export default function ConfirmDriveEditModal({
  request,
  busy = false,
  error = null,
  onAllow,
  onDeny,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
          <h2 className="text-lg font-bold">Let Gerry edit this file?</h2>
        </div>

        <div className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{request.file_name}</p>
            <p className="text-xs text-muted-foreground">{fileKind(request.mime_type)}</p>
          </div>
        </div>

        {request.reason && (
          <p className="mb-4 text-sm text-muted-foreground">
            Gerry says: <span className="text-foreground">{request.reason}</span>
          </p>
        )}

        {request.restricted && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/70 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This file is in the restricted QMS area or is named as a draft. Allow only if you
              meant this exact document.
            </span>
          </div>
        )}

        <p className="mb-5 text-xs text-muted-foreground">
          This covers <span className="font-semibold text-foreground">this file only</span> — every
          other document needs its own permission. Changes go straight into Google Drive, where
          File → Version history can undo them. Revoke any time in Settings.
        </p>

        {error && (
          <p className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onAllow}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Granting…" : "Allow edits to this file"}
          </button>
          <button
            onClick={onDeny}
            disabled={busy}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            Don&rsquo;t allow
          </button>
        </div>
      </div>
    </div>
  );
}
