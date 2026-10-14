import { apiClient } from "./client";

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export type BannerStyle = "dark" | "accent" | "none";

export interface DesignTokens {
  font_display: string;
  font_mono: string;
  accent: string;
  ink: string;
  body: string;
  muted: string;
  hairline: string;
  dark_background: string;
  dark_card: string;
  dark_text: string;
  dark_body: string;
  app_accent: string;
  title_rule: boolean;
  section_hairlines: boolean;
  banner_style: BannerStyle;
  eyebrow_caps: boolean;
  footer_wording: string;
  controlled_exempt: boolean;
  logo_light: string;
  logo_dark: string;
  deck_name: string;
}

export interface FontOption {
  family: string;
  source: "bundled" | "uploaded";
  available: boolean;
}

export interface DesignState {
  source: "setting" | "defaults";
  tokens: DesignTokens;
  defaults: DesignTokens;
  fonts: FontOption[];
  logos: { light: boolean; dark: boolean };
  contrast: Record<string, number>;
  problems?: string[];
}

export interface PublicDesign {
  source: "setting" | "defaults";
  app_accent: string;
  app_accent_hsl: string;
  font_display: string;
  font_mono: string;
  logo_light: boolean;
  logo_dark: boolean;
}

export async function getPublicDesign(): Promise<PublicDesign> {
  const resp = await apiClient.get<PublicDesign>("/design");
  return resp.data;
}

export async function getDesign(): Promise<DesignState> {
  const resp = await apiClient.get<DesignState>("/design/tokens");
  return resp.data;
}

export async function saveDesign(tokens: Partial<DesignTokens>): Promise<DesignState> {
  const resp = await apiClient.put<DesignState>("/design/tokens", { tokens });
  return resp.data;
}

export async function resetDesign(): Promise<DesignState> {
  const resp = await apiClient.post<DesignState>("/design/reset");
  return resp.data;
}

export async function uploadLogo(kind: "light" | "dark", file: File): Promise<DesignState> {
  const form = new FormData();
  form.append("file", file);
  const resp = await apiClient.post<DesignState>(`/design/logo/${kind}`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return resp.data;
}

export async function removeLogo(kind: "light" | "dark"): Promise<DesignState> {
  const resp = await apiClient.delete<DesignState>(`/design/logo/${kind}`);
  return resp.data;
}

export async function uploadFont(family: string, regular: File, bold: File): Promise<DesignState> {
  const form = new FormData();
  form.append("family", family);
  form.append("regular", regular);
  form.append("bold", bold);
  const resp = await apiClient.post<DesignState>("/design/fonts", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return resp.data;
}

export function logoUrl(kind: "light" | "dark", bust?: string | number): string {
  return `${API_BASE}/design/logo/${kind}${bust ? `?v=${bust}` : ""}`;
}

export function fontUrl(family: string, face: "Regular" | "Bold"): string {
  return `${API_BASE}/design/font/${encodeURIComponent(family)}/${face}`;
}
