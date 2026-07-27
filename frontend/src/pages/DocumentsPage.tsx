import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DropOverlay } from "@/components/DropOverlay";
import { useFileDrop } from "@/hooks/useFileDrop";
import {
  listDocuments,
  listCategories,
  uploadDocument,
  updateDocument,
  deleteDocument,
  listChunks,
  reembed,
  checkDocumentUpdates,
  applyDocumentUpdate,
  dismissDocumentUpdate,
  scanDuplicates,
  linkUploadsToDrive,
  saveManifest,
  importManifest,
} from "@/api/documents";
import type { DuplicateScanResult } from "@/api/documents";
import type {
  LinkToDriveResult,
  KbManifest,
  KbManifestItem,
  ManifestImportResult,
} from "@/api/documents";
import type { Document, DocumentChunk } from "@/types/documents";
import { DocumentViewer } from "@/components/DocumentViewer";
import { AskGerryButton } from "@/components/AskGerryButton";import { DriveBrowser } from "@/components/google/DriveBrowser";
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
  DownloadCloud,
  AlertTriangle,
  Check,
  Files,
  Copy,
  Share2,
  Link2,
  Download,
  FileUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import axios from "axios";

// â”€â”€ Extract a human-readable error message from an axios/unknown error â”€â”€â”€â”€â”€â”€
function getErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) {
      if (e.code === "ECONNABORTED" || /timeout/i.test(e.message)) {
        return "This is taking longer than expected and timed out. Little Gerry may still be working in the background — give it a moment, then refresh to see what was imported.";
      }
      return "Cannot reach the server. Is Little Gerry running?";
    }
    const detail = e.response.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
    if (detail && typeof detail === "object" && typeof detail.message === "string")
      return detail.message;
    if (typeof e.response.data?.message === "string") return e.response.data.message;
    return `Request failed (${e.response.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Unknown error";
}

// â”€â”€ Detect a duplicate-document 409 conflict and pull out the existing doc â”€â”€
interface DuplicateExisting {
  id: string;
  title: string;
  file_name: string | null;
  created_at: string | null;
}
function getDuplicateConflict(e: unknown): DuplicateExisting | null {
  if (axios.isAxiosError(e) && e.response?.status === 409) {
    const detail = e.response.data?.detail;
    if (detail && typeof detail === "object" && detail.code === "duplicate_document") {
      return detail.existing as DuplicateExisting;
    }
  }
  return null;
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

// Sync-status badge styling/labels for Drive-linked documents.
const SYNC_BADGE: Record<string, { label: string; className: string }> = {
  modified: { label: "Update available", className: "bg-amber-100 text-amber-800" },
  renamed: { label: "Renamed in source", className: "bg-blue-100 text-blue-800" },
  deleted: { label: "Source deleted", className: "bg-red-100 text-red-800" },
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
  initialFiles,
}: {
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (
    files: File[],
    meta: { title: string; category_id?: string | null; is_regulated: boolean },
  ) => void;
  uploading: boolean;
  error?: string;
  initialFiles?: File[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [title, setTitle] = useState(
    initialFiles?.length === 1 ? initialFiles[0].name.replace(/\.[^.]+$/, "") : "",
  );
  const [categoryId, setCategoryId] = useState<string>("");
  const [isRegulated, setIsRegulated] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (incoming: File[] | FileList) => {
    const next = Array.from(incoming);
    if (next.length === 0) return;
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of next) {
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      if (merged.length === 1 && !title) setTitle(merged[0].name.replace(/\.[^.]+$/, ""));
      return merged;
    });
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
            addFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="h-6 w-6" />
          {files.length > 0 ? (
            <div className="flex max-w-full flex-wrap justify-center gap-1.5">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-foreground"
                >
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFiles((prev) => prev.filter((_, j) => j !== i));
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-sm">Drop files here or click to browse</span>
          )}
          <span className="text-xs">PDF, DOCX, TXT, MD, CSV — max 50 MB each</span>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        {files.length > 1 ? (
          <p className="mb-3 text-xs text-muted-foreground">
            {files.length} files selected — each document's title comes from its file
            name.
          </p>
        ) : (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="Document title"
            />
          </label>
        )}

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
            disabled={files.length === 0 || (files.length === 1 && !title.trim()) || uploading}
            onClick={() =>
              files.length > 0 &&
              onSubmit(files, {
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
  onApplyUpdate,
  onDismissUpdate,
  applyingUpdate,
  dismissingUpdate,
}: {
  doc: Document;
  categories: { id: string; name: string }[];
  onDelete: () => void;
  onReembed: () => void;
  onEdit: () => void;
  onView: () => void;
  onApplyUpdate: () => void;
  onDismissUpdate: () => void;
  applyingUpdate: boolean;
  dismissingUpdate: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const categoryName = categories.find((c) => c.id === doc.category_id)?.name;
  const sync = doc.sync_status && doc.sync_status !== "current"
    ? SYNC_BADGE[doc.sync_status]
    : undefined;
  const busy = applyingUpdate || dismissingUpdate;

  return (
    <div className={cn(
      "rounded-lg border bg-card overflow-hidden",
      sync && "border-amber-300",
    )}>
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
            {sync && (
              <span className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                sync.className,
              )}>
                <AlertTriangle className="h-3 w-3" />
                {sync.label}
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
          <AskGerryButton
            className="p-1.5"
            build={() => ({
              title: `Doc: ${doc.title}`,
              prompt:
                `I'd like to ask about a document in my Knowledge Base.\n\n` +
                `Title: ${doc.title}` +
                (doc.file_name ? `\nFile: ${doc.file_name}` : "") +
                `\n\nPlease look it up in the knowledge base and give me a summary, ` +
                `then I'll ask follow-up questions.`,
            })}
          />
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

      {/* Source-update banner */}
      {sync && (
        <div className="flex items-center gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-amber-800">
            {doc.sync_detail ?? "The source file changed in Google Drive."}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {doc.sync_status !== "deleted" && (
              <button
                onClick={onApplyUpdate}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {applyingUpdate
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <DownloadCloud className="h-3.5 w-3.5" />}
                {applyingUpdate ? "Applying…" : "Apply update"}
              </button>
            )}
            <button
              onClick={onDismissUpdate}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {dismissingUpdate
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
              Dismiss
            </button>
          </div>
        </div>
      )}

      {expanded && <ChunkDrawer docId={doc.id} />}
    </div>
  );
}

