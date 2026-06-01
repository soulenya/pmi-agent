import { useCallback, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listDocuments,
  listCategories,
  uploadDocument,
  deleteDocument,
} from "@/api/documents";
import type { Document } from "@/types/documents";
import {
  Upload,
  Trash2,
  FileText,
  FileBadge,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_ICON: Record<Document["status"], React.ReactNode> = {
  ready: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  processing: <Clock className="h-3.5 w-3.5 text-yellow-500 animate-pulse" />,
  failed: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Upload modal ──────────────────────────────────────────────────────────────

function UploadModal({
  categories,
  onClose,
  onSubmit,
}: {
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (
    file: File,
    meta: { title: string; category_id?: string | null; is_regulated: boolean },
  ) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [isRegulated, setIsRegulated] = useState(false);

  const handleFile = (f: File) => {
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold">Upload document</h2>

        {/* Drop zone */}
        <div
          className="mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-muted-foreground hover:border-primary/50"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          <Upload className="h-6 w-6" />
          {file ? (
            <span className="text-sm font-medium text-foreground">{file.name}</span>
          ) : (
            <span className="text-sm">Drop a file here or click to browse</span>
          )}
          <span className="text-xs">PDF, DOCX, TXT, MD, CSV — max 50 MB</span>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>

        {/* Title */}
        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Document title"
          />
        </label>

        {/* Category */}
        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Category</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {/* Regulated */}
        <label className="mb-5 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isRegulated}
            onChange={(e) => setIsRegulated(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Regulated document (ISO, FDA, etc.)
        </label>

        <div className="flex gap-2">
          <button
            disabled={!file || !title.trim()}
            onClick={() =>
              file &&
              onSubmit(file, {
                title: title.trim(),
                category_id: categoryId || null,
                is_regulated: isRegulated,
              })
            }
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DocumentsPage() {
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["document-categories"],
    queryFn: listCategories,
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["documents", activeCategoryId],
    queryFn: () => listDocuments({ category_id: activeCategoryId }),
  });

  const uploadMutation = useMutation({
    mutationFn: ({
      file,
      meta,
    }: {
      file: File;
      meta: { title: string; category_id?: string | null; is_regulated: boolean };
    }) => uploadDocument(file, meta),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setShowUpload(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setConfirmDelete(null);
    },
  });

  return (
    <div className="flex h-full gap-4">
      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          categories={categories}
          onClose={() => setShowUpload(false)}
          onSubmit={(file, meta) => uploadMutation.mutate({ file, meta })}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-bold">Delete document?</h2>
            <p className="mb-5 text-sm text-muted-foreground">
              The file and all its chunks will be permanently removed. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => deleteMutation.mutate(confirmDelete)}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground"
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-md border px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category sidebar */}
      <aside className="flex w-48 flex-col gap-1 border-r pr-4">
        <button
          onClick={() => setActiveCategoryId(undefined)}
          className={cn(
            "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
            !activeCategoryId
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          All documents
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategoryId(c.id)}
            className={cn(
              "w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors",
              activeCategoryId === c.id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {c.name}
          </button>
        ))}
      </aside>

      {/* Document list */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Knowledge Base</h1>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </div>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && documents.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <FileText className="h-8 w-8 opacity-40" />
            <p className="text-sm">No documents yet. Upload the first one.</p>
          </div>
        )}

        <div className="space-y-2 overflow-y-auto">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
            >
              {doc.is_regulated ? (
                <FileBadge className="h-5 w-5 shrink-0 text-orange-500" />
              ) : (
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{doc.title}</span>
                  {STATUS_ICON[doc.status]}
                </div>
                <p className="text-xs text-muted-foreground">
                  {doc.file_extension?.toUpperCase().replace(".", "") ?? "—"} ·{" "}
                  {formatBytes(doc.file_size_bytes)} · {doc.chunk_count} chunks
                </p>
              </div>

              <button
                onClick={() => setConfirmDelete(doc.id)}
                className="rounded p-1.5 text-muted-foreground hover:text-destructive"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
