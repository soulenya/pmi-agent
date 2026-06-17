/**
 * Precisian Sweeper — a space-themed Minesweeper mini-game that plays inside the
 * solar-system overview, alongside Precisian Defender. The classic grid is
 * reskinned as a sensor sweep of a minefield around Little Gerry: cells are
 * "sectors" you scan, mines are cloaked proximity mines, numbers are hazards
 * detected nearby, and flags are warning beacons you plant on suspected mines.
 *
 * Turn-based, so it runs as a state-driven DOM grid (no canvas / rAF loop),
 * which keeps it crisp and reduced-motion friendly.
 *
 * Controls: left-click reveals a sector, right-click (or long-press on touch /
 * desktop) plants a beacon, Esc or the End Game button exits.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, RotateCcw, Bomb, Radar, Timer, X } from "lucide-react";

const BEST_KEY = "precisian-sweeper-best";

type Tier = "beginner" | "intermediate" | "expert";

interface TierConfig {
  id: Tier;
  label: string;
  rows: number;
  cols: number;
  mines: number;
  /** Cell size in px for this tier's grid. */
  cell: number;
}

const TIERS: TierConfig[] = [
  { id: "beginner", label: "Inner System", rows: 9, cols: 9, mines: 10, cell: 34 },
  { id: "intermediate", label: "Asteroid Belt", rows: 16, cols: 16, mines: 40, cell: 28 },
  { id: "expert", label: "Deep Space", rows: 16, cols: 30, mines: 99, cell: 24 },
];

interface Cell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  /** Adjacent mine count (valid once the board is seeded). */
  adjacent: number;
}

type GameStatus = "ready" | "playing" | "won" | "lost";

/** Classic-ish hazard palette tuned for the dark starfield. */
const NUM_COLOR: Record<number, string> = {
  1: "#60a5fa",
  2: "#34d399",
  3: "#f87171",
  4: "#c084fc",
  5: "#fb923c",
  6: "#22d3ee",
  7: "#e5e7eb",
  8: "#94a3b8",
};

type BestTimes = Partial<Record<Tier, number>>;

function loadBest(): BestTimes {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as BestTimes) : {};
  } catch {
    return {};
  }
}

function saveBest(best: BestTimes) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function makeEmptyBoard(cfg: TierConfig): Cell[] {
  return Array.from({ length: cfg.rows * cfg.cols }, () => ({
    mine: false,
    revealed: false,
    flagged: false,
    adjacent: 0,
  }));
}

const neighbours = (i: number, rows: number, cols: number): number[] => {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
    }
  }
  return out;
};

/**
 * Seed mines after the first click, keeping the clicked cell and its neighbours
 * safe so the opening move always opens an area (standard fairness rule).
 */
function seedBoard(board: Cell[], cfg: TierConfig, safeIndex: number): Cell[] {
  const next = board.map((c) => ({ ...c, mine: false, adjacent: 0 }));
  const forbidden = new Set<number>([safeIndex, ...neighbours(safeIndex, cfg.rows, cfg.cols)]);
  const candidates: number[] = [];
  for (let i = 0; i < next.length; i++) if (!forbidden.has(i)) candidates.push(i);

  // Fisher–Yates partial shuffle to pick mine positions.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (let m = 0; m < cfg.mines && m < candidates.length; m++) next[candidates[m]].mine = true;

  for (let i = 0; i < next.length; i++) {
    if (next[i].mine) continue;
    next[i].adjacent = neighbours(i, cfg.rows, cfg.cols).filter((n) => next[n].mine).length;
  }
  return next;
}

/** Flood-fill reveal from a zero-adjacent cell. Mutates a fresh copy. */
function revealFlood(board: Cell[], cfg: TierConfig, start: number): Cell[] {
  const next = board.map((c) => ({ ...c }));
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const cell = next[i];
    if (cell.revealed || cell.flagged || cell.mine) continue;
    cell.revealed = true;
    if (cell.adjacent === 0) {
      for (const n of neighbours(i, cfg.rows, cfg.cols)) {
        if (!next[n].revealed && !next[n].flagged) stack.push(n);
      }
    }
  }
  return next;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

