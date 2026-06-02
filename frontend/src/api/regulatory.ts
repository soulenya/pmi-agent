import { apiClient } from "./client";
import type {
  CAPA,
  CAPACreate,
  RegDoc,
  RegDocCreate,
  RegDocUpdate,
  RiskItem,
  RiskItemCreate,
  Briefing,
} from "@/types/regulatory";

// ── Regulatory Documents ──────────────────────────────────────────────────────

export async function listRegDocs(params?: {
  doc_type?: string;
  status?: string;
}): Promise<RegDoc[]> {
  const resp = await apiClient.get<RegDoc[]>("/regulatory", { params });
  return resp.data;
}

export async function createRegDoc(body: RegDocCreate): Promise<RegDoc> {
  const resp = await apiClient.post<RegDoc>("/regulatory", body);
  return resp.data;
}

export async function updateRegDoc(id: string, body: RegDocUpdate): Promise<RegDoc> {
  const resp = await apiClient.patch<RegDoc>(`/regulatory/${id}`, body);
  return resp.data;
}

export async function deleteRegDoc(id: string): Promise<void> {
  await apiClient.delete(`/regulatory/${id}`);
}

// ── CAPAs ──────────────────────────────────────────────────────────────────────

export async function listCapas(status?: string): Promise<CAPA[]> {
  const resp = await apiClient.get<CAPA[]>("/capas", {
    params: status ? { status } : undefined,
  });
  return resp.data;
}

export async function createCapa(body: CAPACreate): Promise<CAPA> {
  const resp = await apiClient.post<CAPA>("/capas", body);
  return resp.data;
}

export async function updateCapa(
  id: string,
  body: Partial<CAPACreate & { status: string; root_cause: string; corrective_action: string; preventive_action: string }>
): Promise<CAPA> {
  const resp = await apiClient.patch<CAPA>(`/capas/${id}`, body);
  return resp.data;
}

// ── Briefings ─────────────────────────────────────────────────────────────────

export async function getTodayBriefing(refresh = false): Promise<Briefing> {
  const resp = await apiClient.get<Briefing>("/briefings/today", {
    params: refresh ? { refresh: true } : undefined,
  });
  return resp.data;
}

// ── Risk Items ────────────────────────────────────────────────────────────────

export async function listRiskItems(regulatory_doc_id?: string): Promise<RiskItem[]> {
  const resp = await apiClient.get<RiskItem[]>("/regulatory/risks", {
    params: regulatory_doc_id ? { regulatory_doc_id } : undefined,
  });
  return resp.data;
}

export async function createRiskItem(docId: string, body: RiskItemCreate): Promise<RiskItem> {
  const resp = await apiClient.post<RiskItem>(`/regulatory/${docId}/risks`, body);
  return resp.data;
}

export async function updateRiskItem(
  itemId: string,
  body: Partial<RiskItemCreate>,
): Promise<RiskItem> {
  const resp = await apiClient.patch<RiskItem>(`/regulatory/risks/${itemId}`, body);
  return resp.data;
}

export async function deleteRiskItem(itemId: string): Promise<void> {
  await apiClient.delete(`/regulatory/risks/${itemId}`);
}
