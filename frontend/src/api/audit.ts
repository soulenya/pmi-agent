import { apiClient } from "./client";
import type { AuditListResponse, AuditVerifyResponse } from "@/types/audit";

// ── Audit Events ──────────────────────────────────────────────────────────────

export async function listAuditEvents(params?: {
  page?: number;
  page_size?: number;
  event_type?: string;
  actor_id?: string;
}): Promise<AuditListResponse> {
  const resp = await apiClient.get<AuditListResponse>("/audit/events", { params });
  return resp.data;
}

export async function verifyAuditChain(limit = 1000): Promise<AuditVerifyResponse> {
  const resp = await apiClient.post<AuditVerifyResponse>("/audit/verify", null, {
    params: { limit },
  });
  return resp.data;
}
