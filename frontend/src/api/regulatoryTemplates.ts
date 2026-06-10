import { apiClient } from "./client";
import type { RegNode } from "./regulatoryFiles";

// ── Regulatory template wizard ──────────────────────────────────────────────

export interface RegTemplateInfo {
  key: string;
  label: string;
  category: string;
  description: string;
  related_standards: string[];
  default_sections: string[];
  recommended_format: string;
}

export interface RegFormatRecommendation {
  format: "docx" | "md";
  sections: string[];
  rationale: string;
}

export interface RegGenerateRequest {
  template_key: string;
  title: string;
  doc_number?: string | null;
  sections: string[];
  format: "docx" | "md";
  auto_populate: boolean;
  notes?: string | null;
  parent_id?: string | null;
}

export interface RegReviewTaskSuggestion {
  title: string;
  description: string;
  priority: string;
  due_date: string;
  tags: string[];
}

export interface RegGenerateResult {
  node: RegNode;
  review_task: RegReviewTaskSuggestion;
}

const BASE = "/regulatory-templates";

export async function listRegTemplates(): Promise<RegTemplateInfo[]> {
  const r = await apiClient.get<RegTemplateInfo[]>(BASE);
  return r.data;
}

export async function recommendRegFormat(body: {
  template_key: string;
  title: string;
  notes?: string | null;
}): Promise<RegFormatRecommendation> {
  const r = await apiClient.post<RegFormatRecommendation>(`${BASE}/recommend`, body);
  return r.data;
}

export async function generateRegDocument(
  body: RegGenerateRequest,
): Promise<RegGenerateResult> {
  const r = await apiClient.post<RegGenerateResult>(`${BASE}/generate`, body);
  return r.data;
}
