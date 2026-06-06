import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { semanticSearch, listCategories } from "@/api/documents";
import type { SearchResult } from "@/types/documents";
import { Search, Loader2, FileText, Clock, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

const HISTORY_KEY = "pmi-search-history";
const MAX_HISTORY = 10;

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); }
  catch { return []; }
}

function saveHistory(query: string) {
  const prev = loadHistory().filter((q) => q !== query);
  const next = [query, ...prev].slice(0, MAX_HISTORY);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

function removeHistory(query: string) {
  const next = loadHistory().filter((q) => q !== query);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

// Highlight occurrences of `term` in `text` (case-insensitive)
function highlight(text: string, term: string): React.ReactNode {
  if (!term.trim()) return text;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === term.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/50 text-foreground rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

// ── Score badge ───────────────────────────────────────────────────────────────

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

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ result, searchTerm }: { result: SearchResult; searchTerm: string }) {
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
            <span className="text-xs text-muted-foreground">p.{result.page_number}</span>
          )}
          <ScoreBadge score={result.score} />
        </div>
      </div>

      <p className={cn("text-sm text-muted-foreground", !expanded && "line-clamp-3")}>
        {highlight(result.content, searchTerm)}
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

// ── Search page ───────────────────────────────────────────────────────────────

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [categoryId, setCategoryId] = useState("");
  const [history, setHistory] = useState<string[]>(loadHistory);

  // Reload history after mutations
  const refreshHistory = () => setHistory(loadHistory());

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
    staleTime: 5 * 60_000,
  });

  const searchMutation = useMutation({
    mutationFn: () =>
      semanticSearch({
        query: query.trim(),
        top_k: topK,
        category_id: categoryId || null,
      }),
    onSuccess: () => {
      saveHistory(query.trim());
      refreshHistory();
    },
  });

  const handleSearch = () => {
    if (query.trim().length < 2) return;
    searchMutation.mutate();
  };

  const applyHistoryItem = (q: string) => {
    setQuery(q);
  };

  const deleteHistoryItem = (q: string) => {
    removeHistory(q);
    refreshHistory();
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
            <option key={n} value={n}>Top {n}</option>
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

      {/* Category filter */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Filter by category:</span>
          <button
            onClick={() => setCategoryId("")}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs transition-colors border",
              categoryId === ""
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground hover:bg-accent border-transparent"
            )}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryId(cat.id === categoryId ? "" : cat.id)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs transition-colors border",
                categoryId === cat.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground hover:bg-accent border-transparent"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Recent queries */}
      {history.length > 0 && !searchMutation.data && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3" /> Recent searches
          </p>
          <div className="flex flex-wrap gap-1.5">
            {history.map((q) => (
              <span key={q} className="flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-xs">
                <button
                  onClick={() => applyHistoryItem(q)}
                  className="hover:text-foreground text-muted-foreground transition-colors"
                >
                  {q}
                </button>
                <button
                  onClick={() => deleteHistoryItem(q)}
                  className="text-muted-foreground/50 hover:text-muted-foreground ml-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {searchMutation.isError && (
        <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Search failed —{" "}
          {(searchMutation.error as Error)?.message?.includes("503") || (searchMutation.error as Error)?.message?.includes("Embedding")
            ? "Embedding service unavailable. Check that Ollama is running with nomic-embed-text at the URL configured in Settings."
            : ((searchMutation.error as Error)?.message ?? "Unknown error. Check that the backend is running.")}
        </p>
      )}

      {/* Results */}
      {searchMutation.data && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {searchMutation.data.length} result{searchMutation.data.length !== 1 ? "s" : ""}
              {categoryId && (
                <span className="ml-1">
                  in <span className="font-medium">{categories.find((c) => c.id === categoryId)?.name ?? categoryId}</span>
                </span>
              )}
            </p>
            <button
              onClick={() => { setQuery(""); searchMutation.reset(); }}
              className="text-xs text-muted-foreground hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="space-y-3">
            {searchMutation.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching chunks found.</p>
            ) : (
              searchMutation.data.map((r) => (
                <ResultCard key={r.chunk_id} result={r} searchTerm={query} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

