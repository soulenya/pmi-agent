import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listGeneratedFiles, deleteGeneratedFile, fetchGeneratedFileBlob } from "@/api/files";
import { SaveFileDialog } from "@/components/SaveFileDialog";
import { Download, Trash2, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

function stripUuidPrefix(name: string): string {
  return name
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i, "")
    .replace(/^[0-9a-f]{8}_/i, "");
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Generated Files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Files created by the AI assistant during conversations.
        </p>
      </div>

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
    </div>
  );
}
