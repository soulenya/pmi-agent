/**
 * Runtime design tokens for the app shell: the company's accent colour
 * replaces the default --primary/--ring once an administrator has stored
 * tokens. Nothing is touched while the backend reports the defaults, so PMI's
 * palette in index.css stays exactly as compiled.
 */
import { fontUrl, getPublicDesign, type PublicDesign } from "@/api/design";

let applied: PublicDesign | null = null;

export function applyAccent(hsl: string | null): void {
  const root = document.documentElement;
  if (!hsl) {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    return;
  }
  root.style.setProperty("--primary", hsl);
  root.style.setProperty("--ring", hsl);
}

/** Load the company's accent at startup; silent when the backend is not up yet. */
export async function loadDesign(): Promise<PublicDesign | null> {
  try {
    const d = await getPublicDesign();
    applied = d;
    applyAccent(d.source === "setting" ? d.app_accent_hsl : null);
    return d;
  } catch {
    return null;
  }
}

export function currentDesign(): PublicDesign | null {
  return applied;
}

/** Register a font face from the backend so previews render the real family. */
export function ensureFontFace(family: string): void {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const id = `lg-font-${family.replace(/\s+/g, "-")}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
@font-face { font-family: "${family}"; src: url("${fontUrl(family, "Regular")}"); font-weight: 400; }
@font-face { font-family: "${family}"; src: url("${fontUrl(family, "Bold")}"); font-weight: 700; }`;
  document.head.appendChild(style);
}
