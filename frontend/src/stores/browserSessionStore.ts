import { create } from "zustand";

/**
 * Whether a research-browser session is alive, shared so the docked bar can
 * survive the browser page unmounting when the user moves elsewhere.
 */
interface BrowserSessionState {
  open: boolean;
  url: string;
  title: string;
  setSession: (s: { open: boolean; url?: string; title?: string }) => void;
}

export const useBrowserSessionStore = create<BrowserSessionState>((set) => ({
  open: false,
  url: "",
  title: "",
  setSession: ({ open, url, title }) =>
    set((prev) => ({
      open,
      url: url ?? prev.url,
      title: title ?? prev.title,
    })),
}));
