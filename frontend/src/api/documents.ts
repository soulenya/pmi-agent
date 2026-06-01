import apiClient from "./client";
import type { ApiResponse } from "@/types";
import type { Document, DocumentCategory, SearchRequest, SearchResult } from "@/types/documents";

// ── Categories ────────────────────────────────────────────────────────────────

export async function listCategories(): Promise<DocumentCategory[]> {
  const { data } = await apiClient.get<ApiResponse<DocumentCategory[]>>(
    "/documents/categories",
  );
  return data.data;
}

// ── Documents ─────────────────────────────────────────────────────────────────

export async function listDocuments(params?: {
  category_id?: string;
  limit?: number;
  offset?: number;
}): Promise<Document[]> {
  const { data } = await apiClient.get<ApiResponse<Document[]>>("/documents", {
    params,
  });
  return data.data;
}

export async function getDocument(id: string): Promise<Document> {
  const { data } = await apiClient.get<ApiResponse<Document>>(`/documents/${id}`);
  return data.data;
}

export async function uploadDocument(
  file: File,
  meta: { title: string; category_id?: string | null; is_regulated?: boolean },
): Promise<Document> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", meta.title);
  if (meta.category_id) form.append("category_id", meta.category_id);
  form.append("is_regulated", String(meta.is_regulated ?? false));

  const { data } = await apiClient.post<ApiResponse<Document>>(
    "/documents/upload",
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data.data;
}

export async function updateDocument(
  id: string,
  updates: { title?: string; category_id?: string | null; is_regulated?: boolean },
): Promise<Document> {
  const { data } = await apiClient.patch<ApiResponse<Document>>(
    `/documents/${id}`,
    updates,
  );
  return data.data;
}

export async function deleteDocument(id: string): Promise<void> {
  await apiClient.delete(`/documents/${id}`);
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function semanticSearch(
  req: SearchRequest,
): Promise<SearchResult[]> {
  const { data } = await apiClient.post<ApiResponse<SearchResult[]>>(
    "/search",
    req,
  );
  return data.data;
}
