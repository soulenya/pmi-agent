import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { semanticSearch } from "@/api/documents";
import type { SearchResult } from "@/types/documents";
import { Search, Loader2, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.8
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
      : score >= 0.6
        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
        : "bg-muted text-muted-foreground";

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", color)}>
      {pct}% match
    </span>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <button
          onClick={() => navigate(`/documents`)}
          className="flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          {result.document_title}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {result.page_number != null && (
            <span className="text-xs text-muted-foreground">
              p.{result.page_number}
            </span>
          )}
          <ScoreBadge score={result.score} />
        </div>
      </div>

      <p
        className={cn(
          "text-sm text-muted-foreground",
          !expanded && "line-clamp-3",
        )}
      >
        {result.content}
      </p>

      {result.content.length > 200 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);

  const searchMutation = useMutation({
    mutationFn: () => semanticSearch({ query: query.trim(), top_k: topK }),
  });

  const handleSearch = () => {
    if (query.trim().length < 2) return;
    searchMutation.mutate();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Semantic Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search the knowledge base using natural language.
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="e.g. suction pressure requirements for VACTOR"
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={topK}
          onChange={(e) => setTopK(Number(e.target.value))}
          className="rounded-md border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {[3, 5, 10, 15, 20].map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
        </select>
        <button
          onClick={handleSearch}
          disabled={!query.trim() || searchMutation.isPending}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {searchMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Search
        </button>
      </div>

      {/* Error */}
      {searchMutation.isError && (
        <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Search failed — is Ollama running with nomic-embed-text?
        </p>
      )}

      {/* Results */}
      {searchMutation.data && (
        <>
          <p className="text-xs text-muted-foreground">
            {searchMutation.data.length} result
            {searchMutation.data.length !== 1 ? "s" : ""}
          </p>
          <div className="space-y-3">
            {searchMutation.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching chunks found.</p>
            ) : (
              searchMutation.data.map((r) => (
                <ResultCard key={r.chunk_id} result={r} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
