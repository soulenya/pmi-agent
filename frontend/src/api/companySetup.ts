import { apiClient } from "./client";

export type LocationKind = "folder" | "file_or_folder" | "folder_list" | "bucket" | "name";

export interface CompanyLocation {
  key: string;
  label: string;
  kind: LocationKind;
  purpose: string;
  value: string | string[];
  source: "setting" | "brand" | "none";
  created_by_layout: boolean;
}

export interface CompanySetupStatus {
  brand: string;
  company_name: string;
  company_file: string;
  google_connected: boolean;
  needs_import: boolean;
  locations: CompanyLocation[];
  published_at: string | null;
  imported_at: string | null;
}

export interface SharedDrive {
  id: string;
  name: string;
}

export interface LayoutReport {
  folders: Record<string, { id: string; name: string; url: string; created: boolean }>;
  seeded: Record<string, string[]>;
  ids: Record<string, string>;
  locations: CompanyLocation[];
}

export async function getCompanySetupStatus(): Promise<CompanySetupStatus> {
  const resp = await apiClient.get<CompanySetupStatus>("/company-setup/status");
  return resp.data;
}

export async function setCompanyLocations(
  locations: Record<string, string | string[]>,
): Promise<{ locations: CompanyLocation[] }> {
  const resp = await apiClient.put<{ locations: CompanyLocation[] }>("/company-setup/locations", {
    locations,
  });
  return resp.data;
}

export async function listSharedDrives(): Promise<SharedDrive[]> {
  const resp = await apiClient.get<{ drives: SharedDrive[] }>("/company-setup/shared-drives");
  return resp.data.drives;
}

export async function createCompanyLayout(
  parentId: string,
  withQmsTemplate: boolean,
): Promise<LayoutReport> {
  const resp = await apiClient.post<LayoutReport>("/company-setup/drive/create", {
    parent_id: parentId,
    with_qms_template: withQmsTemplate,
  });
  return resp.data;
}

export async function publishCompanyFile(): Promise<{ name: string; url: string; updated: boolean }> {
  const resp = await apiClient.post<{ name: string; url: string; updated: boolean }>(
    "/company-setup/publish",
  );
  return resp.data;
}

export async function importCompanyFile(
  overwrite = false,
): Promise<{ found: boolean; applied: string[]; reason?: string; locations: CompanyLocation[] }> {
  const resp = await apiClient.post<{
    found: boolean;
    applied: string[];
    reason?: string;
    locations: CompanyLocation[];
  }>("/company-setup/import", { overwrite });
  return resp.data;
}
