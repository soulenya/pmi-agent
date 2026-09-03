import { apiClient } from "./client";
import type {
  Portfolio,
  ProjectLink,
  ProjectLinkCreate,
  ProjectLinkUpdate,
} from "@/types/tasks";
import type { Source } from "./tasks";

function at(source: Source, path: string): string {
  return source === "hub" ? `/hub/api${path}` : path;
}

export async function listProjectLinks(
  projectId: string,
  source: Source = "local",
): Promise<ProjectLink[]> {
  const resp = await apiClient.get<ProjectLink[]>(at(source, `/projects/${projectId}/links`));
  return resp.data;
}

export async function createProjectLink(
  projectId: string,
  body: ProjectLinkCreate,
  source: Source = "local",
): Promise<ProjectLink> {
  const resp = await apiClient.post<ProjectLink>(
    at(source, `/projects/${projectId}/links`),
    body,
  );
  return resp.data;
}

export async function updateProjectLink(
  projectId: string,
  linkId: string,
  body: ProjectLinkUpdate,
  source: Source = "local",
): Promise<ProjectLink> {
  const resp = await apiClient.patch<ProjectLink>(
    at(source, `/projects/${projectId}/links/${linkId}`),
    body,
  );
  return resp.data;
}

export async function deleteProjectLink(
  projectId: string,
  linkId: string,
  source: Source = "local",
): Promise<void> {
  await apiClient.delete(at(source, `/projects/${projectId}/links/${linkId}`));
}

export async function getPortfolio(source: Source = "local"): Promise<Portfolio> {
  const resp = await apiClient.get<Portfolio>(at(source, "/portfolio"));
  return resp.data;
}
