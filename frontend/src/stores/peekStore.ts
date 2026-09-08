import { create } from "zustand";

import type { Source } from "@/api/tasks";

/**
 * One thing opened over the page you are on, without leaving it.
 *
 * You go to a page for a list; you never go to a page for one item. A task
 * clicked on the calendar, the Today page or a search result opens here, and
 * closing it leaves you exactly where you were.
 */
export type Peek = { kind: "task"; id: string; source: Source };

interface PeekState {
  peek: Peek | null;
  open: (peek: Peek) => void;
  close: () => void;
}

export const usePeekStore = create<PeekState>()((set) => ({
  peek: null,
  open: (peek) => set({ peek }),
  close: () => set({ peek: null }),
}));

export function peekTask(id: string, source: Source = "local") {
  usePeekStore.getState().open({ kind: "task", id, source });
}
