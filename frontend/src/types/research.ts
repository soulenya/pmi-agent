export type ResearchStatus = "in_progress" | "completed" | "failed" | "archived";

export interface ResearchSource {
  id: string;
  title: string | null;
  url: string;
  domain: string | null;
  snippet: string | null;
  relevance_score: number | null;
  retrieved_at: string;
}

export interface ResearchReport {
  id: string;
  title: string;
  query: string;
  summary: string | null;
  full_report: string | null;
  status: ResearchStatus;
  tags: string[];
  sources: ResearchSource[];
  created_at: string;
  created_by: string | null;
  ingested_as_document_id: string | null;
}

export interface RunResearchRequest {
  query: string;
  title?: string;
  tags?: string[];
  max_results?: number;
  ingest_to_kb?: boolean;
}
