import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listDocuments,
  listCategories,
  uploadDocument,
  updateDocument,
  deleteDocument,
  listChunks,
  reembed,
} from "@/api/documents";
import type { Document, DocumentChunk } from "@/types/documents";
import { DocumentViewer } from "@/components/DocumentViewer";
import { DriveBrowser } from "@/components/google/DriveBrowser";
import { getGoogleStatus, driveImportToKnowledgeBase } from "@/api/google";
import type { DriveItem } from "@/api/google";
import {
  Upload,
  Trash2,
  FileText,
  FileBadge,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Pencil,
  X,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import axios from "axios";

// â”€â”€ Extract a human-readable error message from an axios/unknown error â”€â”€â”€â”€â”€â”€
function getErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) {
      return "Cannot reach the server. Is Little Gerry running?";
    }
    const detail = e.response.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
    if (typeof e.response.data?.message === "string") return e.response.data.message;
    return `Request failed (${e.response.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Unknown error";
}

// â”€â”€ Status badge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STATUS_ICON: Record<Document["status"], React.ReactNode> = {
  ready: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  processing: <Clock className="h-3.5 w-3.5 text-yellow-500 animate-pulse" />,
  failed: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
};

const STATUS_LABEL: Record<Document["status"], string> = {
  ready: "Ready",
  processing: "Processing…",
  failed: "Failed",
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// â”€â”€ Upload modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function UploadModal({
  categories,
  onClose,
  onSubmit,
  uploading,
  error,
}: {
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (
    file: File,
    meta: { title: string; category_id?: string | null; is_regulated: boolean },
  ) => void;
  uploading: boolean;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [isRegulated, setIsRegulated] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (f: File) => {
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Upload document</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            "mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-muted-foreground transition-colors",
            dragOver ? "border-primary bg-primary/5" : "hover:border-primary/50",
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
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
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Document title"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Category</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">â€” None â€”</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="mb-5 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isRegulated}
            onChange={(e) => setIsRegulated(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          Regulated document (ISO, FDA, etc.)
        </label>

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        <div className="flex gap-2">
          <button
            disabled={!file || !title.trim() || uploading}
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
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploadingâ€¦" : "Upload"}
          </button>
          <button onClick={onClose} disabled={uploading} className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Edit modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EditModal({
  doc,
  categories,
  onClose,
  onSave,
  saving,
}: {
  doc: Document;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSave: (updates: { title: string; category_id: string | null; is_regulated: boolean }) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(doc.title);
  const [categoryId, setCategoryId] = useState(doc.category_id ?? "");
  const [isRegulated, setIsRegulated] = useState(doc.is_regulated);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Edit document</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Category</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="mb-5 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isRegulated}
            onChange={(e) => setIsRegulated(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          Regulated document (ISO, FDA, etc.)
        </label>

        <div className="flex gap-2">
          <button
            disabled={!title.trim() || saving}
            onClick={() => onSave({ title: title.trim(), category_id: categoryId || null, is_regulated: isRegulated })}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </button>
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Chunk drawer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ChunkDrawer({ docId }: { docId: string }) {
  const { data: chunks = [], isLoading } = useQuery({
    queryKey: ["chunks", docId],
    queryFn: () => listChunks(docId),
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!chunks.length) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">No chunks found.</p>;
  }

  return (
    <div className="border-t bg-muted/30 px-4 py-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {chunks.length} chunk{chunks.length !== 1 ? "s" : ""}
      </p>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {chunks.map((c: DocumentChunk) => (
          <div key={c.id} className="rounded-md border bg-card p-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-muted-foreground">#{c.chunk_index + 1}</span>
              {c.page_number != null && (
                <span className="text-xs text-muted-foreground">p.{c.page_number}</span>
              )}
              {c.token_count != null && (
                <span className="ml-auto text-xs text-muted-foreground">{c.token_count} tok</span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-foreground line-clamp-3">
              {c.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// â”€â”€ Document row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DocumentRow({
  doc,
  categories,
  onDelete,
  onReembed,
  onEdit,
  onView,
}: {
  doc: Document;
  categories: { id: string; name: string }[];
  onDelete: () => void;
  onReembed: () => void;
  onEdit: () => void;
  onView: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const categoryName = categories.find((c) => c.id === doc.category_id)?.name;

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded
            ? <ChevronDown className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />}
        </button>

        {doc.is_regulated
          ? <FileBadge className="h-5 w-5 shrink-0 text-orange-500" />
          : <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />}

        {/* Main info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate text-sm font-medium">{doc.title}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {STATUS_ICON[doc.status]} {STATUS_LABEL[doc.status]}
            </span>
            {categoryName && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">
                {categoryName}
              </span>
            )}
            {doc.is_regulated && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                Regulated
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {doc.file_extension?.toUpperCase().replace(".", "") ?? "—"} ·{" "}
            {formatBytes(doc.file_size_bytes)} · {doc.chunk_count} chunks ·{" "}
            uploaded {timeAgo(doc.created_at)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onView}
            className="rounded p-1.5 text-muted-foreground hover:text-primary"
            title="View document"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onEdit}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onReembed}
            className="rounded p-1.5 text-muted-foreground hover:text-primary"
            title="Re-embed"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1.5 text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && <ChunkDrawer docId={doc.id} />}
    </div>
  );
}

// â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function DocumentsPage() {
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [showDriveBrowser, setShowDriveBrowser] = useState(false);
  const [driveImportStatus, setDriveImportStatus] = useState<string | null>(null);
  const [driveImporting, setDriveImporting] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editDoc, setEditDoc] = useState<Document | null>(null);
  const [viewDoc, setViewDoc] = useState<Document | null>(null);
  const [uploadError, setUploadError] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["document-categories"],
    queryFn: listCategories,
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["documents", activeCategoryId],
    queryFn: () => listDocuments({ category_id: activeCategoryId }),
    // Poll every 5s if any document is processing
    refetchInterval: (q) =>
      q.state.data?.some((d) => d.status === "processing") ? 5_000 : false,
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
      setUploadError("");
    },
    onError: (e: Error) => setUploadError(getErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setConfirmDelete(null);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { title: string; category_id: string | null; is_regulated: boolean } }) =>
      updateDocument(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setEditDoc(null);
    },
  });

  const reembedMutation = useMutation({
    mutationFn: (id: string) => reembed(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const { data: googleStatus } = useQuery({
    queryKey: ["google-status"],
    queryFn: getGoogleStatus,
    staleTime: 60_000,
  });

  async function handleDriveImport(items: DriveItem[]) {
    setDriveImporting(true);
    setDriveImportStatus(`Importing 0 of ${items.length}…`);
    let succeeded = 0;
    const failures: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setDriveImportStatus(`Importing ${i + 1} of ${items.length}: ${item.name}`);
      try {
        await driveImportToKnowledgeBase(item.id, item.name, undefined, false);
        succeeded++;
      } catch (e) {
        failures.push(`${item.name}: ${getErrorMessage(e)}`);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    setDriveImporting(false);
    setShowDriveBrowser(false);
    const msg = failures.length === 0
      ? `Imported ${succeeded} file${succeeded === 1 ? "" : "s"} successfully.`
      : `Imported ${succeeded}, failed ${failures.length}. ${failures.join(" | ")}`;
    setDriveImportStatus(msg);
    setTimeout(() => setDriveImportStatus(null), failures.length === 0 ? 5000 : 15000);
  }

  // â”€â”€ Stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allDocs = documents;
  const readyDocs = allDocs.filter((d) => d.status === "ready");
  const processingDocs = allDocs.filter((d) => d.status === "processing");
  const regulatedCount = allDocs.filter((d) => d.is_regulated).length;
  const totalChunks = allDocs.reduce((n, d) => n + d.chunk_count, 0);

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          categories={categories}
          onClose={() => { setShowUpload(false); setUploadError(""); }}
          onSubmit={(file, meta) => uploadMutation.mutate({ file, meta })}
          uploading={uploadMutation.isPending}
          error={uploadError}
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
                className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
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

      {/* Edit modal */}
      {editDoc && (
        <EditModal
          doc={editDoc}
          categories={categories}
          onClose={() => setEditDoc(null)}
          saving={editMutation.isPending}
          onSave={(updates) => editMutation.mutate({ id: editDoc.id, updates })}
        />
      )}

      {/* Category sidebar */}
      <aside className="flex w-48 shrink-0 flex-col gap-1 border-r pr-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3">
          Categories
        </p>
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

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Knowledge Base</h1>
          <div className="flex items-center gap-2">
            {googleStatus?.connected && (
              <button
                onClick={() => setShowDriveBrowser(true)}
                className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Import from Drive
              </button>
            )}
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Upload className="h-4 w-4" />
              Upload
            </button>
          </div>
        </div>

        {/* Drive import status toast */}
        {driveImportStatus && (
          <div className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm text-muted-foreground">
            {driveImporting && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            {driveImportStatus}
          </div>
        )}

        {/* Drive browser modal */}
        {showDriveBrowser && (
          <DriveBrowser
            onClose={() => { if (!driveImporting) setShowDriveBrowser(false); }}
            onSelect={handleDriveImport}
          />
        )}

        {/* Stats bar */}
        {!isLoading && allDocs.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Total documents", value: allDocs.length },
              { label: "Total chunks", value: totalChunks },
              { label: "Regulated", value: regulatedCount },
              { label: "Processing", value: processingDocs.length, urgent: processingDocs.length > 0 },
            ].map(({ label, value, urgent }) => (
              <div key={label} className="rounded-lg border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={cn("text-2xl font-bold mt-0.5", urgent ? "text-yellow-500" : "")}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        )}

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

        <div className="space-y-2 overflow-y-auto flex-1">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              categories={categories}
              onDelete={() => setConfirmDelete(doc.id)}
              onReembed={() => reembedMutation.mutate(doc.id)}
              onEdit={() => setEditDoc(doc)}
              onView={() => setViewDoc(doc)}
            />
          ))}
        </div>

        {readyDocs.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {readyDocs.length} document{readyDocs.length !== 1 ? "s" : ""} ready Â· {totalChunks} chunks indexed
          </p>
        )}
      </div>
      {/* Document viewer panel */}
      {viewDoc && (
        <DocumentViewer
          doc={viewDoc}
          categoryName={categories.find((c) => c.id === viewDoc.category_id)?.name}
          onClose={() => setViewDoc(null)}
          onEdit={() => { setEditDoc(viewDoc); setViewDoc(null); }}
          onReembed={() => { reembedMutation.mutate(viewDoc.id); setViewDoc(null); }}
        />
      )}    </div>
  );
}
