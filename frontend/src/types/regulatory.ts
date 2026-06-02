// TypeScript types for Regulatory Documents, Risk Items, and CAPAs

export interface RegDoc {
  id: string;
  document_id: string | null;
  doc_type: string;
  doc_number: string | null;
  title: string;
  revision: string;
  status: string;
  related_standards: string[];
  owner_id: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  effective_date: string | null;
  next_review_date: string | null;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegDocCreate {
  doc_type: string;
  title: string;
  doc_number?: string;
  revision?: string;
  related_standards?: string[];
  effective_date?: string;
  next_review_date?: string;
}

export interface RegDocUpdate {
  title?: string;
  doc_number?: string;
  revision?: string;
  status?: string;
  related_standards?: string[];
  effective_date?: string | null;
  next_review_date?: string | null;
}

export interface AIDraftResult {
  doc_id: string;
  content: string;
}

export interface RiskItem {
  id: string;
  regulatory_doc_id: string | null;
  hazard: string;
  hazardous_situation: string;
  harm: string;
  probability_before: number | null;
  severity_before: number | null;
  risk_score_before: number | null;
  mitigation_measures: string | null;
  probability_after: number | null;
  severity_after: number | null;
  risk_score_after: number | null;
  risk_acceptability: string | null;
  created_at: string;
  updated_at: string;
}

export interface CAPA {
  id: string;
  capa_number: string;
  title: string;
  description: string | null;
  capa_type: string;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  status: string;
  owner_id: string | null;
  due_date: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiskItemCreate {
  hazard: string;
  hazardous_situation: string;
  harm: string;
  probability_before?: number | null;
  severity_before?: number | null;
  mitigation_measures?: string | null;
  probability_after?: number | null;
  severity_after?: number | null;
  risk_acceptability?: string | null;
}

export interface CAPACreate {
  capa_number: string;
  title: string;
  description?: string;
  capa_type?: string;
  due_date?: string;
}

export interface Briefing {
  id: string;
  user_id: string;
  type: string;
  headline: string | null;
  priority_items: unknown[] | null;
  open_actions: unknown[] | null;
  upcoming_events: unknown[] | null;
  full_content: string | null;
  generated_for_date: string;
  created_at: string;
}
