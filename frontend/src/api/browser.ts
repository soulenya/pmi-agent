import { apiClient } from "./client";

/**
 * The research browser is a second desktop window owned by the launcher, not an
 * iframe — real sites refuse to be framed. The React page below renders the
 * chrome (address bar, tabs, bookmarks) and steers that window over the
 * pywebview bridge; only text the user explicitly captures reaches the backend.
 */

export interface BrowserBookmark {
  id: string;
  url: string;
  title: string;
  created_at: string;
}

export interface CapturedPage {
  url: string;
  title: string;
  text: string;
}

export interface BrowserState {
  following: boolean;
  page: { url: string; title: string; chars: number; captured_at: string } | null;
}

export interface SavedToKb {
  id: string;
  title: string;
  chunk_count: number;
  category: string;
}

// ── desktop bridge ──────────────────────────────────────────────────────────

interface BrowserBridge {
  browser_open(url: string): Promise<{ ok: boolean; url?: string; error?: string }>;
  browser_navigate(url: string): Promise<{ ok: boolean; url?: string; error?: string }>;
  browser_back(): Promise<boolean>;
  browser_forward(): Promise<boolean>;
  browser_reload(): Promise<boolean>;
  browser_state(): Promise<{ open: boolean; url: string; title: string }>;
  browser_fit(
    left: number, top: number, width: number, height: number,
    viewW: number, viewH: number,
  ): Promise<boolean>;
  browser_hide(): Promise<boolean>;
  browser_show(): Promise<boolean>;
  browser_take_actions(): Promise<string[]>;
  browser_set_following(following: boolean): Promise<boolean>;
  browser_capture(): Promise<{ ok: boolean; url?: string; title?: string; text?: string; error?: string }>;
  browser_close(): Promise<boolean>;
}

function bridge(): BrowserBridge | null {
  const api = (window as unknown as { pywebview?: { api?: Partial<BrowserBridge> } }).pywebview?.api;
  return api && typeof api.browser_open === "function" ? (api as BrowserBridge) : null;
}

/** False in a plain web browser, where there is no second window to drive. */
export function isBrowserAvailable(): boolean {
  return bridge() !== null;
}

const NO_BRIDGE = "The research browser only works in the Little Gerry desktop app.";

export async function openBrowser(url: string) {
  const api = bridge();
  if (!api) return { ok: false, error: NO_BRIDGE };
  return api.browser_open(url);
}

export async function navigateBrowser(url: string) {
  const api = bridge();
  if (!api) return { ok: false, error: NO_BRIDGE };
  return api.browser_navigate(url);
}

export async function browserBack() {
  await bridge()?.browser_back();
}

export async function browserForward() {
  await bridge()?.browser_forward();
}

export async function browserReload() {
  await bridge()?.browser_reload();
}

export async function browserWindowState() {
  return (await bridge()?.browser_state()) ?? { open: false, url: "", title: "" };
}

/**
 * Park the browser window over `el`, so it fills the page area without hiding
 * the navigation or the chat panel. Measurements go over in CSS pixels; the
 * shell works out the title-bar and border offsets from its own geometry.
 */
export async function fitBrowserTo(el: HTMLElement | null) {
  const api = bridge();
  if (!api || !el) return;
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  if (r.width < 100 || r.height < 100 || !vw || !vh) return;
  await api.browser_fit(r.left, r.top, r.width, r.height, vw, vh);
}

/** Tuck the window away when the user moves to another part of the app. */
export async function hideBrowser() {
  await bridge()?.browser_hide();
}

export async function showBrowser() {
  await bridge()?.browser_show();
}

/** Button presses made on the bar floating over the browsed page. */
export async function takeBrowserActions(): Promise<string[]> {
  return (await bridge()?.browser_take_actions()) ?? [];
}

export async function markFollowingInBar(following: boolean) {
  await bridge()?.browser_set_following(following);
}

export async function closeBrowser() {
  await bridge()?.browser_close();
}

export async function capturePage(): Promise<CapturedPage | null> {
  const result = await bridge()?.browser_capture();
  if (!result?.ok) return null;
  return { url: result.url ?? "", title: result.title ?? "", text: result.text ?? "" };
}

/**
 * Turn a typed query into something navigable. Anything with a dot and no
 * spaces is treated as an address; everything else becomes a search.
 */
export function toUrl(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[^\s/]+\.[^\s/]{2,}(\/.*)?$/.test(value)) return `https://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── backend ─────────────────────────────────────────────────────────────────

export async function getBrowserState(): Promise<BrowserState> {
  const { data } = await apiClient.get<BrowserState>("/api/browser/state");
  return data;
}

export async function setFollowing(following: boolean): Promise<void> {
  await apiClient.put("/api/browser/follow", { following });
}

export async function pushPage(page: CapturedPage): Promise<void> {
  await apiClient.put("/api/browser/page", page);
}

export async function listBookmarks(): Promise<BrowserBookmark[]> {
  const { data } = await apiClient.get<BrowserBookmark[]>("/api/browser/bookmarks");
  return data;
}

export async function addBookmark(url: string, title: string): Promise<BrowserBookmark> {
  const { data } = await apiClient.post<BrowserBookmark>("/api/browser/bookmarks", { url, title });
  return data;
}

export async function deleteBookmark(id: string): Promise<void> {
  await apiClient.delete(`/api/browser/bookmarks/${id}`);
}

export async function savePageToKb(page: CapturedPage): Promise<SavedToKb> {
  const { data } = await apiClient.post<SavedToKb>("/api/browser/save-to-kb", page);
  return data;
}
