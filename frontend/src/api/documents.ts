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

// ── Knowledge Base sharing (Drive link + manifest) ────────────────────────────

export interface LinkToDriveResult {
  scanned: number;
  linked: { id: string; title: string; drive_url: string }[];
  ambiguous: { id: string; title: string; file_name?: string; candidates?: number; reason?: string }[];
  not_found: { id: string; title: string; file_name?: string }[];
  linked_count: number;
  ambiguous_count: number;
  not_found_count: number;
}

export interface KbManifestItem {
  title: string;
  category: string | null;
  is_regulated: boolean;
  source_id: string;
  source_name: string | null;
  drive_url: string;
  mime_type: string | null;
  file_name: string | null;
}

export interface KbManifest {
  version: number;
  generated_at: string;
  count: number;
  items: KbManifestItem[];
}

export interface ManifestImportResult {
  imported: { id: string; title: string }[];
  skipped: { title: string; existing: string }[];
  failed: { title: string; error: string }[];
  imported_count: number;
  skipped_count: number;
  failed_count: number;
}

export interface ManifestSaveResult {
  count: number;
  directory: string;
  json_path: string;
  md_path: string;
}

/** Match locally-uploaded documents to their Drive original and link them. */
export async function linkUploadsToDrive(): Promise<LinkToDriveResult> {
  const { data } = await apiClient.post<ApiResponse<LinkToDriveResult>>(
    "/documents/link-to-drive",
  );
  return data.data!;
}

/** Export a portable manifest of every Drive-linked Knowledge Base document. */
export async function exportManifest(): Promise<KbManifest> {
  const { data } = await apiClient.get<ApiResponse<KbManifest>>(
    "/documents/manifest",
  );
  return data.data!;
}

/**
 * Write the KB manifest (JSON + Markdown) to the user's Downloads folder.
 *
 * The app runs in a desktop webview where browser blob downloads silently fail,
 * so the backend writes the files directly and returns where they landed.
 */
export async function saveManifest(): Promise<ManifestSaveResult> {
  const { data } = await apiClient.post<ApiResponse<ManifestSaveResult>>(
    "/documents/manifest/save",
  );
  return data.data!;
}

/** Import documents listed in a KB manifest (re-imports from Drive). */
export async function importManifest(
  items: KbManifestItem[],
  force = false,
): Promise<ManifestImportResult> {
  const payload = {
    items: items.map((i) => ({
      source_id: i.source_id,
      title: i.title,
      category: i.category,
      is_regulated: i.is_regulated,
    })),
    force,
  };
  const { data } = await apiClient.post<ApiResponse<ManifestImportResult>>(
    "/documents/manifest/import",
    payload,
  );
  return data.data!;
}

