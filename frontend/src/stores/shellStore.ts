import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Which shell wraps the app.
 *
 * "workbench" is the rail + omnibar layout. "orbit" is the solar system it
 * replaced, kept for one release so anyone who needs it can switch back from
 * Settings › Appearance while the new layout settles.
 */
export type Shell = "workbench" | "orbit";

interface ShellState {
  shell: Shell;
  setShell: (shell: Shell) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      shell: "workbench",
      setShell: (shell) => set({ shell }),
    }),
    { name: "pmi-shell" },
  ),
);
