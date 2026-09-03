import { create } from "zustand";

/** Where we have been, so the app can offer Back and Forward of its own.
 *
 * The desktop shell has no browser chrome, so `window.history` is invisible and
 * its length says nothing about which direction is still available. React Router
 * hands us a fresh `key` per entry, which is enough to tell a step back from a
 * step forward: a key we have already seen is a move within the stack.
 */
interface NavHistoryState {
  keys: string[];
  index: number;
  visit: (key: string, type: "POP" | "PUSH" | "REPLACE") => void;
}

export const useNavHistoryStore = create<NavHistoryState>((set) => ({
  keys: [],
  index: -1,
  visit: (key, type) =>
    set((s) => {
      if (s.keys[s.index] === key) return s;
      if (type === "REPLACE" && s.index >= 0) {
        const keys = [...s.keys];
        keys[s.index] = key;
        return { keys, index: s.index };
      }
      if (type === "POP") {
        const known = s.keys.indexOf(key);
        if (known >= 0) return { keys: s.keys, index: known };
      }
      const keys = [...s.keys.slice(0, s.index + 1), key];
      return { keys, index: keys.length - 1 };
    }),
}));
