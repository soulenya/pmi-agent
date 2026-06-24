import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listGeneratedFiles,
  deleteGeneratedFile,
  fetchGeneratedFileBlob,
  fetchGeneratedFilePreview,
  moveGeneratedFileToKB,
  uploadGeneratedFileToDrive,
} from "@/api/files";
import { SaveFileDialog } from "@/components/SaveFileDialog";
import { BookPlus, CloudUpload, Download, ExternalLink, Eye, Trash2, FileText, Loader2, X } from "lucide-react";
import { useState } from "react";

function stripUuidPrefix(name: string): string {
  return name
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i, "")
    .replace(/^[0-9a-f]{8}_/i, "");
}

const PREVIEWABLE_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".docx"];

function canPreview(name: string): boolean {
  const lower = name.toLowerCase();
  return PREVIEWABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function apiErr(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;
}

function PreviewModal({ name, displayName, onClose }: { name: string; displayName: string; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["generated-file-preview", name],
    queryFn: () => fetchGeneratedFilePreview(name),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-5 w-5 shrink-0 text-primary" />
            <h2 className="truncate font-semibold">{displayName}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : isError ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {apiErr(error, "This file can't be previewed. Try downloading it.")}
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-foreground">{data?.content || "(empty file)"}</pre>
            {data?.truncated && (
              <p className="px-4 pb-4 text-xs text-muted-foreground">Preview truncated — download the file to see the full contents.</p>
            )}
          </div>
        )}
        <div className="flex items-center justify-end border-t px-5 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent">Close</button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GeneratedFilesPage() {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saveTarget, setSaveTarget] = useState<{ name: string; displayName: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ name: string; displayName: string } | null>(null);
  const [actionResult, setActionResult] = useState<{ kind: "ok" | "err"; text: string; url?: string } | null>(null);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ["generated-files"],
    queryFn: listGeneratedFiles,
    refetchInterval: 15_000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGeneratedFile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generated-files"] });
      setConfirmDelete(null);
    },
  });

  const kbMutation = useMutation({
    mutationFn: ({ name, displayName }: { name: string; displayName: string }) => {
      const title = displayName.replace(/\.[^.]+$/, "");
      return moveGeneratedFileToKB(name, title);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["generated-files"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      setActionResult({ kind: "ok", text: `“${res.title}” moved to the Knowledge Base.` });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setActionResult({ kind: "err", text: detail || "Moving to the Knowledge Base failed." });
    },
  });

  const driveMutation = useMutation({
    mutationFn: ({ name, displayName }: { name: string; displayName: string }) =>
      uploadGeneratedFileToDrive(name, displayName),
    onSuccess: (res) => {
      setActionResult({ kind: "ok", text: `“${res.name}” uploaded to Google Drive.`, url: res.url });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setActionResult({
        kind: "err",
        text: detail || "Drive upload failed. Is Google Workspace connected?",
      });
    },
  });

  const busyName = kbMutation.isPending
    ? kbMutation.variables?.name
    : driveMutation.isPending
      ? driveMutation.variables?.name
      : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Generated Files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Files created by the AI assistant during conversations.
        </p>
      </div>

      {actionResult && (
        <div
          className={
            actionResult.kind === "ok"
              ? "flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm"
              : "flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          }
        >
          <span className="flex-1">{actionResult.text}</span>
          {actionResult.url && (
            <a
              href={actionResult.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs font-medium underline underline-offset-2"
            >
              Open in Drive <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            onClick={() => setActionResult(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : files.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No files generated yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Ask the assistant to create a report, plan, or document.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border divide-y">
          {files.map((file) => {
            const displayName = stripUuidPrefix(file.name);
            const isConfirming = confirmDelete === file.name;
            return (
              <div key={file.name} className="flex items-center gap-3 px-4 py-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                    {file.modified && ` · ${new Date(file.modified * 1000).toLocaleString()}`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setActionResult(null);
                    kbMutation.mutate({ name: file.name, displayName });
                  }}
                  disabled={busyName === file.name}
                  title="Move into the Knowledge Base (file is ingested, then removed from this list)"
                  className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-60"
                >
                  {kbMutation.isPending && kbMutation.variables?.name === file.name ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BookPlus className="h-3.5 w-3.5" />
                  )}
                  Knowledge
                </button>
                <button
                  onClick={() => {
                    setActionResult(null);
                    driveMutation.mutate({ name: file.name, displayName });
                  }}
                  disabled={busyName === file.name}
                  title="Upload to Google Drive (My Drive)"
                  className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-60"
                >
                  {driveMutation.isPending && driveMutation.variables?.name === file.name ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CloudUpload className="h-3.5 w-3.5" />
                  )}
                  Drive
                </button>
                {canPreview(file.name) && (
                  <button
                    onClick={() => setPreviewTarget({ name: file.name, displayName })}
                    title="Preview the file contents"
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </button>
                )}
                <button
                  onClick={() => setSaveTarget({ name: file.name, displayName })}
                  className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
                {isConfirming ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => deleteMutation.mutate(file.name)}
                      disabled={deleteMutation.isPending}
                      className="rounded-md bg-destructive px-2.5 py-1.5 text-xs text-destructive-foreground hover:bg-destructive/90"
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(file.name)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {saveTarget && (
        <SaveFileDialog
          filename={saveTarget.displayName}
          getBlob={() => fetchGeneratedFileBlob(saveTarget.name)}
          onClose={() => setSaveTarget(null)}
        />
      )}
      {previewTarget && (
        <PreviewModal
          name={previewTarget.name}
          displayName={previewTarget.displayName}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  );
}
