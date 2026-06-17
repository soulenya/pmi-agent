/**
 * IdleSystemLayer — an ambient, non-interactive animation that plays over the
 * solar-system overview when the user has been idle.
 *
 * After {@link IDLE_MS} of no input on the system view, one of six "space dots"
 * scenarios is chosen at random and animates over the live celestial bodies:
 *
 *   1. colonize  — dots arrive and build colonies / orbital platforms on the
 *                  planets and moons.
 *   2. dyson     — dots assemble a Dyson sphere lattice around Little Gerry to
 *                  harness his power.
 *   3. war       — invader dots attack the system; the inhabitants scramble
 *                  defenders, leading to a perpetual war.
 *   4. migrate   — a swarm streams through and slingshots around Little Gerry's
 *                  gravity well, leaving glowing trails (a cosmic migration).
 *   5. terraform — dots gently land and bloom life across the worlds.
 *   6. trade     — dots weave glowing hyperlane trade routes between the bodies.
 *
 * The layer is purely cosmetic: the canvas is pointer-events:none, so all
 * navigation keeps working. ANY user input (move / click / key / wheel / touch)
 * disperses the scene — every dot and structure is pushed radially outward from
 * Little Gerry and fades — after which the idle timer resets and the cycle can
 * begin again. The component only mounts on the system overview, so it stops
 * automatically the moment the user drills into a planet or Gerry.
 *
 * All hot state lives in a mutable ref and the whole scene renders on a single
 * <canvas> via requestAnimationFrame — there are no per-frame React re-renders.
 * Live body positions are read from the DOM each frame (the bodies are tagged
 * with data-idle-body / data-idle-color), so the effects stay glued to the
 * CSS-driven orbits without the layer needing to know the orbital model.
 */
import { useEffect, useRef } from "react";

const IDLE_MS = 30_000; // inactivity before a scenario starts
const DISPERSE_MS = 950; // outward-push wipe duration
const MAX_DOTS = 220; // perf cap

type Scenario = "colonize" | "dyson" | "war" | "migrate" | "terraform" | "trade";
const SCENARIOS: Scenario[] = ["colonize", "dyson", "war", "migrate", "terraform", "trade"];

type Phase = "wait" | "running" | "disperse";

interface Body {
  kind: "sun" | "planet" | "satellite" | "moon";
  x: number;
  y: number;
  r: number;
  color: string;
}

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  alpha: number;
  mode: "seek" | "orbit" | "fly" | "free" | "lane";
  // seek / lane
  tx: number;
  ty: number;
  // orbit
  ox: number;
  oy: number;
  orbitR: number;
  ang: number;
  spin: number;
  // lane (trade)
  ax: number;
  ay: number;
  lt: number;
  // misc
  faction?: "invader" | "defender";
  life: number;
  trail: { x: number; y: number }[];
  hasTrail: boolean;
}

interface Fx {
  x: number;
  y: number;
  r: number;
  maxR: number;
  alpha: number;
  color: string;
  kind: "ring" | "spark";
  vx: number;
  vy: number;
}

interface ShellNode {
  ang: number; // angle around sun
  lit: number; // 0..1 fill-in progress
}

interface Colony {
  bodyKey: string; // index key into bodies (kind+order) — re-resolved each frame
  idx: number;
  ringR: number;
  count: number; // platform dots
  phase: number;
}

interface Lane {
  a: number; // body index
  b: number; // body index
  on: number; // 0..1 establish progress
}

interface State {
  scenario: Scenario;
  phase: Phase;
  t: number;
  disperseT: number;
  spawnAcc: number;
  spawnAcc2: number;
  dots: Dot[];
  fx: Fx[];
  shell: ShellNode[];
  colonies: Colony[];
  lanes: Lane[];
  globalAlpha: number; // fades during disperse
  bodies: Body[];
  sun: Body;
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}
function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}

