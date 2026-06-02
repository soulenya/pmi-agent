import { apiClient } from "./client";
import type { ResearchReport, RunResearchRequest } from "@/types/research";

export async function listResearchReports(): Promise<ResearchReport[]> {
  const resp = await apiClient.get<ResearchReport[]>("/research");
  return resp.data;
}

export async function getResearchReport(id: string): Promise<ResearchReport> {
  const resp = await apiClient.get<ResearchReport>(`/research/${id}`);
  return resp.data;
}

export async function runResearch(body: RunResearchRequest): Promise<ResearchReport> {
  const resp = await apiClient.post<ResearchReport>("/research/run", body);
  return resp.data;
}

export async function deleteResearchReport(id: string): Promise<void> {
  await apiClient.delete(`/research/${id}`);
}