export function PrecisianSweeper({ onExit }: { onExit: () => void }) {
  const [tier, setTier] = useState<TierConfig>(TIERS[0]);
  const [board, setBoard] = useState<Cell[]>(() => makeEmptyBoard(TIERS[0]));
  const [status, setStatus] = useState<GameStatus>("ready");
  const [elapsed, setElapsed] = useState(0);
  const [best, setBest] = useState<BestTimes>(() => loadBest());

  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const reset = useCallback((cfg: TierConfig) => {
    setBoard(makeEmptyBoard(cfg));
    setStatus("ready");
    setElapsed(0);
  }, []);

  const selectTier = useCallback(
    (cfg: TierConfig) => {
      setTier(cfg);
      reset(cfg);
    },
    [reset],
  );

  // Timer ticks while a game is in progress.
  useEffect(() => {
    if (status !== "playing") return;
    const id = window.setInterval(() => setElapsed((e) => Math.min(e + 1, 999)), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // Esc exits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const minesLeft = useMemo(() => {
    const flagged = board.reduce((n, c) => n + (c.flagged ? 1 : 0), 0);
    return tier.mines - flagged;
  }, [board, tier.mines]);

  const finishWin = useCallback(
    (finalElapsed: number) => {
      setStatus("won");
      setBest((prev) => {
        const current = prev[tier.id];
        if (current === undefined || finalElapsed < current) {
          const updated = { ...prev, [tier.id]: finalElapsed };
          saveBest(updated);
          return updated;
        }
        return prev;
      });
    },
    [tier.id],
  );

  const reveal = useCallback(
    (index: number) => {
      if (status === "won" || status === "lost") return;
      setBoard((prev) => {
        if (prev[index].revealed || prev[index].flagged) return prev;

        // First reveal seeds the board (safe opening) and starts the clock.
        let working = prev;
        if (status === "ready") {
          working = seedBoard(prev, tier, index);
          setStatus("playing");
        }

        if (working[index].mine) {
          const blown = working.map((c) => ({
            ...c,
            revealed: c.revealed || c.mine,
          }));
          blown[index] = { ...blown[index], revealed: true };
          setStatus("lost");
          return blown;
        }

        const next =
          working[index].adjacent === 0
            ? revealFlood(working, tier, index)
            : working.map((c, i) => (i === index ? { ...c, revealed: true } : c));

        // Win when every non-mine sector is revealed.
        const cleared = next.every((c) => c.mine || c.revealed);
        if (cleared) {
          const flagged = next.map((c) => (c.mine ? { ...c, flagged: true } : c));
          setElapsed((e) => {
            finishWin(e);
            return e;
          });
          return flagged;
        }
        return next;
      });
    },
    [status, tier, finishWin],
  );

  const toggleFlag = useCallback(
    (index: number) => {
      if (status === "won" || status === "lost") return;
      setBoard((prev) => {
        if (prev[index].revealed) return prev;
        return prev.map((c, i) => (i === index ? { ...c, flagged: !c.flagged } : c));
      });
    },
    [status],
  );

  // Long-press to flag (touch + desktop without a right mouse button).
  const startLongPress = useCallback(
    (index: number) => {
      longPressFired.current = false;
      longPressTimer.current = window.setTimeout(() => {
        longPressFired.current = true;
        toggleFlag(index);
      }, 380);
    },
    [toggleFlag],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback(
    (index: number) => {
      // Suppress the click that ends a long-press flag.
      if (longPressFired.current) {
        longPressFired.current = false;
        return;
      }
      reveal(index);
    },
    [reveal],
  );

  const bestForTier = best[tier.id];
  const gridFontSize = Math.round(tier.cell * 0.55);

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm select-none">
      {/* Header */}
      <div className="pointer-events-none absolute left-4 top-4">
        <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.2em] text-amber-300 drop-shadow">
          <Radar className="h-4 w-4" />
          Precisian Sweeper
        </div>
        <div className="mt-0.5 text-xs font-semibold text-rose-300/90">Sweep the minefield around Little Gerry</div>
      </div>

      {/* End game */}
      <button
        type="button"
        onClick={onExit}
        className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow backdrop-blur transition-colors hover:bg-card"
      >
        <X className="h-3.5 w-3.5" />
        End Game
        <span className="ml-1 hidden text-[10px] text-muted-foreground sm:inline">Esc</span>
      </button>

      {/* Tier selector */}
      <div className="mb-3 flex items-center gap-1.5 rounded-full border border-border bg-card/70 p-1 shadow backdrop-blur">
        {TIERS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTier(t)}
            className={
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors " +
              (t.id === tier.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Status bar */}
      <div className="mb-3 flex items-center gap-4 rounded-xl border border-border bg-card/80 px-4 py-2 text-sm font-semibold shadow backdrop-blur">
        <span className="flex items-center gap-1.5 tabular-nums text-rose-300">
          <Bomb className="h-4 w-4" />
          {minesLeft}
        </span>
        <button
          type="button"
          onClick={() => reset(tier)}
          title="New field"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-foreground transition-colors hover:bg-muted"
        >
          <RotateCcw className="h-4 w-4" />
          {status === "won" ? "Cleared!" : status === "lost" ? "Breach" : "Reset"}
        </button>
        <span className="flex items-center gap-1.5 tabular-nums text-sky-300">
          <Timer className="h-4 w-4" />
          {formatTime(elapsed)}
        </span>
        {bestForTier !== undefined && (
          <span className="text-[11px] font-medium uppercase tracking-wider text-amber-300">
            Best {formatTime(bestForTier)}
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="max-w-[92vw] overflow-auto rounded-xl border border-border bg-slate-950/60 p-2 shadow-2xl">
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `repeat(${tier.cols}, ${tier.cell}px)`,
            fontSize: gridFontSize,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {board.map((cell, i) => {
            const showMine = cell.revealed && cell.mine;
            const isLossMine = status === "lost" && cell.mine;
            return (
              <button
                key={i}
                type="button"
                disabled={status === "won" || status === "lost"}
                onClick={() => handleClick(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  toggleFlag(i);
                }}
                onPointerDown={(e) => {
                  if (e.pointerType === "touch" || e.button === 0) startLongPress(i);
                }}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                style={{ width: tier.cell, height: tier.cell, color: NUM_COLOR[cell.adjacent] }}
                className={
                  "flex items-center justify-center rounded-[5px] font-black tabular-nums leading-none transition-colors " +
                  (cell.revealed
                    ? showMine || isLossMine
                      ? "bg-rose-600/80"
                      : "bg-slate-800/70"
                    : "bg-slate-600/60 hover:bg-slate-500/70")
                }
              >
                {cell.revealed ? (
                  cell.mine ? (
                    <Bomb className="h-[60%] w-[60%] text-slate-950" />
                  ) : cell.adjacent > 0 ? (
                    cell.adjacent
                  ) : null
                ) : cell.flagged ? (
                  <Flag className="h-[60%] w-[60%] text-amber-400" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Win / loss banner */}
      {(status === "won" || status === "lost") && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card/90 px-5 py-3 shadow-2xl">
          <span
            className={
              "text-sm font-black uppercase tracking-wide " +
              (status === "won" ? "text-emerald-400" : "text-rose-400")
            }
          >
            {status === "won" ? "Sector cleared" : "Hull breach"}
          </span>
          <button
            type="button"
            onClick={() => reset(tier)}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            New field
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Exit
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * MineLauncher — a small hazard beacon that orbits the system and starts
 * Precisian Sweeper when clicked.
 */
export function MineLauncher({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      title="Precisian Sweeper — Clear the minefield!"
      className="group relative flex flex-col items-center"
    >
      <svg width="32" height="32" viewBox="0 0 32 32" className="transition-transform group-hover:scale-125">
        <defs>
          <radialGradient id="beacon-grad" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#92400e" />
          </radialGradient>
        </defs>
        {/* hazard-striped buoy body */}
        <rect x="11" y="6" width="10" height="20" rx="3" fill="url(#beacon-grad)" stroke="#fcd34d" strokeWidth="1" />
        <path d="M11 11 L21 11 M11 16 L21 16 M11 21 L21 21" stroke="#1c1917" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
        {/* warning lamp */}
        <circle cx="16" cy="6" r="3.4" fill="#f43f5e" stroke="#fecdd3" strokeWidth="1" />
        <circle cx="16" cy="6" r="6.5" fill="#f43f5e" opacity="0.22" className="animate-ping" />
      </svg>
      <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 w-max -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-[10px] font-semibold text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        Precisian Sweeper
      </span>
    </button>
  );
}
