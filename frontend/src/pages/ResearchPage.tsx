import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical,
  Search,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronUp,
  BookMarked,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listResearchReports, runResearch, deleteResearchReport } from "@/api/research";
import type { ResearchReport, RunResearchRequest } from "@/types/research";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    failed: "bg-red-100 text-red-700",
    archived: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", map[status] ?? map.archived)}>
      {status.replace("_", " ")}
    </span>
  );
}

// ── Research form ─────────────────────────────────────────────────────────────

function RunResearchForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [maxResults, setMaxResults] = useState(8);
  const [ingestToKb, setIngestToKb] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: RunResearchRequest) => runResearch(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["research"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    mutation.mutate({
      query: query.trim(),
      title: title.trim() || undefined,
      max_results: maxResults,
      ingest_to_kb: ingestToKb,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border bg-card p-5 space-y-4 shadow-sm"
    >
      <h3 className="font-semibold text-base">New Research Query</h3>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium">Query *</label>
        <textarea
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. FDA 510(k) requirements for suction devices 2024"
          rows={2}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium">Report Title (optional)</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Auto-generated from query if blank"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex items-center gap-6">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Results</label>
          <select
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value))}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value={5}>5</option>
            <option value={8}>8</option>
            <option value={12}>12</option>
            <option value={20}>20</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer mt-4">
          <input
            type="checkbox"
            checked={ingestToKb}
            onChange={(e) => setIngestToKb(e.target.checked)}
            className="rounded"
          />
          Save to Knowledge Base
        </label>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={!query.trim() || mutation.isPending}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Researching…
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" />
              Run Research
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          Cancel
        </button>
      </div>

      {mutation.isError && (
        <p className="text-xs text-destructive">
          Research failed. Check that the backend and Ollama are running.
        </p>
      )}
    </form>
  );
}

// ── Report card ───────────────────────────────────────────────────────────────

function ReportCard({ report }: { report: ResearchReport }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteResearchReport(report.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research"] }),
  });

  const date = new Date(report.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm truncate">{report.title}</span>
            <StatusBadge status={report.status} />
            {report.ingested_as_document_id && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <BookMarked className="h-3 w-3" /> In KB
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {date} · {report.sources.length} source{report.sources.length !== 1 ? "s" : ""}
          </p>
          {report.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {report.tags.map((t) => (
                <span key={t} className="rounded-full bg-muted px-2 py-px text-xs">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded((x) => !x)}
            className="rounded p-1 hover:bg-accent text-muted-foreground"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="rounded p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Summary */}
      {report.summary && (
        <div className="border-t px-4 py-3">
          <p className="text-sm text-foreground/80 leading-relaxed">{report.summary}</p>
        </div>
      )}

      {/* Expanded: sources + full report */}
      {expanded && (
        <div className="border-t">
          {/* Sources */}
          {report.sources.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Sources
              </p>
              <div className="space-y-2">
                {report.sources.map((src) => (
                  <div key={src.id} className="rounded-lg bg-muted/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                        >
                          {src.title || src.domain || src.url}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        {src.domain && (
                          <p className="text-xs text-muted-foreground">{src.domain}</p>
                        )}
                        {src.snippet && (
                          <p className="text-xs text-foreground/70 mt-1 line-clamp-2">
                            {src.snippet}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full report markdown (shown as pre-formatted text) */}
          {report.full_report && (
            <div className="border-t px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Full Report
              </p>
              <pre className="whitespace-pre-wrap text-xs text-foreground/80 font-sans leading-relaxed">
                {report.full_report}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ResearchPage() {
  const [showForm, setShowForm] = useState(false);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["research"],
    queryFn: listResearchReports,
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Research</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Web search + AI synthesis — all results archived for reference
          </p>
        </div>
        <button
          onClick={() => setShowForm((x) => !x)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Search className="h-4 w-4" />
          New Research
        </button>
      </div>

      {/* New research form */}
      {showForm && <RunResearchForm onClose={() => setShowForm(false)} />}

      {/* Report list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading reports…
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <FlaskConical className="h-10 w-10 opacity-30" />
          <p className="text-sm">No research reports yet.</p>
          <p className="text-xs">
            Click <span className="font-medium">New Research</span> to search the web and
            generate an AI-synthesised report.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}
