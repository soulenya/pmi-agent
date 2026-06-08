// Document and search TypeScript types

export interface DocumentCategory {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  category_id: string | null;
  title: string;
  source_type: string;
  source_uri: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  checksum_sha256: string | null;
  is_regulated: boolean;
  status: "processing" | "ready" | "failed";
  chunk_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Source-update tracking (Google Drive sync)
  source_id?: string | null;
  source_name?: string | null;
  sync_status?: "current" | "modified" | "renamed" | "deleted" | null;
  sync_detail?: string | null;
  source_modified_at?: string | null;
  last_synced_at?: string | null;
  last_checked_at?: string | null;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
}

export interface SearchRequest {
  query: string;
  top_k?: number;
  category_id?: string | null;
}

export interface SearchResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  page_number: number | null;
  content: string;
  score: number;
}
