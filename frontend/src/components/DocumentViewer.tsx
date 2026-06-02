import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  FileText,
  FileBadge,
  CheckCircle2,
  Clock,
  AlertCircle,
  Search,
  RefreshCw,
  Pencil,
  ChevronDown,
  ChevronUp,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listChunks } from "@/api/documents";
import type { Document, DocumentChunk } from "@/types/documents";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  ready: {
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
    label: "Ready",
    classes: "bg-green-100 text-green-700",
  },
  processing: {
    icon: <Clock className="h-3.5 w-3.5 text-yellow-500 animate-pulse" />,
    label: "Processing…",
    classes: "bg-yellow-100 text-yellow-700",
  },
  failed: {
    icon: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
    label: "Failed",
    classes: "bg-red-100 text-red-700",
  },
} satisfies Record<Document["status"], { icon: React.ReactNode; label: string; classes: string }>;

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

// ── Chunk card ────────────────────────────────────────────────────────────────

function ChunkCard({
  chunk,
  query,
}: {
  chunk: DocumentChunk;
  query: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = chunk.content.length > 400;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      {/* Meta row */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Hash className="h-3 w-3" />
        <span className="font-mono font-medium">Chunk {chunk.chunk_index + 1}</span>
        {chunk.page_number != null && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span>Page {chunk.page_number}</span>
          </>
        )}
        {chunk.token_count != null && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="ml-auto">{chunk.token_count} tokens</span>
          </>
        )}
      </div>

      {/* Content */}
      <p
        className={cn(
          "text-sm leading-relaxed whitespace-pre-wrap",
          !expanded && isLong && "line-clamp-5"
        )}
      >
        {highlight(chunk.content, query)}
      </p>

      {isLong && (
        <button
          onClick={() => setExpanded((x) => !x)}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Show more
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ── DocumentViewer ────────────────────────────────────────────────────────────

interface DocumentViewerProps {
  doc: Document;
  categoryName: string | undefined;
  onClose: () => void;
  onEdit: () => void;
  onReembed: () => void;
}

export function DocumentViewer({
  doc,
  categoryName,
  onClose,
  onEdit,
  onReembed,
}: DocumentViewerProps) {
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: chunks = [], isLoading } = useQuery({
    queryKey: ["chunks", doc.id],
    queryFn: () => listChunks(doc.id),
    staleTime: 120_000,
  });

  // Escape key closes panel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const statusCfg = STATUS_CONFIG[doc.status];

  const filtered = query.trim()
    ? chunks.filter((c) =>
        c.content.toLowerCase().includes(query.toLowerCase())
      )
    : chunks;

  return (
    <>
      {/* Backdrop (click to close) */}
      <div
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-40 flex w-full max-w-2xl flex-col border-l bg-background shadow-2xl"
      >
        {/* Panel header */}
        <div className="flex items-start gap-3 border-b bg-card px-5 py-4">
          <div className="mt-0.5 shrink-0">
            {doc.is_regulated ? (
              <FileBadge className="h-5 w-5 text-orange-500" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <h2 className="text-base font-semibold leading-snug">{doc.title}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  statusCfg.classes
                )}
              >
                {statusCfg.icon}
                {statusCfg.label}
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
            <p className="text-xs text-muted-foreground">
              {doc.file_extension?.toUpperCase().replace(".", "") ?? "—"}
              {" · "}
              {formatBytes(doc.file_size_bytes)}
              {" · "}
              {doc.chunk_count} chunk{doc.chunk_count !== 1 ? "s" : ""}
              {" · "}
              uploaded{" "}
              {new Date(doc.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Edit metadata"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={onReembed}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
              title="Re-embed document"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="border-b px-5 py-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search within document…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <span className="text-xs text-muted-foreground">
                {filtered.length}/{chunks.length} chunks
              </span>
            )}
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Chunk list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              <Clock className="h-4 w-4 animate-spin mr-2" />
              Loading chunks…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <FileText className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {query ? "No chunks match your search." : "No content extracted yet."}
              </p>
            </div>
          ) : (
            filtered.map((chunk) => (
              <ChunkCard key={chunk.id} chunk={chunk} query={query} />
            ))
          )}
        </div>

        {/* Footer */}
        {!isLoading && filtered.length > 0 && (
          <div className="border-t px-5 py-2 text-right text-xs text-muted-foreground">
            {filtered.length} chunk{filtered.length !== 1 ? "s" : ""}
            {query ? ` matching "${query}"` : " total"}
          </div>
        )}
      </div>
    </>
  );
}
