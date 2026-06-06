/**
 * App-wide context: timezone and theme sync from backend settings.
 *
 * - Wraps all authenticated routes (placed in AppShell).
 * - On settings load, syncs the saved theme to the DOM + localStorage so
 *   dark/light mode persists across browser restarts and cleared storage.
 * - Exposes `useTimezone()` so any component can get the user's timezone
 *   for date/time formatting without prop-drilling.
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/api/settings";
import { setTheme, type ThemeValue } from "@/hooks/useTheme";

interface AppContextValue {
  timezone: string;
}

const AppContext = createContext<AppContextValue>({ timezone: "UTC" });

// ── Provider ───────────────────────────────────────────────────────────────────

export function AppContextProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
  });

  // Sync backend theme → DOM + localStorage on every app startup.
  // This covers cleared localStorage, incognito mode, and fresh browsers
  // where initTheme() had nothing to read.
  useEffect(() => {
    if (settings?.theme) {
      setTheme(settings.theme as ThemeValue);
    }
  }, [settings?.theme]);

  // Sync timezone to localStorage as a fast fallback for formatDate on first render.
  useEffect(() => {
    if (settings?.timezone) {
      try { localStorage.setItem("pmi-timezone", settings.timezone); } catch { /* ignore */ }
    }
  }, [settings?.timezone]);

  // Use backend value, fall back to cached localStorage, then UTC
  const timezone =
    settings?.timezone ??
    (() => { try { return localStorage.getItem("pmi-timezone") ?? "UTC"; } catch { return "UTC"; } })();

  return (
    <AppContext.Provider value={{ timezone }}>
      {children}
    </AppContext.Provider>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

/** Returns the user's configured timezone (IANA string, e.g. "America/New_York"). */
export function useTimezone(): string {
  return useContext(AppContext).timezone;
}
