import { useEffect } from "react";

export type ThemeValue = "light" | "dark" | "system";

function applyTheme(theme: ThemeValue) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    // system
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  }
}

/** Call once near the top of App to apply the saved theme immediately before first paint. */
export function initTheme() {
  try {
    const saved = localStorage.getItem("pmi-theme") as ThemeValue | null;
    applyTheme(saved ?? "system");
  } catch {
    applyTheme("system");
  }
}

/** Persist + apply a theme change. */
export function setTheme(theme: ThemeValue) {
  try {
    localStorage.setItem("pmi-theme", theme);
  } catch { /* ignore */ }
  applyTheme(theme);
}

/** React hook: syncs system media query when theme === "system". */
export function useSystemThemeSync(theme: ThemeValue) {
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);
}
