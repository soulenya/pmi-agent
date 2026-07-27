import { apiClient } from "./client";

// ── Vision document extraction ───────────────────────────────────────────────

export interface ExtractionSchema {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface ExtractionResult {
  id: string;
  status: "ok" | "error";
  error: string | null;
  file_name: string;
  model: string;
  pages: number | null;
  structured: Record<string, unknown> | null;
  raw_text: string;
  raw_text_truncated: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
}

export type ExtractionSourceKind =
  | "chat_attachment"
  | "regulatory_node"
  | "generated_file";

export async function listExtractionSchemas(): Promise<ExtractionSchema[]> {
  const { data } = await apiClient.get<ExtractionSchema[]>("/extractions/schemas");
  return data;
}

export async function saveExtractionSchemas(
  schemas: ExtractionSchema[],
): Promise<ExtractionSchema[]> {
  const { data } = await apiClient.put<ExtractionSchema[]>("/extractions/schemas", {
    schemas,
  });
  return data;
}

export async function runExtraction(body: {
  source_kind: ExtractionSourceKind;
  source_ref: string;
  schema_name?: string;
  instruction?: string;
}): Promise<ExtractionResult> {
  const { data } = await apiClient.post<ExtractionResult>("/extractions/run", body, {
    timeout: 5 * 60 * 1000,
  });
  return data;
}
