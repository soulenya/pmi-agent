import { apiClient } from "./client";
import type { ApiResponse } from "@/types";
import type { Document, DocumentCategory, DocumentChunk, SearchRequest, SearchResult } from "@/types/documents";

// ── Categories ────────────────────────────────────────────────────────────────

export async function listCategories(): Promise<DocumentCategory[]> {
  const { data } = await apiClient.get<ApiResponse<DocumentCategory[]>>(
    "/documents/categories",
  );
  return data.data ?? [];
}

// ── Documents ─────────────────────────────────────────────────────────────────

export async function listDocuments(params?: {
  category_id?: string;
}): Promise<Document[]> {
  // The backend paginates (max 100 per page) — fetch every page so the
  // knowledge base view always shows all documents, however many exist.
  const all: Document[] = [];
  let page = 1;
  for (;;) {
    const { data } = await apiClient.get<ApiResponse<Document[]>>("/documents", {
      params: { ...params, page, page_size: 100 },
    });
    const batch = data.data ?? [];
    all.push(...batch);
    const total = data.meta?.total ?? all.length;
    if (batch.length === 0 || all.length >= total) break;
    page += 1;
  }
  return all;
}

export async function getDocument(id: string): Promise<Document> {
  const { data } = await apiClient.get<ApiResponse<Document>>(`/documents/${id}`);
  return data.data!;
}

export async function uploadDocument(
  file: File,
  meta: { title: string; category_id?: string | null; is_regulated?: boolean; force?: boolean },
): Promise<Document> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", meta.title);
  if (meta.category_id) form.append("category_id", meta.category_id);
  form.append("is_regulated", String(meta.is_regulated ?? false));
  form.append("force", String(meta.force ?? false));

  const { data } = await apiClient.post<ApiResponse<Document>>(
    "/documents/upload",
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data.data!;
}

export async function updateDocument(
  id: string,
  updates: { title?: string; category_id?: string | null; is_regulated?: boolean },
): Promise<Document> {
  const { data } = await apiClient.patch<ApiResponse<Document>>(
    `/documents/${id}`,
    updates,
  );
  return data.data!;
}

export async function deleteDocument(id: string): Promise<void> {
  await apiClient.delete(`/documents/${id}`);
}

export async function listChunks(id: string): Promise<DocumentChunk[]> {
  const { data } = await apiClient.get<ApiResponse<DocumentChunk[]>>(`/documents/${id}/chunks`);
  return data.data ?? [];
}

export async function reembed(id: string): Promise<Document> {
  const { data } = await apiClient.post<ApiResponse<Document>>(`/documents/${id}/reembed`);
  return data.data!;
}

// ── Source update detection (Google Drive sync) ───────────────────────────────

export interface CheckUpdatesSummary {
  checked: number;
  changed: number;
  errors: number;
  items: {
    id: string;
    title: string;
    sync_status: string;
    detail: string | null;
  }[];
  skipped?: string;
}

export async function checkDocumentUpdates(): Promise<CheckUpdatesSummary> {
  const { data } = await apiClient.post<ApiResponse<CheckUpdatesSummary>>(
    "/documents/check-updates",
  );
  return data.data!;
}

export async function applyDocumentUpdate(id: string): Promise<Document> {
  const { data } = await apiClient.post<ApiResponse<Document>>(
    `/documents/${id}/apply-update`,
  );
  return data.data!;
}

export async function dismissDocumentUpdate(id: string): Promise<Document> {
  const { data } = await apiClient.post<ApiResponse<Document>>(
    `/documents/${id}/dismiss-update`,
  );
  return data.data!;
}


// ── Search ────────────────────────────────────────────────────────────────────

export async function semanticSearch(
  req: SearchRequest,
): Promise<SearchResult[]> {
  const { data } = await apiClient.post<ApiResponse<SearchResult[]>>(
    "/search",
    req,
  );
  return data.data ?? [];
}

// ── Duplicate detection ───────────────────────────────────────────────────────

export interface DuplicateGroup {
  checksum: string;
  count: number;
  documents: Document[];
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[];
  group_count: number;
  redundant_count: number;
}

export async function scanDuplicates(): Promise<DuplicateScanResult> {
  const { data } = await apiClient.get<ApiResponse<DuplicateScanResult>>(
    "/documents/duplicates",
  );
  return data.data!;
}