/** A random point just outside the canvas bounds, biased to head inward. */
function offscreen(w: number, h: number): { x: number; y: number } {
  const m = Math.max(w, h) * 0.18 + 40;
  switch ((Math.random() * 4) | 0) {
    case 0:
      return { x: rand(-m, w + m), y: -m };
    case 1:
      return { x: w + m, y: rand(-m, h + m) };
    case 2:
      return { x: rand(-m, w + m), y: h + m };
    default:
      return { x: -m, y: rand(-m, h + m) };
  }
}

function makeDot(p: Partial<Dot>): Dot {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 1.6,
    color: "#e2e8f0",
    alpha: 1,
    mode: "seek",
    tx: 0,
    ty: 0,
    ox: 0,
    oy: 0,
    orbitR: 0,
    ang: 0,
    spin: 0,
    ax: 0,
    ay: 0,
    lt: 0,
    life: 0,
    trail: [],
    hasTrail: false,
    ...p,
  };
}

export function IdleSystemLayer({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const canvas = canvasEl;
    const ctxOrNull = canvas.getContext("2d");
    if (!ctxOrNull) return;
    const ctx = ctxOrNull;

    // NOTE: scenario selection is deliberately NOT gated on
    // prefers-reduced-motion. Windows reports reduced-motion as true whenever
    // "Animation effects" is off, which would silently pin the idle layer to
    // just two scenarios (the same reason the orbits aren't gated either).

    let lastScenario: Scenario | null = null;

    const state: State = {
      scenario: "colonize",
      phase: "wait",
      t: 0,
      disperseT: 0,
      spawnAcc: 0,
      spawnAcc2: 0,
      dots: [],
      fx: [],
      shell: [],
      colonies: [],
      lanes: [],
      globalAlpha: 1,
      bodies: [],
      sun: { kind: "sun", x: 0, y: 0, r: 56, color: "#ef4444" },
    };

    let lastActivity = performance.now();
    let raf = 0;
    let lastT = performance.now();

    function readBodies(rect: DOMRect): void {
      const nodes = document.querySelectorAll<HTMLElement>("[data-idle-body]");
      const bodies: Body[] = [];
      let sun: Body | null = null;
      nodes.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        const b: Body = {
          kind: (el.dataset.idleBody as Body["kind"]) ?? "moon",
          x: r.left + r.width / 2 - rect.left,
          y: r.top + r.height / 2 - rect.top,
          r: Math.max(r.width, r.height) / 2,
          color: el.dataset.idleColor ?? "#e2e8f0",
        };
        if (b.kind === "sun") sun = b;
        bodies.push(b);
      });
      state.bodies = bodies;
      if (sun) state.sun = sun;
    }

    function targets(): Body[] {
      return state.bodies.filter((b) => b.kind !== "sun");
    }

    function beginScenario(w: number, h: number): void {
      // Pick uniformly from all six, but never the same one twice in a row.
      const choices =
        lastScenario === null
          ? SCENARIOS
          : SCENARIOS.filter((s) => s !== lastScenario);
      state.scenario = pick(choices);
      lastScenario = state.scenario;
      state.phase = "running";
      state.t = 0;
      state.disperseT = 0;
      state.spawnAcc = 0;
      state.spawnAcc2 = 0;
      state.dots = [];
      state.fx = [];
      state.colonies = [];
      state.lanes = [];
      state.globalAlpha = 1;

      if (state.scenario === "dyson") {
        const n = 26;
        state.shell = Array.from({ length: n }, (_, i) => ({
          ang: (i / n) * Math.PI * 2,
          lit: 0,
        }));
      } else {
        state.shell = [];
      }
      if (state.scenario === "trade") {
        const t = targets();
        const lanes: Lane[] = [];
        for (let i = 0; i < t.length; i++) {
          const j = (i + 1 + ((Math.random() * 2) | 0)) % t.length;
          if (i !== j) lanes.push({ a: i, b: j, on: 0 });
        }
        state.lanes = lanes;
      }
      void w;
      void h;
    }

    function startDisperse(): void {
      if (state.phase !== "running") return;
      state.phase = "disperse";
      state.disperseT = 0;
      const sx = state.sun.x;
      const sy = state.sun.y;
      for (const d of state.dots) {
        const dx = d.x - sx;
        const dy = d.y - sy;
        const len = Math.hypot(dx, dy) || 1;
        const push = rand(420, 820);
        d.vx = (dx / len) * push;
        d.vy = (dy / len) * push;
        d.mode = "free";
        d.hasTrail = false;
      }
      // Convert structures into outward-flying sparks so the whole scene blows away.
      for (const c of state.colonies) {
        const b = state.bodies[c.idx];
        if (!b) continue;
        for (let k = 0; k < c.count; k++) {
          const a = rand(0, Math.PI * 2);
          state.fx.push({
            x: b.x + Math.cos(a) * c.ringR,
            y: b.y + Math.sin(a) * c.ringR,
            r: 1.8,
            maxR: 2,
            alpha: 1,
            color: b.color,
            kind: "spark",
            vx: Math.cos(a) * rand(300, 600),
            vy: Math.sin(a) * rand(300, 600),
          });
        }
      }
      for (const s of state.shell) {
        if (s.lit <= 0.05) continue;
        const a = s.ang;
        const rr = state.sun.r * 1.85;
        state.fx.push({
          x: sx + Math.cos(a) * rr,
          y: sy + Math.sin(a) * rr,
          r: 2,
          maxR: 2,
          alpha: 1,
          color: "#fcd34d",
          kind: "spark",
          vx: Math.cos(a) * rand(380, 720),
          vy: Math.sin(a) * rand(380, 720),
        });
      }
      state.colonies = [];
      state.shell = [];
      state.lanes = [];
    }

    /* ── spawners ──────────────────────────────────────────────────────── */

    function spawnSeekBody(w: number, h: number, color?: string): void {
      const t = targets();
      if (!t.length || state.dots.length >= MAX_DOTS) return;
      const bi = (Math.random() * t.length) | 0;
      const b = t[bi];
      const p = offscreen(w, h);
      const d = makeDot({
        x: p.x,
        y: p.y,
        tx: b.x,
        ty: b.y,
        r: rand(1.4, 2.4),
        color: color ?? b.color,
        mode: "seek",
      });
      state.dots.push(d);
      (d as Dot & { _bi?: number })._bi = bi;
    }

    /* ── per-frame scenario logic ──────────────────────────────────────── */

    function update(dt: number, w: number, h: number): void {
      const sun = state.sun;

      if (state.phase === "running") {
        state.t += dt;
        switch (state.scenario) {
          case "colonize":
            runColonize(dt, w, h);
            break;
          case "dyson":
            runDyson(dt, w, h);
            break;
          case "war":
            runWar(dt, w, h);
            break;
          case "migrate":
            runMigrate(dt, w, h);
            break;
          case "terraform":
            runTerraform(dt, w, h);
            break;
          case "trade":
            runTrade(dt);
            break;
        }
      } else if (state.phase === "disperse") {
        state.disperseT += dt * 1000;
        state.globalAlpha = Math.max(0, 1 - state.disperseT / DISPERSE_MS);
        for (const d of state.dots) {
          d.x += d.vx * dt;
          d.y += d.vy * dt;
        }
        if (state.disperseT >= DISPERSE_MS) {
          state.phase = "wait";
          state.dots = [];
          state.fx = [];
          lastActivity = performance.now();
        }
      }

      // Shared fx integration (sparks / rings) — runs in every phase.
      for (const f of state.fx) {
        if (f.kind === "ring") {
          f.r += (f.maxR - f.r) * Math.min(1, dt * 3.2);
          f.alpha -= dt * 1.1;
        } else {
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.vx *= 0.96;
          f.vy *= 0.96;
          f.alpha -= dt * 1.4;
        }
      }
      state.fx = state.fx.filter((f) => f.alpha > 0.02);
      void sun;
    }

    function integrateSeek(d: Dot, dt: number, arriveR: number): boolean {
      const dx = d.tx - d.x;
      const dy = d.ty - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < arriveR) return true;
      const sp = Math.min(dist, 260) * 2.4 + 60;
      d.vx += ((dx / dist) * sp - d.vx) * Math.min(1, dt * 4);
      d.vy += ((dy / dist) * sp - d.vy) * Math.min(1, dt * 4);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      return false;
    }

    function runColonize(dt: number, w: number, h: number): void {
      state.spawnAcc += dt;
      const interval = 0.22;
      while (state.spawnAcc >= interval) {
        state.spawnAcc -= interval;
        spawnSeekBody(w, h);
      }
      const t = targets();
      for (const d of state.dots) {
        if (d.mode !== "seek") continue;
        const bi = (d as Dot & { _bi?: number })._bi ?? 0;
        const b = t[bi];
        if (!b) {
          d.mode = "free";
          continue;
        }
        d.tx = b.x;
        d.ty = b.y;
        if (integrateSeek(d, dt, b.r + 6)) {
          // Land → grow this body's colony.
          d.alpha = 0;
          let col = state.colonies.find((c) => c.idx === bi);
          if (!col) {
            col = { bodyKey: String(bi), idx: bi, ringR: b.r + 8, count: 0, phase: rand(0, 6) };
            state.colonies.push(col);
          }
          col.count = Math.min(col.count + 1, 10);
          col.ringR = b.r + 8 + col.count * 1.1;
          state.fx.push({
            x: b.x,
            y: b.y,
            r: b.r,
            maxR: b.r + 14,
            alpha: 0.6,
            color: b.color,
            kind: "ring",
            vx: 0,
            vy: 0,
          });
        }
      }
      state.dots = state.dots.filter((d) => d.alpha > 0.02);
      for (const c of state.colonies) c.phase += dt;
    }

    function runDyson(dt: number, w: number, h: number): void {
      const sun = state.sun;
      const shellR = sun.r * 1.85;
      state.spawnAcc += dt;
      const interval = 0.16;
      while (state.spawnAcc >= interval && state.dots.length < MAX_DOTS) {
        state.spawnAcc -= interval;
        const unlit = state.shell.filter((s) => s.lit < 1);
        if (!unlit.length) break;
        const node = pick(unlit);
        const p = offscreen(w, h);
        const d = makeDot({
          x: p.x,
          y: p.y,
          tx: sun.x + Math.cos(node.ang) * shellR,
          ty: sun.y + Math.sin(node.ang) * shellR,
          r: rand(1.4, 2.2),
          color: "#fcd34d",
          mode: "seek",
        });
        (d as Dot & { _node?: ShellNode }) ._node = node;
        state.dots.push(d);
      }
      for (const d of state.dots) {
        if (d.mode !== "seek") continue;
        const node = (d as Dot & { _node?: ShellNode })._node;
        if (node) {
          d.tx = sun.x + Math.cos(node.ang) * shellR;
          d.ty = sun.y + Math.sin(node.ang) * shellR;
        }
        if (integrateSeek(d, dt, 5)) {
          d.alpha = 0;
          if (node) node.lit = Math.min(1, node.lit + 0.5);
        }
      }
      state.dots = state.dots.filter((d) => d.alpha > 0.02);
    }

    function runWar(dt: number, w: number, h: number): void {
      const sun = state.sun;
      const t = targets();
      // Spawn invaders.
      state.spawnAcc += dt;
      while (state.spawnAcc >= 0.4 && state.dots.length < MAX_DOTS) {
        state.spawnAcc -= 0.4;
        const aim = Math.random() < 0.4 ? sun : pick(t.length ? t : [sun]);
        const p = offscreen(w, h);
        state.dots.push(
          makeDot({
            x: p.x,
            y: p.y,
            tx: aim.x,
            ty: aim.y,
            r: rand(1.8, 2.8),
            color: "#f87171",
            mode: "seek",
            faction: "invader",
            hasTrail: true,
          }),
        );
      }
      // Spawn defenders from bodies to intercept nearest invader.
      state.spawnAcc2 += dt;
      while (state.spawnAcc2 >= 0.35 && state.dots.length < MAX_DOTS) {
        state.spawnAcc2 -= 0.35;
        const invaders = state.dots.filter((d) => d.faction === "invader");
        if (!invaders.length) break;
        const from = Math.random() < 0.5 ? sun : pick(t.length ? t : [sun]);
        const tgt = pick(invaders);
        state.dots.push(
          makeDot({
            x: from.x,
            y: from.y,
            tx: tgt.x,
            ty: tgt.y,
            r: rand(1.6, 2.4),
            color: "#67e8f9",
            mode: "seek",
            faction: "defender",
            hasTrail: true,
          }),
        );
      }

      // Move + trails.
      for (const d of state.dots) {
        const dx = d.tx - d.x;
        const dy = d.ty - d.y;
        const dist = Math.hypot(dx, dy) || 1;
        const sp = 150;
        d.vx += ((dx / dist) * sp - d.vx) * Math.min(1, dt * 3);
        d.vy += ((dy / dist) * sp - d.vy) * Math.min(1, dt * 3);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.hasTrail) {
          d.trail.push({ x: d.x, y: d.y });
          if (d.trail.length > 6) d.trail.shift();
        }
      }

      // Collisions: defender vs invader, invader vs body/sun.
      const dead = new Set<Dot>();
      const invaders = state.dots.filter((d) => d.faction === "invader");
      const defenders = state.dots.filter((d) => d.faction === "defender");
      for (const inv of invaders) {
        if (dead.has(inv)) continue;
        for (const def of defenders) {
          if (dead.has(def)) continue;
          if (Math.hypot(inv.x - def.x, inv.y - def.y) < 10) {
            dead.add(inv);
            dead.add(def);
            burst((inv.x + def.x) / 2, (inv.y + def.y) / 2, "#fda4af", 6);
            break;
          }
        }
        if (dead.has(inv)) continue;
        // reached a body?
        for (const b of [sun, ...t]) {
          if (Math.hypot(inv.x - b.x, inv.y - b.y) < b.r + 3) {
            dead.add(inv);
            burst(inv.x, inv.y, b.kind === "sun" ? "#fca5a5" : b.color, 8);
            break;
          }
        }
      }
      if (dead.size) state.dots = state.dots.filter((d) => !dead.has(d));
    }

    function burst(x: number, y: number, color: string, n: number): void {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(40, 180);
        state.fx.push({
          x,
          y,
          r: rand(1, 2.2),
          maxR: 2,
          alpha: 1,
          color,
          kind: "spark",
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
        });
      }
    }

    function runMigrate(dt: number, w: number, h: number): void {
      const sun = state.sun;
      const G = 5_200_000; // gravity strength for the slingshot
      state.spawnAcc += dt;
      // Launch a fresh stream every ~3.2s from a random off-screen angle.
      if (state.spawnAcc >= 3.2 || state.t < 0.01) {
        state.spawnAcc = 0;
        const a = rand(0, Math.PI * 2);
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.max(w, h) * 0.75;
        const ox = cx + Math.cos(a) * R;
        const oy = cy + Math.sin(a) * R;
        // velocity roughly toward centre but offset for a curving pass
        const perp = a + Math.PI / 2;
        const offset = rand(60, 150) * (Math.random() < 0.5 ? 1 : -1);
        const tgx = cx + Math.cos(perp) * offset;
        const tgy = cy + Math.sin(perp) * offset;
        const vdx = tgx - ox;
        const vdy = tgy - oy;
        const vlen = Math.hypot(vdx, vdy) || 1;
        const speed = rand(150, 210);
        const count = 18;
        for (let i = 0; i < count && state.dots.length < MAX_DOTS; i++) {
          const jit = rand(-22, 22);
          state.dots.push(
            makeDot({
              x: ox + Math.cos(perp) * jit,
              y: oy + Math.sin(perp) * jit,
              vx: (vdx / vlen) * speed,
              vy: (vdy / vlen) * speed,
              r: rand(1.3, 2.4),
              color: pick(["#a5b4fc", "#7dd3fc", "#c4b5fd", "#e0e7ff"]),
              mode: "fly",
              hasTrail: true,
            }),
          );
        }
      }
      for (const d of state.dots) {
        const dx = sun.x - d.x;
        const dy = sun.y - d.y;
        const r2 = Math.max(dx * dx + dy * dy, (sun.r + 14) ** 2);
        const f = G / r2;
        const r = Math.sqrt(r2);
        d.vx += (dx / r) * f * dt;
        d.vy += (dy / r) * f * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.trail.push({ x: d.x, y: d.y });
        if (d.trail.length > 14) d.trail.shift();
      }
      const m = Math.max(w, h);
      state.dots = state.dots.filter(
        (d) => d.x > -m && d.x < w + m && d.y > -m && d.y < h + m,
      );
    }

    function runTerraform(dt: number, w: number, h: number): void {
      state.spawnAcc += dt;
      while (state.spawnAcc >= 0.5) {
        state.spawnAcc -= 0.5;
        spawnSeekBody(w, h, pick(["#86efac", "#6ee7b7", "#bef264", "#5eead4"]));
      }
      const t = targets();
      for (const d of state.dots) {
        if (d.mode !== "seek") continue;
        const bi = (d as Dot & { _bi?: number })._bi ?? 0;
        const b = t[bi];
        if (!b) {
          d.mode = "free";
          continue;
        }
        d.tx = b.x;
        d.ty = b.y;
        // drift in slowly
        const dx = d.tx - d.x;
        const dy = d.ty - d.y;
        const dist = Math.hypot(dx, dy);
        const sp = Math.min(dist, 200) * 1.1 + 24;
        d.vx += ((dx / dist) * sp - d.vx) * Math.min(1, dt * 2.2);
        d.vy += ((dy / dist) * sp - d.vy) * Math.min(1, dt * 2.2);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (dist < b.r + 6) {
          d.alpha = 0;
          state.fx.push({
            x: b.x,
            y: b.y,
            r: b.r,
            maxR: b.r + rand(16, 26),
            alpha: 0.7,
            color: d.color,
            kind: "ring",
            vx: 0,
            vy: 0,
          });
          let col = state.colonies.find((c) => c.idx === bi);
          if (!col) {
            col = { bodyKey: String(bi), idx: bi, ringR: b.r + 6, count: 0, phase: 0 };
            state.colonies.push(col);
          }
          col.count = Math.min(col.count + 1, 14);
        }
      }
      state.dots = state.dots.filter((d) => d.alpha > 0.02);
    }

    function runTrade(dt: number): void {
      const t = targets();
      for (const lane of state.lanes) lane.on = Math.min(1, lane.on + dt * 0.4);
      state.spawnAcc += dt;
      while (state.spawnAcc >= 0.18 && state.dots.length < MAX_DOTS) {
        state.spawnAcc -= 0.18;
        const ready = state.lanes.filter((l) => l.on > 0.5 && t[l.a] && t[l.b]);
        if (!ready.length) break;
        const lane = pick(ready);
        const from = Math.random() < 0.5 ? lane.a : lane.b;
        const to = from === lane.a ? lane.b : lane.a;
        const a = t[from];
        const b = t[to];
        state.dots.push(
          makeDot({
            x: a.x,
            y: a.y,
            ax: a.x,
            ay: a.y,
            tx: b.x,
            ty: b.y,
            lt: 0,
            r: rand(1.4, 2.2),
            color: pick(["#fbbf24", "#38bdf8", "#a3e635"]),
            mode: "lane",
            hasTrail: true,
          }),
        );
      }
      for (const d of state.dots) {
        if (d.mode !== "lane") continue;
        d.lt += dt * 0.7;
        const e = Math.min(1, d.lt);
        d.x = d.ax + (d.tx - d.ax) * e;
        d.y = d.ay + (d.ty - d.ay) * e;
        d.trail.push({ x: d.x, y: d.y });
        if (d.trail.length > 7) d.trail.shift();
        if (e >= 1) d.alpha = 0;
      }
      state.dots = state.dots.filter((d) => d.alpha > 0.02);
    }

    /* ── rendering ─────────────────────────────────────────────────────── */

    function render(): void {
      const g = state.globalAlpha;
      ctx.globalCompositeOperation = "lighter";

      // Trade / dyson static structures first.
      if (state.scenario === "trade") {
        const t = targets();
        for (const lane of state.lanes) {
          const a = t[lane.a];
          const b = t[lane.b];
          if (!a || !b) continue;
          ctx.globalAlpha = 0.18 * lane.on * g;
          ctx.strokeStyle = "#7dd3fc";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(a.x + (b.x - a.x) * lane.on, a.y + (b.y - a.y) * lane.on);
          ctx.stroke();
        }
      }

      if (state.scenario === "dyson") {
        const sun = state.sun;
        const shellR = sun.r * 1.85;
        // struts between adjacent lit nodes
        ctx.lineWidth = 1;
        for (let i = 0; i < state.shell.length; i++) {
          const a = state.shell[i];
          const b = state.shell[(i + 1) % state.shell.length];
          const lit = Math.min(a.lit, b.lit);
          if (lit <= 0.05) continue;
          ctx.globalAlpha = 0.5 * lit * g;
          ctx.strokeStyle = "#fcd34d";
          ctx.beginPath();
          ctx.moveTo(sun.x + Math.cos(a.ang) * shellR, sun.y + Math.sin(a.ang) * shellR);
          ctx.lineTo(sun.x + Math.cos(b.ang) * shellR, sun.y + Math.sin(b.ang) * shellR);
          ctx.stroke();
        }
        for (const s of state.shell) {
          if (s.lit <= 0.05) continue;
          const x = sun.x + Math.cos(s.ang) * shellR;
          const y = sun.y + Math.sin(s.ang) * shellR;
          dotGlow(x, y, 2.6, "#fde68a", s.lit * g);
        }
      }

      // Colonies / terraform halos.
      for (const c of state.colonies) {
        const b = state.bodies[c.idx];
        if (!b) continue;
        const frac = c.count / 10;
        if (state.scenario === "terraform") {
          ctx.globalAlpha = 0.12 * Math.min(1, c.count / 8) * g;
          ctx.fillStyle = "#86efac";
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 6 + c.count, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // orbital platform ring + a couple of station dots
          ctx.globalAlpha = 0.4 * frac * g;
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(b.x, b.y, c.ringR, 0, Math.PI * 2);
          ctx.stroke();
          const stations = Math.min(c.count, 6);
          for (let i = 0; i < stations; i++) {
            const a = c.phase * 0.6 + (i / stations) * Math.PI * 2;
            dotGlow(b.x + Math.cos(a) * c.ringR, b.y + Math.sin(a) * c.ringR, 2, b.color, g);
          }
        }
      }

      // Dots (with trails).
      for (const d of state.dots) {
        if (d.hasTrail && d.trail.length > 1) {
          ctx.globalAlpha = 0.25 * d.alpha * g;
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(d.trail[0].x, d.trail[0].y);
          for (let i = 1; i < d.trail.length; i++) ctx.lineTo(d.trail[i].x, d.trail[i].y);
          ctx.stroke();
        }
        dotGlow(d.x, d.y, d.r, d.color, d.alpha * g);
      }

      // Fx.
      for (const f of state.fx) {
        if (f.kind === "ring") {
          ctx.globalAlpha = Math.max(0, f.alpha) * g;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          dotGlow(f.x, f.y, f.r, f.color, Math.max(0, f.alpha) * g);
        }
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    function dotGlow(x: number, y: number, r: number, color: string, alpha: number): void {
      if (alpha <= 0.01) return;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.min(1, alpha) * 0.25;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ── loop ──────────────────────────────────────────────────────────── */

    function frame(now: number): void {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.round(rect.width * dpr);
      const ch = Math.round(rect.height * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      readBodies(rect);

      if (state.phase === "wait") {
        if (now - lastActivity >= IDLE_MS && state.bodies.length > 0) {
          beginScenario(rect.width, rect.height);
        }
      } else {
        update(dt, rect.width, rect.height);
      }

      render();
    }

    function onActivity(): void {
      lastActivity = performance.now();
      if (state.phase === "running") startDisperse();
    }

    const opts = { passive: true } as const;
    window.addEventListener("pointermove", onActivity, opts);
    window.addEventListener("pointerdown", onActivity, opts);
    window.addEventListener("wheel", onActivity, opts);
    window.addEventListener("keydown", onActivity, opts);
    window.addEventListener("touchstart", onActivity, opts);

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
    />
  );
}
