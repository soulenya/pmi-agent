// ── Audit Trail ────────────────────────────────────────────────────────────────

export interface AuditEvent {
  id: string;
  sequence_number: number;
  event_type: string;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  ip_address: string | null;
  record_hash: string;
  previous_hash: string;
  created_at: string;
}

export interface AuditListMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface AuditListResponse {
  data: AuditEvent[];
  ok: boolean;
  meta: AuditListMeta;
}

export interface AuditVerifyResponse {
  data: {
    verified: number;
    broken_sequences: number[];
    chain_intact: boolean;
  };
  ok: boolean;
  meta: null;
}