// â”€â”€ Duplicate scan modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DuplicatesModal({
  result,
  onClose,
  onDeleted,
}: {
  result: DuplicateScanResult;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteDocument(id);
      onDeleted();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2">
            <Files className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-bold">Duplicate scan</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {result.group_count === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p className="text-sm">No duplicates found — every document is unique.</p>
          </div>
        ) : (
          <>
            <p className="border-b px-5 py-3 text-sm text-muted-foreground">
              Found {result.group_count} duplicate group
              {result.group_count === 1 ? "" : "s"} ({result.redundant_count} redundant
              cop{result.redundant_count === 1 ? "y" : "ies"}). The oldest copy in each
              group is kept; delete the extras you don’t need.
            </p>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {result.groups.map((group) => (
                <div key={group.checksum} className="rounded-lg border">
                  {group.documents.map((d, idx) => (
                    <div
                      key={d.id}
                      className={cn(
                        "flex items-center justify-between gap-3 px-4 py-3",
                        idx > 0 && "border-t",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{d.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {d.file_name ?? "—"}
                          {d.created_at && <span> · added {timeAgo(d.created_at)}</span>}
                        </p>
                      </div>
                      {idx === 0 ? (
                        <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
                          Original
                        </span>
                      ) : (
                        <button
                          onClick={() => handleDelete(d.id)}
                          disabled={deletingId === d.id}
                          className="flex shrink-0 items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          {deletingId === d.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                          Delete copy
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end border-t p-4">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Share Knowledge Base (Drive link + manifest) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ShareKbModal({
  connected,
  onClose,
  onChanged,
}: {
  connected: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);

  const [linking, setLinking] = useState(false);
  const [linkResult, setLinkResult] = useState<LinkToDriveResult | null>(null);
  const [linkError, setLinkError] = useState("");

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [exportError, setExportError] = useState("");

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ManifestImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  const handleLink = async () => {
    setLinking(true);
    setLinkError("");
    setLinkResult(null);
    try {
      const r = await linkUploadsToDrive();
      setLinkResult(r);
      if (r.linked_count > 0) onChanged();
    } catch (e) {
      setLinkError(getErrorMessage(e));
    } finally {
      setLinking(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError("");
    setExportMsg("");
    try {
      const r = await saveManifest();
      setExportMsg(
        `Exported ${r.count} document${r.count === 1 ? "" : "s"} \u2014 saved littlegerry-kb.json and littlegerry-kb.md to ${r.directory}.`,
      );
    } catch (e) {
      setExportError(getErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportError("");
    setImportResult(null);
    setImportProgress(null);

    let items: KbManifestItem[] | null = null;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as KbManifest;
      items = Array.isArray(parsed?.items) ? (parsed.items as KbManifestItem[]) : null;
    } catch {
      setImportError("Couldn't read that file — it isn't valid JSON.");
      setImporting(false);
      return;
    }
    if (!items || items.length === 0) {
      setImportError("That file doesn't look like a Little Gerry KB manifest (no items found).");
      setImporting(false);
      return;
    }

    // Import in small batches so a large manifest (hundreds of documents) never
    // hinges on a single long-lived request, and the user sees live progress
    // with partial results preserved if one batch fails.
    const BATCH_SIZE = 20;
    const merged: ManifestImportResult = {
      imported: [], skipped: [], failed: [],
      imported_count: 0, skipped_count: 0, failed_count: 0,
    };
    setImportProgress({ done: 0, total: items.length });
    try {
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const chunk = items.slice(i, i + BATCH_SIZE);
        const r = await importManifest(chunk, false);
        merged.imported.push(...r.imported);
        merged.skipped.push(...r.skipped);
        merged.failed.push(...r.failed);
        merged.imported_count += r.imported_count;
        merged.skipped_count += r.skipped_count;
        merged.failed_count += r.failed_count;
        setImportResult({ ...merged });
        setImportProgress({ done: Math.min(i + BATCH_SIZE, items.length), total: items.length });
        if (r.imported_count > 0) onChanged();
      }
    } catch (e) {
      const partial = merged.imported_count > 0 ? ` (imported ${merged.imported_count} before stopping)` : "";
      setImportError(`${getErrorMessage(e)}${partial}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Share Knowledge Base</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {!connected && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Connect your Google account in Settings to link documents to Drive
                and import a manifest. Exporting works without it.
              </span>
            </div>
          )}

          {/* 1. Link uploads to Drive */}
          <section className="rounded-lg border p-4">
            <div className="mb-1 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">1 · Link uploads to Drive</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Matches documents you uploaded from your computer to the same file on
              your Google Drive (by name). Linked documents become update-trackable
              and can be shared in a manifest.
            </p>
            <button
              onClick={handleLink}
              disabled={linking || !connected}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {linking ? "Scanning…" : "Scan & link"}
            </button>
            {linkError && <p className="mt-2 text-xs text-destructive">{linkError}</p>}
            {linkResult && (
              <div className="mt-3 space-y-1 text-xs">
                <p className="font-medium text-foreground">
                  Linked {linkResult.linked_count} of {linkResult.scanned} unlinked document
                  {linkResult.scanned === 1 ? "" : "s"}.
                </p>
                {linkResult.ambiguous_count > 0 && (
                  <p className="text-amber-700">
                    {linkResult.ambiguous_count} need a manual choice (multiple Drive matches).
                  </p>
                )}
                {linkResult.not_found_count > 0 && (
                  <p className="text-muted-foreground">
                    {linkResult.not_found_count} had no matching file on Drive.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 2. Export manifest */}
          <section className="rounded-lg border p-4">
            <div className="mb-1 flex items-center gap-2">
              <Download className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">2 · Export manifest</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Saves <code className="rounded bg-muted px-1">littlegerry-kb.json</code> (for
              one-click import) and a readable{" "}
              <code className="rounded bg-muted px-1">littlegerry-kb.md</code> list with a
              Drive link per document. Share these with a teammate who has access to the
              same Drive files.
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? "Exporting…" : "Export manifest"}
            </button>
            {exportError && <p className="mt-2 text-xs text-destructive">{exportError}</p>}
            {exportMsg && <p className="mt-2 text-xs text-muted-foreground">{exportMsg}</p>}
          </section>

          {/* 3. Import manifest */}
          <section className="rounded-lg border p-4">
            <div className="mb-1 flex items-center gap-2">
              <FileUp className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">3 · Import manifest</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Choose a <code className="rounded bg-muted px-1">littlegerry-kb.json</code> file
              to import every document from Drive into your Knowledge Base. Identical files
              you already have are skipped automatically.
            </p>
            <button
              onClick={() => importInputRef.current?.click()}
              disabled={importing || !connected}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {importing
                ? importProgress
                  ? `Importing… ${importProgress.done}/${importProgress.total}`
                  : "Importing…"
                : "Choose manifest file"}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = "";
              }}
            />
            {importError && <p className="mt-2 text-xs text-destructive">{importError}</p>}
            {importResult && (
              <div className="mt-3 space-y-1 text-xs">
                <p className="font-medium text-foreground">
                  Imported {importResult.imported_count}, skipped {importResult.skipped_count} duplicate
                  {importResult.skipped_count === 1 ? "" : "s"}
                  {importResult.failed_count > 0 ? `, ${importResult.failed_count} failed` : ""}.
                </p>
                {importResult.failed.slice(0, 5).map((f) => (
                  <p key={f.title} className="text-destructive">
                    {f.title}: {f.error}
                  </p>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex justify-end border-t p-4">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function DocumentsPage() {
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [showDriveBrowser, setShowDriveBrowser] = useState(false);
  const [driveImportStatus, setDriveImportStatus] = useState<string | null>(null);
  const [driveImporting, setDriveImporting] = useState(false);
  const [driveImportProgress, setDriveImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editDoc, setEditDoc] = useState<Document | null>(null);
  const [viewDoc, setViewDoc] = useState<Document | null>(null);
  const [uploadError, setUploadError] = useState("");
  // Pending upload + duplicate-conflict state (for the "upload anyway" override).
  const [pendingUpload, setPendingUpload] = useState<{
    file: File;
    meta: { title: string; category_id?: string | null; is_regulated: boolean };
  } | null>(null);
  const [dupConflict, setDupConflict] = useState<DuplicateExisting | null>(null);
  // Manual duplicate scan.
  const [showDuplicates, setShowDuplicates] = useState(false);
  // Share / manifest modal.
  const [showShareKb, setShowShareKb] = useState(false);

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
      meta: { title: string; category_id?: string | null; is_regulated: boolean; force?: boolean };
    }) => uploadDocument(file, meta),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setShowUpload(false);
      setUploadError("");
      setPendingUpload(null);
      setDupConflict(null);
    },
    onError: (e: Error, variables) => {
      const existing = getDuplicateConflict(e);
      if (existing) {
        // Stash the attempt so the user can choose to import anyway.
        setPendingUpload({ file: variables.file, meta: variables.meta });
        setDupConflict(existing);
        setUploadError("");
      } else {
        setUploadError(getErrorMessage(e));
      }
    },
  });

  const scanDuplicatesMutation = useMutation<DuplicateScanResult, Error>({
    mutationFn: scanDuplicates,
    onSuccess: () => setShowDuplicates(true),
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

  const [checkStatus, setCheckStatus] = useState<string | null>(null);

  const checkUpdatesMutation = useMutation({
    mutationFn: checkDocumentUpdates,
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (summary.skipped === "not_connected") {
        setCheckStatus("Connect your Google account to check Drive documents.");
      } else if (summary.changed === 0) {
        setCheckStatus(`All ${summary.checked} linked document(s) are up to date.`);
      } else {
        setCheckStatus(
          `${summary.changed} document(s) have source changes. Review the flagged items below.`,
        );
      }
      setTimeout(() => setCheckStatus(null), 8000);
    },
    onError: (e: Error) => {
      setCheckStatus(`Update check failed: ${getErrorMessage(e)}`);
      setTimeout(() => setCheckStatus(null), 8000);
    },
  });

  const applyUpdateMutation = useMutation({
    mutationFn: (id: string) => applyDocumentUpdate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: Error) => {
      setCheckStatus(`Apply update failed: ${getErrorMessage(e)}`);
      setTimeout(() => setCheckStatus(null), 8000);
    },
  });

  const dismissUpdateMutation = useMutation({
    mutationFn: (id: string) => dismissDocumentUpdate(id),
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
    setDriveImportProgress({ current: 0, total: items.length });
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
      setDriveImportProgress({ current: i + 1, total: items.length });
    }
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    setDriveImporting(false);
    setDriveImportProgress(null);
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

  // Drag-and-drop anywhere on the page → opens the upload modal preloaded.
  const { isDragOver, dropProps } = useFileDrop(
    (files) => {
      setDroppedFiles(files);
      setUploadError("");
      setShowUpload(true);
    },
    {
      accept: [".pdf", ".docx", ".txt", ".md", ".csv"],
      disabled: showUpload,
      onRejected: (rejected) =>
        setUploadError(
          `Skipped (PDF, DOCX, TXT, MD, CSV only): ${rejected.map((f) => f.name).join(", ")}`,
        ),
    },
  );

  return (
    <div className="relative flex h-full gap-4 p-4" {...dropProps}>
      <DropOverlay show={isDragOver} label="Drop files to add them to the Knowledge Base" />
      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          categories={categories}
          initialFiles={droppedFiles}
          onClose={() => { setShowUpload(false); setUploadError(""); setDroppedFiles([]); }}
          onSubmit={(files, meta) => {
            for (const file of files) {
              uploadMutation.mutate({
                file,
                meta: {
                  ...meta,
                  title:
                    files.length === 1 && meta.title
                      ? meta.title
                      : file.name.replace(/\.[^.]+$/, ""),
                },
              });
            }
          }}
          uploading={uploadMutation.isPending}
          error={uploadError}
        />
      )}

      {/* Duplicate-on-upload confirmation */}
      {dupConflict && pendingUpload && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <Copy className="h-5 w-5 text-amber-500" />
              <h2 className="text-lg font-bold">Possible duplicate</h2>
            </div>
            <p className="mb-2 text-sm text-muted-foreground">
              This file is byte-for-byte identical to a document already in the
              Knowledge Base:
            </p>
            <p className="mb-4 rounded-md border bg-background px-3 py-2 text-sm font-medium">
              {dupConflict.title}
              {dupConflict.created_at && (
                <span className="ml-1 font-normal text-muted-foreground">
                  · added {timeAgo(dupConflict.created_at)}
                </span>
              )}
            </p>
            <p className="mb-5 text-xs text-muted-foreground">
              Importing again keeps a second copy. Most of the time you can skip it.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setDupConflict(null); setPendingUpload(null); }}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Skip (don’t import)
              </button>
              <button
                onClick={() =>
                  uploadMutation.mutate({
                    file: pendingUpload.file,
                    meta: { ...pendingUpload.meta, force: true },
                  })
                }
                disabled={uploadMutation.isPending}
                className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {uploadMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Import anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate scan results */}
      {showDuplicates && scanDuplicatesMutation.data && (
        <DuplicatesModal
          result={scanDuplicatesMutation.data}
          onClose={() => setShowDuplicates(false)}
          onDeleted={() => {
            queryClient.invalidateQueries({ queryKey: ["documents"] });
            scanDuplicatesMutation.mutate();
          }}
        />
      )}

      {/* Share Knowledge Base (Drive link + manifest) */}
      {showShareKb && (
        <ShareKbModal
          connected={!!googleStatus?.connected}
          onClose={() => setShowShareKb(false)}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ["documents"] })}
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
                onClick={() => checkUpdatesMutation.mutate()}
                disabled={checkUpdatesMutation.isPending}
                className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
                title="Check Drive-linked documents for source changes"
              >
                {checkUpdatesMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                Check for updates
              </button>
            )}
            {googleStatus?.connected && (
              <button
                onClick={() => setShowDriveBrowser(true)}
                className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Import from Drive
              </button>
            )}
            <button
              onClick={() => scanDuplicatesMutation.mutate()}
              disabled={scanDuplicatesMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
              title="Scan the Knowledge Base for byte-identical duplicate files"
            >
              {scanDuplicatesMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Files className="h-4 w-4" />}
              Find duplicates
            </button>
            <button
              onClick={() => setShowShareKb(true)}
              className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              title="Link documents to Drive and export/import a shareable manifest"
            >
              <Share2 className="h-4 w-4" />
              Share KB
            </button>
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

        {/* Update-check status toast */}
        {checkStatus && (
          <div className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm text-muted-foreground">
            {checkStatus}
          </div>
        )}

        {/* Drive browser modal */}
        {showDriveBrowser && (
          <DriveBrowser
            onClose={() => { if (!driveImporting) setShowDriveBrowser(false); }}
            onSelect={handleDriveImport}
            importing={driveImporting}
            importStatus={driveImportStatus}
            importProgress={driveImportProgress}
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
              onApplyUpdate={() => applyUpdateMutation.mutate(doc.id)}
              onDismissUpdate={() => dismissUpdateMutation.mutate(doc.id)}
              applyingUpdate={applyUpdateMutation.isPending && applyUpdateMutation.variables === doc.id}
              dismissingUpdate={dismissUpdateMutation.isPending && dismissUpdateMutation.variables === doc.id}
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
