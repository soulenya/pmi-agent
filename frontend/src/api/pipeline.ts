/**
 * The sales pipeline. One list for the whole company, kept on the hub: a
 * desktop reaches it through the hub proxy, a browser on the hub directly,
 * and both use the same path.
 */
import { apiClient } from "@/api/client";

const P = "/hub/api/pipeline";

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  /** Open leads in this stage. */
  open: number;
}

export type LeadStatus = "open" | "won" | "lost";

export interface PipelineLead {
  id: string;
  title: string;
  company: string;
  contact_name: string;
  contact_title: string;
  email: string;
  phone: string;
  address: string;
  stage_id: string;
  stage: string;
  status: LeadStatus;
  value: number | null;
  next_step: string;
  next_step_due: string | null;
  owner_name: string;
  details: string;
  source: string;
  created_at: string | null;
  updated_at: string | null;
  note_count: number;
  last_note_at: string | null;
}

export interface PipelineNote {
  id: string;
  kind: "note" | "email" | "event";
  body: string;
  author_name: string;
  occurred_at: string | null;
}

export type PipelineLeadDetail = PipelineLead & { notes: PipelineNote[] };

export type LeadChanges = Partial<
  Pick<
    PipelineLead,
    | "title" | "company" | "contact_name" | "contact_title" | "email" | "phone" | "address"
    | "stage_id" | "status" | "value" | "next_step" | "next_step_due" | "details"
  >
>;

export interface ImportReport {
  dry_run: boolean;
  stages: { new: string[]; existing: number };
  leads: { new: number; existing: number; by_stage: Record<string, number> };
  notes: { new: number; skipped: number };
  owners_without_account: string[];
}

export async function listStages(): Promise<PipelineStage[]> {
  return (await apiClient.get<PipelineStage[]>(`${P}/stages`)).data;
}

export async function listLeads(params: { stage_id?: string; status?: LeadStatus | ""; q?: string }): Promise<PipelineLead[]> {
  return (await apiClient.get<PipelineLead[]>(`${P}/leads`, { params })).data;
}

export async function getLead(id: string): Promise<PipelineLeadDetail> {
  return (await apiClient.get<PipelineLeadDetail>(`${P}/leads/${id}`)).data;
}

export async function createLead(body: LeadChanges): Promise<PipelineLeadDetail> {
  return (await apiClient.post<PipelineLeadDetail>(`${P}/leads`, body)).data;
}

export async function updateLead(id: string, body: LeadChanges): Promise<PipelineLeadDetail> {
  return (await apiClient.patch<PipelineLeadDetail>(`${P}/leads/${id}`, body)).data;
}

export async function addLeadNote(id: string, body: string): Promise<PipelineLeadDetail> {
  return (await apiClient.post<PipelineLeadDetail>(`${P}/leads/${id}/notes`, { body })).data;
}

export async function importFromOdoo(dryRun: boolean): Promise<ImportReport> {
  return (await apiClient.post<ImportReport>(`${P}/import/odoo`, { dry_run: dryRun })).data;
}

export interface InquiryReport {
  /** Messages opened this time. */
  read: number;
  new_leads: number;
  /** Inquiries from someone who already has an open lead, added to that lead's history. */
  added_to_existing: number;
  already_here: number;
  /** Titles of the new leads. */
  titles: string[];
  /** Gmail asked it to slow down, or there is a backlog: the hub carries on by itself. */
  more_to_read: boolean;
}

/** Look in the signed-in person's own Gmail for website form submissions now. The hub also does this every few minutes. */
export async function checkWebsiteInquiries(): Promise<InquiryReport> {
  return (await apiClient.post<InquiryReport>(`${P}/inquiries/check`, {}, { timeout: 120_000 })).data;
}
