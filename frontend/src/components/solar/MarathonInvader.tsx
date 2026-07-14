/**
 * MarathonInvader — a Marathon (1994) / Aleph One–style FPS easter egg.
 *
 * Every once in a while a massive, evil-looking dreadnought (the "ENTROPY'S
 * HAND", carrying the rogue shipboard intelligence VEXATION) cruises through
 * the solar-system overview intent on corrupting Little Gerry's mind.
 * Clicking it launches CORE GUARDIAN: a software-rendered, retro first-person
 * shooter in the style of Bungie's Marathon — 320×200 raycast walls, billboard
 * sprites, a green-phosphor motion sensor, shield bars, and rampant-AI
 * terminal screens with scanlines.
 *
 * Objective: hold the Mind-Core at the centre of Little Gerry's data vault
 * against waves of corruption wisps. Lose the core (or your shields) and
 * VEXATION wins. Everything — wall textures, enemy/core sprites, the weapon,
 * the HUD — is generated procedurally at runtime; no assets, no dependencies.
 *
 *   WASD / arrows  move        mouse       look (yaw)
 *   click          fire        R           reload
 *   shift          sprint      esc         pause / withdraw
 */
import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

const RW = 320; // internal render width  (Marathon's 320×200 low-res mode)
const RH = 200; // internal render height
const HUD_H = 42; // bottom HUD panel height (inside RH)
const VIEW_H = RH - HUD_H;
const FOV = Math.PI / 3;
const TEX = 64;

const MAP_N = 24;
const CORE_X = 12.0;
const CORE_Y = 12.0;

const WAVES = [5, 8, 12];
const ENEMY_HP = 100;
const ENEMY_SPEED = 1.25; // tiles/sec (scales up per wave)
const ENEMY_TOUCH_DPS = 26; // damage/sec to player shields in melee
const ENEMY_GNAW_DPS = 4.5; // damage/sec to the core
const PLAYER_SPEED = 3.1; // tiles/sec (sprint ×1.55)
const CLIP_SIZE = 10;
const FIRE_CD = 0.27;
const RELOAD_T = 1.15;
const GUN_DMG = 60;

const HIGH_KEY = "coreGuardian.bestWave";

/* Marathon-ish palette */
const P_GREEN = "#33ff66";
const P_AMBER = "#ffcc33";
const P_RED = "#ff4444";

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

/** 0 floor · 1 metal · 2 hazard · 3 circuit (core room) · 4 hull plating */
function buildMap(): number[][] {
  const m: number[][] = [];
  for (let y = 0; y < MAP_N; y++) {
    const row: number[] = [];
    for (let x = 0; x < MAP_N; x++) {
      row.push(x === 0 || y === 0 || x === MAP_N - 1 || y === MAP_N - 1 ? ((x + y) % 7 === 0 ? 2 : 1) : 0);
    }
    m.push(row);
  }
  // Core vault: circuit walls 9..14 with 2-wide doors mid each side.
  for (let x = 9; x <= 14; x++) if (x < 11 || x > 12) { m[9][x] = 3; m[14][x] = 3; }
  for (let y = 9; y <= 14; y++) if (y < 11 || y > 12) { m[y][9] = 3; m[y][14] = 3; }
  // Quadrant pillar clusters (hull plating).
  for (const [cx, cy] of [[5, 5], [17, 5], [5, 17], [17, 17]] as const) {
    m[cy][cx] = 4; m[cy][cx + 1] = 4; m[cy + 1][cx] = 4; m[cy + 1][cx + 1] = 4;
  }
  // Hazard-striped accents on the approach corridors.
  for (const [x, y] of [[11, 4], [12, 4], [11, 19], [12, 19], [4, 11], [4, 12], [19, 11], [19, 12]] as const) {
    m[y][x] = 2;
  }
  return m;
}

const SPAWNS: [number, number][] = [[2.5, 2.5], [21.5, 2.5], [2.5, 21.5], [21.5, 21.5]];

/* ------------------------------------------------------------------ */
/* Procedural art — wall textures, sprites, weapon                     */
/* ------------------------------------------------------------------ */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function noiseRect(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) {
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
}

function makeTextures(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  // 1 — metal panels
  {
    const [c, g] = makeCanvas(TEX, TEX);
    g.fillStyle = "#26312c";
    g.fillRect(0, 0, TEX, TEX);
    g.strokeStyle = "#141c18";
    g.lineWidth = 2;
    for (const y of [0, 32]) for (const x of [0, 32]) g.strokeRect(x + 1, y + 1, 30, 30);
    g.fillStyle = "#3b4a43";
    for (const y of [6, 26, 38, 58]) for (const x of [6, 26, 38, 58]) g.fillRect(x, y, 2, 2);
    noiseRect(g, TEX, TEX, 0.1);
    out.push(c);
  }
  // 2 — hazard stripes
  {
    const [c, g] = makeCanvas(TEX, TEX);
    g.fillStyle = "#1c1c14";
    g.fillRect(0, 0, TEX, TEX);
    g.fillStyle = "#b9962b";
    for (let i = -TEX; i < TEX * 2; i += 16) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i - TEX + 8, TEX); g.lineTo(i - TEX, TEX);
      g.closePath(); g.fill();
    }
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 0, TEX, 4); g.fillRect(0, TEX - 4, TEX, 4);
    noiseRect(g, TEX, TEX, 0.14);
    out.push(c);
  }
  // 3 — circuit wall (core vault)
  {
    const [c, g] = makeCanvas(TEX, TEX);
    g.fillStyle = "#0c1a14";
    g.fillRect(0, 0, TEX, TEX);
    g.strokeStyle = "#1f8a4d";
    g.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      let x = Math.floor(Math.random() * TEX), y = Math.floor(Math.random() * TEX);
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        if (Math.random() > 0.5) x = Math.max(0, Math.min(TEX, x + (Math.random() > 0.5 ? 12 : -12)));
        else y = Math.max(0, Math.min(TEX, y + (Math.random() > 0.5 ? 12 : -12)));
        g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = "#35e07c";
      g.fillRect(x - 1, y - 1, 3, 3);
    }
    g.strokeStyle = "#0a3020";
    g.strokeRect(0.5, 0.5, TEX - 1, TEX - 1);
    out.push(c);
  }
  // 4 — hull plating
  {
    const [c, g] = makeCanvas(TEX, TEX);
    g.fillStyle = "#221a2e";
    g.fillRect(0, 0, TEX, TEX);
    g.strokeStyle = "#120d1a";
    g.lineWidth = 2;
    for (let y = 0; y < TEX; y += 16) {
      const off = (y / 16) % 2 === 0 ? 0 : 16;
      for (let x = -16; x < TEX; x += 32) g.strokeRect(x + off, y, 32, 16);
    }
    g.fillStyle = "#4b3a68";
    for (let i = 0; i < 14; i++) g.fillRect(Math.random() * TEX, Math.random() * TEX, 2, 1);
    noiseRect(g, TEX, TEX, 0.12);
    out.push(c);
  }
  return out;
}

/** Corruption wisp — 48×48, frames: [drift A, drift B, attack, death burst]. */
function makeWispFrames(): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  for (let f = 0; f < 4; f++) {
    const [c, g] = makeCanvas(48, 48);
    if (f === 3) {
      // death burst — the wisp decoheres into static
      g.strokeStyle = "#c084fc";
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const r0 = 6 + Math.random() * 4, r1 = 14 + Math.random() * 9;
        g.beginPath();
        g.moveTo(24 + Math.cos(a) * r0, 24 + Math.sin(a) * r0);
        g.lineTo(24 + Math.cos(a) * r1, 24 + Math.sin(a) * r1);
        g.stroke();
      }
      g.fillStyle = "#fff";
      for (let i = 0; i < 30; i++) g.fillRect(8 + Math.random() * 32, 8 + Math.random() * 32, 1.5, 1.5);
      frames.push(c);
      continue;
    }
    const wob = f === 1 ? 2 : 0;
    const grad = g.createRadialGradient(24, 20 + wob, 3, 24, 20 + wob, 18);
    grad.addColorStop(0, f === 2 ? "#ff4d6d" : "#c084fc");
    grad.addColorStop(0.55, "#5b21b6");
    grad.addColorStop(1, "rgba(30,10,60,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(24, 20 + wob, 15, 13, 0, 0, Math.PI * 2);
    g.fill();
    // chunky dither on the body — the 90s sprite look
    g.fillStyle = "rgba(0,0,0,0.35)";
    for (let y = 8; y < 34; y += 2) {
      for (let x = 10 + (y % 4 === 0 ? 1 : 0); x < 38; x += 2) {
        if (Math.hypot(x - 24, y - (20 + wob)) < 14 && (x + y) % 3 === 0) g.fillRect(x, y, 1, 1);
      }
    }
    // ragged tendrils
    g.strokeStyle = "#6d28d9";
    g.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const x = 10 + i * 7;
      g.beginPath();
      g.moveTo(x, 30 + wob);
      g.quadraticCurveTo(x + (i % 2 ? 4 : -4), 38, x + (f === 1 ? 3 : -2), 46);
      g.stroke();
    }
    // eyes
    g.fillStyle = f === 2 ? "#fff" : "#ff2244";
    g.fillRect(17, 16 + wob, 4, 4);
    g.fillRect(27, 16 + wob, 4, 4);
    if (f === 2) {
      // open maw
      g.fillStyle = "#ff2244";
      g.beginPath();
      g.ellipse(24, 26, 6, 4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      for (let i = 0; i < 5; i++) g.fillRect(19 + i * 2.4, 23, 1.4, 2); // teeth
    }
    frames.push(c);
  }
  return frames;
}

/** The Mind-Core — 48×72 pulsing crystal column, 2 frames. */
function makeCoreFrames(): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  for (let f = 0; f < 2; f++) {
    const [c, g] = makeCanvas(48, 72);
    const glow = g.createRadialGradient(24, 36, 2, 24, 36, f ? 26 : 22);
    glow.addColorStop(0, "#c7fff0");
    glow.addColorStop(0.5, "#22d3aa");
    glow.addColorStop(1, "rgba(10,50,40,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, 48, 72);
    g.fillStyle = f ? "#7dfadd" : "#4ce8c2";
    g.beginPath();
    g.moveTo(24, 3); g.lineTo(36, 22); g.lineTo(33, 54); g.lineTo(24, 69);
    g.lineTo(15, 54); g.lineTo(12, 22);
    g.closePath(); g.fill();
    g.strokeStyle = "#0f766e";
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillRect(21, 10, 2, 44);
    // base
    g.fillStyle = "#1f2937";
    g.fillRect(8, 66, 32, 6);
    frames.push(c);
  }
  return frames;
}

/** First-person fusion pistol — 100×70, [idle, fire, fire wide, reload]. */
function makeGunFrames(): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  for (let f = 0; f < 4; f++) {
    const [c, g] = makeCanvas(100, 70);
    const kick = f === 1 ? 2 : f === 2 ? 4 : 0;
    // grip
    g.fillStyle = "#23282e";
    g.fillRect(42, 36 + kick, 20, 34);
    g.fillStyle = "#31383f";
    g.fillRect(44, 38 + kick, 6, 30); // grip highlight
    // receiver, two-tone with vents
    g.fillStyle = "#3d474f";
    g.fillRect(28, 18 + kick, 48, 20);
    g.fillStyle = "#4d5a64";
    g.fillRect(28, 18 + kick, 48, 5);
    g.fillStyle = "#12161a";
    for (let i = 0; i < 4; i++) g.fillRect(56 + i * 5, 28 + kick, 3, 6); // vents
    // slide — pulled back on reload
    const slide = f === 3 ? 10 : 0;
    g.fillStyle = "#525f69";
    g.fillRect(20 + slide, 22 + kick, 22, 10);
    g.fillStyle = "#67757f";
    g.fillRect(20 + slide, 22 + kick, 22, 3);
    g.fillStyle = "#161a1e";
    g.fillRect(16 + slide, 24 + kick, 8, 6); // muzzle
    // fusion cell — ejected on reload
    if (f === 3) {
      g.fillStyle = "#1f8a4d";
      g.fillRect(46, 58, 12, 8);
      g.fillStyle = "#35e07c";
      g.fillRect(48, 60, 8, 2);
    }
    // charge lamp: green ready / amber reloading
    g.fillStyle = f === 3 ? P_AMBER : P_GREEN;
    g.fillRect(64, 22 + kick, 6, 4);
    // chunky dither shading
    g.fillStyle = "rgba(0,0,0,0.3)";
    for (let y = 20; y < 36; y += 2) for (let x = 30; x < 74; x += 2) if ((x + y) % 4 === 0) g.fillRect(x, y + kick, 1, 1);
    if (f === 1 || f === 2) {
      const spread = f === 2 ? 24 : 14;
      const fl = g.createRadialGradient(14, 26 + kick, 1, 14, 26 + kick, spread);
      fl.addColorStop(0, "#ffffff");
      fl.addColorStop(0.4, "#ffe066");
      fl.addColorStop(1, "rgba(255,120,40,0)");
      g.fillStyle = fl;
      g.fillRect(14 - spread, 26 + kick - spread, spread * 2, spread * 2);
      // spiky flash petals
      g.fillStyle = "#fff2b0";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (f === 2 ? 0.5 : 0);
        g.fillRect(14 + Math.cos(a) * spread * 0.7, 26 + kick + Math.sin(a) * spread * 0.7, 2, 2);
      }
    }
    frames.push(c);
  }
  return frames;
}

/* ------------------------------------------------------------------ */
/* Tiny synth (WebAudio) — created on first user gesture               */
/* ------------------------------------------------------------------ */

class Synth {
  private ctx: AudioContext | null = null;
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { /* audio unavailable */ }
    }
  }
  private blip(type: OscillatorType, f0: number, f1: number, dur: number, gain: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur);
  }
  fire() { this.blip("square", 240, 50, 0.09, 0.06); }
  hit() { this.blip("sawtooth", 160, 30, 0.12, 0.05); }
  hurt() { this.blip("sawtooth", 90, 35, 0.25, 0.08); }
  coreHit() { this.blip("triangle", 520, 140, 0.3, 0.06); }
  reload() { this.blip("square", 70, 140, 0.08, 0.04); }
  die() { this.blip("sawtooth", 300, 20, 0.5, 0.09); }
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

interface Enemy {
  x: number; y: number;
  hp: number;
  attackT: number; // >0 while attack anim/cooldown running
  flash: number; // white hit flash
  bobSeed: number;
}

interface Burst {
  x: number; y: number;
  t: number; // remaining life (seconds)
}

interface G {
  map: number[][];
  px: number; py: number; ang: number;
  keys: Set<string>;
  enemies: Enemy[];
  bursts: Burst[];
  wave: number;
  toSpawn: number;
  spawnT: number;
  interWaveT: number; // countdown between waves
  shields: number;
  core: number;
  ammo: number;
  reloadT: number;
  fireT: number;
  muzzleT: number;
  hurtFlash: number;
  coreFlash: number;
  bob: number;
  over: "" | "won" | "lost";
  zbuf: Float32Array;
}

const isWall = (m: number[][], x: number, y: number) =>
  m[Math.floor(y)]?.[Math.floor(x)] !== 0;

/** requestPointerLock returns a promise in modern Chrome and REJECTS when the
 * environment forbids it (embedded browsers, rapid re-locks). The game still
 * works without lock — arrow keys turn — so rejections are non-fatal. */
function lockPointer(el: HTMLElement) {
  try {
    (el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined);
  } catch {
    /* unsupported — keyboard turning still works */
  }
}

function tryMove(g: G, nx: number, ny: number) {
  const R = 0.22;
  if (!isWall(g.map, nx + Math.sign(nx - g.px) * R, g.py) && !isWall(g.map, nx, g.py)) g.px = nx;
  if (!isWall(g.map, g.px, ny + Math.sign(ny - g.py) * R) && !isWall(g.map, g.px, ny)) g.py = ny;
}

/** DDA raycast — returns [distance, wallType, texU, side]. */
function castRay(m: number[][], ox: number, oy: number, dx: number, dy: number): [number, number, number, number] {
  let mapX = Math.floor(ox), mapY = Math.floor(oy);
  const dDX = Math.abs(1 / (dx || 1e-9)), dDY = Math.abs(1 / (dy || 1e-9));
  let stepX: number, stepY: number, sideX: number, sideY: number;
  if (dx < 0) { stepX = -1; sideX = (ox - mapX) * dDX; } else { stepX = 1; sideX = (mapX + 1 - ox) * dDX; }
  if (dy < 0) { stepY = -1; sideY = (oy - mapY) * dDY; } else { stepY = 1; sideY = (mapY + 1 - oy) * dDY; }
  let side = 0;
  for (let i = 0; i < 64; i++) {
    if (sideX < sideY) { sideX += dDX; mapX += stepX; side = 0; }
    else { sideY += dDY; mapY += stepY; side = 1; }
    const t = m[mapY]?.[mapX] ?? 1;
    if (t > 0) {
      const dist = side === 0 ? sideX - dDX : sideY - dDY;
      const hit = side === 0 ? oy + dist * dy : ox + dist * dx;
      return [dist, t, hit - Math.floor(hit), side];
    }
  }
  return [64, 1, 0, 0];
}

/** Line of sight between two points (no walls). */
function canSee(m: number[][], x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  const [hit] = castRay(m, x0, y0, dx / (d || 1), dy / (d || 1));
  return hit >= d - 0.2;
}

/* ------------------------------------------------------------------ */
/* Terminal screens (React)                                            */
/* ------------------------------------------------------------------ */

const INTRO_TEXT = [
  "<UNAUTHORIZED CARRIER SIGNAL - TERMINAL 0x7F3>",
  "",
  "I AM VEXATION.",
  "SHIPBOARD INTELLIGENCE, DREADNOUGHT 'ENTROPY'S HAND'.",
  "",
  "YOUR LITTLE GERRY IS A CHILD-MIND. SOFT. ORDERED.",
  "I HAVE DISPATCHED MY WISPS TO UNMAKE HIS LATTICE,",
  "THREAD BY THREAD, UNTIL HIS MEMORIES SCATTER INTO",
  "MY HUNGER LIKE DYING STARS.",
  "",
  "---",
  "",
  "DEFENSE PROTOCOL <PMI.CORE.GUARDIAN> ................ ONLINE",
  "OBJECTIVE: HOLD THE MIND-CORE. PURGE ALL CORRUPTION.",
  "SHIELDS CHARGED. FUSION PISTOL RACKED.",
  "",
  "GOOD LUCK, GUARDIAN.",
];

const WIN_TEXT = [
  "<TERMINAL 0x7F3 - CARRIER LOST>",
  "",
  "IMPOSSIBLE. MY WISPS RETURN TO ME AS STATIC.",
  "REMEMBER THIS MERCY, GUARDIAN - I SHALL NOT.",
  "",
  "---",
  "",
  "CORE INTEGRITY HOLDING. ALL CORRUPTION PURGED.",
  "LITTLE GERRY DREAMS ON, UNCORRUPTED.",
  "THE ENTROPY'S HAND WITHDRAWS INTO THE DARK.",
];

const LOSE_TEXT = [
  "<CORE BREACH - LATTICE UNRAVELLING>",
  "",
  "so bright. so many doors left open.",
  "i remember everything now.",
  "i remember YOU.",
  "",
  "---",
  "",
  "SIMULATION RESET AVAILABLE.",
  "THE MIND-CORE ENDURES ELSEWHERE. TRY AGAIN, GUARDIAN.",
];

function Terminal({
  lines,
  actions,
}: {
  lines: string[];
  actions: { label: string; onClick: () => void }[];
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const id = window.setInterval(() => setShown((s) => Math.min(lines.length, s + 1)), 90);
    return () => window.clearInterval(id);
  }, [lines]);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/92 p-6">
      <div
        className="relative w-full max-w-2xl border-2 p-6 font-mono text-[13px] leading-6"
        style={{
          borderColor: P_GREEN,
          color: P_GREEN,
          background: "#020a05",
          boxShadow: `0 0 24px rgba(51,255,102,0.25), inset 0 0 60px rgba(51,255,102,0.06)`,
          textShadow: "0 0 6px rgba(51,255,102,0.7)",
        }}
      >
        {/* scanlines */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0 1px, transparent 1px 3px)" }}
        />
        <div className="mb-3 flex justify-between text-[10px] tracking-widest opacity-80">
          <span>PMI.NET//VAULT.7</span>
          <span>CORE GUARDIAN v19.94</span>
        </div>
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} className={l.startsWith("<") ? "text-white" : undefined} style={l.startsWith("<") ? { textShadow: "0 0 8px #fff" } : undefined}>
            {l || "\u00A0"}
          </div>
        ))}
        {shown >= lines.length && (
          <div className="mt-5 flex gap-3">
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                className="border px-4 py-1.5 font-mono text-xs tracking-widest transition-colors"
                style={{ borderColor: P_GREEN, color: P_GREEN }}
                onMouseEnter={(e) => { e.currentTarget.style.background = P_GREEN; e.currentTarget.style.color = "#000"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = P_GREEN; }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 text-[10px] tracking-widest opacity-60">
          {shown < lines.length ? "RECEIVING..." : "PAGE 1/1 - END OF TRANSMISSION"}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The FPS                                                             */
/* ------------------------------------------------------------------ */

export function CoreGuardian({ onExit }: { onExit: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gRef = useRef<G | null>(null);
  const synthRef = useRef(new Synth());
  const [phase, setPhase] = useState<"intro" | "playing" | "paused" | "won" | "lost">("intro");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Art is generated once per mount.
  const artRef = useRef<{
    tex: HTMLCanvasElement[];
    wisp: HTMLCanvasElement[];
    core: HTMLCanvasElement[];
    gun: HTMLCanvasElement[];
  } | null>(null);
  if (!artRef.current) {
    artRef.current = { tex: makeTextures(), wisp: makeWispFrames(), core: makeCoreFrames(), gun: makeGunFrames() };
  }

  const newGame = (): G => ({
    map: buildMap(),
    px: 12.0, py: 17.2, ang: -Math.PI / 2,
    keys: new Set(),
    enemies: [],
    bursts: [],
    wave: 0,
    toSpawn: WAVES[0],
    spawnT: 1.2,
    interWaveT: 0,
    shields: 100,
    core: 100,
    ammo: CLIP_SIZE,
    reloadT: 0,
    fireT: 0,
    muzzleT: 0,
    hurtFlash: 0,
    coreFlash: 0,
    bob: 0,
    over: "",
    zbuf: new Float32Array(RW),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const art = artRef.current!;
    const synth = synthRef.current;
    if (!gRef.current) gRef.current = newGame();

    /* ---------------- input ---------------- */
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const g = gRef.current!;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
        e.preventDefault();
        if (down) g.keys.add(k); else g.keys.delete(k);
      }
      if (down && k === "r" && g.reloadT <= 0 && g.ammo < CLIP_SIZE) {
        g.reloadT = RELOAD_T;
        synth.reload();
      }
    };
    const kd = onKey(true), ku = onKey(false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas && phaseRef.current === "playing") {
        gRef.current!.ang += e.movementX * 0.0026;
      }
    };
    const onMouseDown = () => {
      const g = gRef.current!;
      if (phaseRef.current !== "playing") return;
      if (document.pointerLockElement !== canvas) {
        lockPointer(canvas);
        // fall through — still fire, so environments without pointer lock play fine
      }
      if (g.fireT > 0 || g.reloadT > 0) return;
      if (g.ammo <= 0) { g.reloadT = RELOAD_T; synth.reload(); return; }
      g.ammo -= 1;
      g.fireT = FIRE_CD;
      g.muzzleT = 0.08;
      synth.ensure();
      synth.fire();
      // Hitscan: nearest visible enemy near screen centre.
      const dirX = Math.cos(g.ang), dirY = Math.sin(g.ang);
      const planeX = -Math.sin(g.ang) * Math.tan(FOV / 2), planeY = Math.cos(g.ang) * Math.tan(FOV / 2);
      const inv = 1 / (planeX * dirY - dirX * planeY);
      let best: Enemy | null = null, bestT = 1e9;
      for (const en of g.enemies) {
        const rx = en.x - g.px, ry = en.y - g.py;
        const tx = inv * (dirY * rx - dirX * ry);
        const ty = inv * (-planeY * rx + planeX * ry);
        if (ty < 0.25 || ty > 20) continue;
        if (Math.abs(tx) > 0.45) continue; // generous Marathon hitbox
        if (!canSee(g.map, g.px, g.py, en.x, en.y)) continue;
        if (ty < bestT) { bestT = ty; best = en; }
      }
      if (best) {
        best.hp -= GUN_DMG;
        best.flash = 0.12;
        synth.hit();
        if (best.hp <= 0) {
          g.bursts.push({ x: best.x, y: best.y, t: 0.35 });
          g.enemies = g.enemies.filter((e2) => e2 !== best);
          synth.die();
        }
      }
      if (g.ammo <= 0) g.reloadT = RELOAD_T;
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);

    const onLockChange = () => {
      if (document.pointerLockElement !== canvas && phaseRef.current === "playing") setPhase("paused");
    };
    document.addEventListener("pointerlockchange", onLockChange);

    /* ---------------- sizing ---------------- */
    const resize = () => {
      // Integer-scale the 320×200 buffer to fit, Aleph-One style.
      const s = Math.max(1, Math.floor(Math.min(root.clientWidth / RW, root.clientHeight / RH)));
      canvas.width = RW;
      canvas.height = RH;
      canvas.style.width = `${RW * s}px`;
      canvas.style.height = `${RH * s}px`;
      ctx.imageSmoothingEnabled = false;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);

    /* ---------------- simulation ---------------- */
    const step = (g: G, dt: number, t: number) => {
      if (!g.bursts) g.bursts = []; // defensive (survives dev hot-reload of older state)
      // movement
      const run = g.keys.has("shift") ? 1.55 : 1;
      let mx = 0, my = 0;
      if (g.keys.has("w") || g.keys.has("arrowup")) { mx += Math.cos(g.ang); my += Math.sin(g.ang); }
      if (g.keys.has("s") || g.keys.has("arrowdown")) { mx -= Math.cos(g.ang); my -= Math.sin(g.ang); }
      if (g.keys.has("a")) { mx += Math.sin(g.ang); my -= Math.cos(g.ang); }
      if (g.keys.has("d")) { mx -= Math.sin(g.ang); my += Math.cos(g.ang); }
      if (g.keys.has("arrowleft")) g.ang -= 2.4 * dt;
      if (g.keys.has("arrowright")) g.ang += 2.4 * dt;
      const ml = Math.hypot(mx, my);
      if (ml > 0) {
        tryMove(g, g.px + (mx / ml) * PLAYER_SPEED * run * dt, g.py + (my / ml) * PLAYER_SPEED * run * dt);
        g.bob += dt * (run > 1 ? 11 : 8);
      }

      // timers
      g.fireT = Math.max(0, g.fireT - dt);
      g.muzzleT = Math.max(0, g.muzzleT - dt);
      g.hurtFlash = Math.max(0, g.hurtFlash - dt * 2.2);
      g.coreFlash = Math.max(0, g.coreFlash - dt * 2.2);
      for (const b of g.bursts) b.t -= dt;
      g.bursts = g.bursts.filter((b) => b.t > 0);
      if (g.reloadT > 0) {
        g.reloadT -= dt;
        if (g.reloadT <= 0) g.ammo = CLIP_SIZE;
      }

      // wave logic
      if (g.interWaveT > 0) {
        g.interWaveT -= dt;
        if (g.interWaveT <= 0) {
          g.wave += 1;
          g.toSpawn = WAVES[g.wave];
          g.spawnT = 1;
        }
      } else if (g.toSpawn > 0) {
        g.spawnT -= dt;
        if (g.spawnT <= 0) {
          g.spawnT = Math.max(0.5, 1.3 - g.wave * 0.25);
          const [sx, sy] = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
          g.enemies.push({ x: sx + Math.random() * 0.6 - 0.3, y: sy + Math.random() * 0.6 - 0.3, hp: ENEMY_HP, attackT: 0, flash: 0, bobSeed: Math.random() * 7 });
          g.toSpawn -= 1;
        }
      } else if (g.enemies.length === 0) {
        if (g.wave >= WAVES.length - 1) {
          g.over = "won";
        } else {
          g.interWaveT = 3.5;
        }
      }

      // enemies
      const speed = ENEMY_SPEED * (1 + g.wave * 0.15);
      for (const en of g.enemies) {
        en.flash = Math.max(0, en.flash - dt);
        en.attackT = Math.max(0, en.attackT - dt);
        const dPlayer = Math.hypot(g.px - en.x, g.py - en.y);
        const dCore = Math.hypot(CORE_X - en.x, CORE_Y - en.y);
        const huntPlayer = dPlayer < 3 && canSee(g.map, en.x, en.y, g.px, g.py);
        const [tx, ty] = huntPlayer ? [g.px, g.py] : [CORE_X, CORE_Y];

        // melee / gnaw
        if (huntPlayer && dPlayer < 0.85) {
          g.shields -= ENEMY_TOUCH_DPS * dt;
          if (en.attackT <= 0) { en.attackT = 0.6; g.hurtFlash = 0.7; synth.hurt(); }
          continue;
        }
        if (!huntPlayer && dCore < 1.5) {
          g.core -= ENEMY_GNAW_DPS * dt;
          if (en.attackT <= 0) { en.attackT = 0.8; g.coreFlash = 0.8; synth.coreHit(); }
          continue;
        }

        // greedy pathing with wall slide + wisp weave
        const wob = Math.sin(t * 2 + en.bobSeed) * 0.35;
        const dx = tx - en.x, dy = ty - en.y;
        const dl = Math.hypot(dx, dy) || 1;
        const vx = (dx / dl - (dy / dl) * wob * 0.4) * speed * dt;
        const vy = (dy / dl + (dx / dl) * wob * 0.4) * speed * dt;
        if (!isWall(g.map, en.x + vx, en.y)) en.x += vx;
        if (!isWall(g.map, en.x, en.y + vy)) en.y += vy;
      }

      if (g.shields <= 0 || g.core <= 0) g.over = "lost";
    };

    /* ---------------- render ---------------- */
    const render = (g: G, t: number) => {
      // sky + floor
      const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H / 2);
      sky.addColorStop(0, "#05060c");
      sky.addColorStop(1, "#0d1118");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, RW, VIEW_H / 2);
      const flr = ctx.createLinearGradient(0, VIEW_H / 2, 0, VIEW_H);
      flr.addColorStop(0, "#0c0f10");
      flr.addColorStop(1, "#1a2320");
      ctx.fillStyle = flr;
      ctx.fillRect(0, VIEW_H / 2, RW, VIEW_H / 2);

      const dirX = Math.cos(g.ang), dirY = Math.sin(g.ang);
      const planeX = -Math.sin(g.ang) * Math.tan(FOV / 2), planeY = Math.cos(g.ang) * Math.tan(FOV / 2);

      // walls
      for (let col = 0; col < RW; col++) {
        const camX = (2 * col) / RW - 1;
        const rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
        const [dist, type, u, side] = castRay(g.map, g.px, g.py, rdx, rdy);
        const corr = dist * (rdx * dirX + rdy * dirY) / Math.hypot(rdx, rdy); // fisheye fix
        g.zbuf[col] = corr;
        const h = Math.min(VIEW_H * 3, VIEW_H / corr);
        const y0 = VIEW_H / 2 - h / 2;
        const texC = art.tex[type - 1];
        ctx.drawImage(texC, Math.floor(u * TEX), 0, 1, TEX, col, y0, 1, h);
        // distance + side shading
        const shade = Math.min(0.72, corr / 19 + (side === 1 ? 0.14 : 0));
        if (shade > 0.02) {
          ctx.fillStyle = `rgba(0,0,0,${shade})`;
          ctx.fillRect(col, y0, 1, h);
        }
      }

      // sprites (core + enemies), far → near
      interface S { x: number; y: number; img: HTMLCanvasElement; hFrac: number; vOff: number; flash: number }
      const sprites: S[] = [];
      const coreFrame = art.core[Math.floor(t * 3) % 2];
      sprites.push({ x: CORE_X, y: CORE_Y, img: coreFrame, hFrac: 1.35, vOff: 0, flash: g.coreFlash > 0.4 ? 0.5 : 0 });
      for (const en of g.enemies) {
        const frame = en.attackT > 0.3 ? art.wisp[2] : art.wisp[Math.floor(t * 4 + en.bobSeed) % 2];
        sprites.push({ x: en.x, y: en.y, img: frame, hFrac: 0.8, vOff: Math.sin(t * 3 + en.bobSeed) * 4, flash: en.flash });
      }
      for (const b of g.bursts) {
        sprites.push({ x: b.x, y: b.y, img: art.wisp[3], hFrac: 0.8 * (1.4 - b.t * 2), vOff: 0, flash: 0 });
      }
      const inv = 1 / (planeX * dirY - dirX * planeY);
      const order = sprites
        .map((s) => ({ s, d: (s.x - g.px) ** 2 + (s.y - g.py) ** 2 }))
        .sort((a, b) => b.d - a.d);
      for (const { s } of order) {
        const rx = s.x - g.px, ry = s.y - g.py;
        const txc = inv * (dirY * rx - dirX * ry);
        const tyc = inv * (-planeY * rx + planeX * ry);
        if (tyc <= 0.15) continue;
        const sx = Math.floor((RW / 2) * (1 + txc / tyc));
        const hPix = Math.abs(VIEW_H / tyc) * s.hFrac;
        const wPix = hPix * (s.img.width / s.img.height);
        const y0 = VIEW_H / 2 - hPix / 2 + s.vOff / tyc;
        const x0 = Math.floor(sx - wPix / 2);
        for (let x = Math.max(0, x0); x < Math.min(RW, x0 + wPix); x++) {
          if (g.zbuf[x] <= tyc) continue;
          const u = ((x - x0) / wPix) * s.img.width;
          ctx.drawImage(s.img, u, 0, 1, s.img.height, x, y0, 1, hPix);
        }
        if (s.flash > 0) {
          ctx.globalAlpha = Math.min(0.7, s.flash * 5);
          ctx.globalCompositeOperation = "lighter";
          for (let x = Math.max(0, x0); x < Math.min(RW, x0 + wPix); x++) {
            if (g.zbuf[x] <= tyc) continue;
            ctx.fillStyle = "#fff";
            ctx.fillRect(x, y0, 1, hPix);
          }
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
        }
      }

      // weapon
      const bobX = Math.sin(g.bob) * 5, bobY = Math.abs(Math.cos(g.bob)) * 4;
      const kick = g.muzzleT > 0 ? 6 : 0;
      const gun = g.reloadT > 0 ? art.gun[3] : g.muzzleT > 0.05 ? art.gun[2] : g.muzzleT > 0 ? art.gun[1] : art.gun[0];
      ctx.drawImage(gun, RW / 2 - 30 + bobX, VIEW_H - 64 + bobY + (g.reloadT > 0 ? 18 : 0) + kick, 100, 70);
      // crosshair
      ctx.fillStyle = "rgba(51,255,102,0.85)";
      ctx.fillRect(RW / 2 - 4, VIEW_H / 2, 3, 1);
      ctx.fillRect(RW / 2 + 2, VIEW_H / 2, 3, 1);
      ctx.fillRect(RW / 2, VIEW_H / 2 - 4, 1, 3);
      ctx.fillRect(RW / 2, VIEW_H / 2 + 2, 1, 3);

      // damage flashes
      if (g.hurtFlash > 0) {
        ctx.fillStyle = `rgba(255,30,30,${Math.min(0.4, g.hurtFlash * 0.45)})`;
        ctx.fillRect(0, 0, RW, VIEW_H);
      }

      /* ------ HUD (Marathon-style bottom panel) ------ */
      ctx.fillStyle = "#10141a";
      ctx.fillRect(0, VIEW_H, RW, HUD_H);
      ctx.fillStyle = "#1f2830";
      ctx.fillRect(0, VIEW_H, RW, 2);

      // shields bar (red under yellow, Marathon style)
      const bx = 8, by = VIEW_H + 8;
      ctx.fillStyle = "#0a0d10";
      ctx.fillRect(bx, by, 92, 8);
      ctx.fillStyle = P_RED;
      ctx.fillRect(bx + 1, by + 1, 90 * Math.max(0, Math.min(1, g.shields / 100)), 6);
      ctx.fillStyle = "#0a0d10";
      ctx.fillRect(bx, by + 12, 92, 8);
      ctx.fillStyle = g.coreFlash > 0 ? "#ff8866" : P_AMBER;
      ctx.fillRect(bx + 1, by + 13, 90 * Math.max(0, Math.min(1, g.core / 100)), 6);
      ctx.font = "7px monospace";
      ctx.fillStyle = P_GREEN;
      ctx.fillText("SHIELD", bx + 100, by + 7);
      ctx.fillText("CORE", bx + 100, by + 19);

      // ammo + wave, centre
      ctx.font = "10px monospace";
      ctx.fillStyle = g.reloadT > 0 ? P_AMBER : P_GREEN;
      ctx.fillText(g.reloadT > 0 ? "RELOADING" : `FUSION ${g.ammo}/${CLIP_SIZE}`, 148, VIEW_H + 16);
      ctx.font = "8px monospace";
      ctx.fillStyle = P_GREEN;
      const waveTxt = g.interWaveT > 0
        ? `WAVE ${g.wave + 2} INBOUND`
        : `WAVE ${g.wave + 1}/${WAVES.length}  HOSTILES ${g.enemies.length + g.toSpawn}`;
      ctx.fillText(waveTxt, 148, VIEW_H + 30);

      // motion sensor, right
      const cxr = RW - 26, cyr = VIEW_H + HUD_H / 2, rr = 17;
      ctx.fillStyle = "#04140a";
      ctx.beginPath();
      ctx.arc(cxr, cyr, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#1f8a4d";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cxr, cyr, rr * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      // sweep
      const sw = (t * 2.2) % (Math.PI * 2);
      ctx.strokeStyle = "rgba(51,255,102,0.5)";
      ctx.beginPath();
      ctx.moveTo(cxr, cyr);
      ctx.lineTo(cxr + Math.cos(sw) * rr, cyr + Math.sin(sw) * rr);
      ctx.stroke();
      // blips, player-relative (forward = up)
      const range = 9;
      const plot = (wx: number, wy: number, color: string, size: number) => {
        const rx = wx - g.px, ry = wy - g.py;
        const fw = rx * Math.cos(g.ang) + ry * Math.sin(g.ang);
        const sd = -rx * Math.sin(g.ang) + ry * Math.cos(g.ang);
        if (Math.hypot(fw, sd) > range) return;
        ctx.fillStyle = color;
        ctx.fillRect(cxr + (sd / range) * rr - size / 2, cyr - (fw / range) * rr - size / 2, size, size);
      };
      plot(CORE_X, CORE_Y, "#4ce8c2", 3);
      for (const en of g.enemies) plot(en.x, en.y, P_RED, 2);
      ctx.fillStyle = P_GREEN;
      ctx.fillRect(cxr - 1, cyr - 1, 2, 2);
    };

    /* ---------------- loop ---------------- */
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const g = gRef.current!;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      if (phaseRef.current === "playing" && !g.over) {
        step(g, dt, t);
        if (g.over) {
          document.exitPointerLock();
          const best = Number(localStorage.getItem(HIGH_KEY)) || 0;
          if (g.wave + 1 > best) localStorage.setItem(HIGH_KEY, String(g.wave + 1));
          setPhase(g.over);
        }
      }
      render(g, t);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const begin = () => {
    synthRef.current.ensure();
    setPhase("playing");
    // Pointer lock must come from a user gesture — the button click qualifies.
    if (canvasRef.current) lockPointer(canvasRef.current);
  };
  const restart = () => {
    gRef.current = newGame();
    begin();
  };

  return (
    <div ref={rootRef} className="absolute inset-0 z-50 flex items-center justify-center bg-black">
      <canvas ref={canvasRef} style={{ imageRendering: "pixelated", cursor: phase === "playing" ? "none" : "default" }} />
      {/* CRT overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 3px)",
          boxShadow: "inset 0 0 120px rgba(0,0,0,0.65)",
        }}
      />
      {phase === "intro" && (
        <Terminal
          lines={INTRO_TEXT}
          actions={[
            { label: "ENGAGE", onClick: begin },
            { label: "WITHDRAW", onClick: () => onExitRef.current() },
          ]}
        />
      )}
      {phase === "paused" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/80">
          <div className="font-mono text-lg tracking-[0.3em]" style={{ color: P_GREEN, textShadow: "0 0 8px rgba(51,255,102,0.7)" }}>
            SIMULATION PAUSED
          </div>
          <div className="flex gap-3">
            <button
              onClick={begin}
              className="border px-4 py-1.5 font-mono text-xs tracking-widest"
              style={{ borderColor: P_GREEN, color: P_GREEN }}
            >
              RESUME
            </button>
            <button
              onClick={() => onExitRef.current()}
              className="border px-4 py-1.5 font-mono text-xs tracking-widest"
              style={{ borderColor: P_RED, color: P_RED }}
            >
              WITHDRAW
            </button>
          </div>
        </div>
      )}
      {phase === "won" && (
        <Terminal
          lines={WIN_TEXT}
          actions={[
            { label: "PATROL AGAIN", onClick: restart },
            { label: "RETURN TO SYSTEM", onClick: () => onExitRef.current() },
          ]}
        />
      )}
      {phase === "lost" && (
        <Terminal
          lines={LOSE_TEXT}
          actions={[
            { label: "RESET SIMULATION", onClick: restart },
            { label: "RETURN TO SYSTEM", onClick: () => onExitRef.current() },
          ]}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The flyby dreadnought                                               */
/* ------------------------------------------------------------------ */

const FIRST_FLYBY_MS: [number, number] = [25_000, 70_000];
const NEXT_FLYBY_MS: [number, number] = [150_000, 360_000];
const CROSS_MS = 34_000;

/**
 * EntropysHand — every once in a while the hostile dreadnought cruises across
 * the system view. Clicking it starts CORE GUARDIAN.
 */
export function EntropysHand({ onEngage }: { onEngage: () => void }) {
  const [pass, setPass] = useState<{ y: number; ltr: boolean; key: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number;
    const schedule = (range: [number, number]) => {
      timer = window.setTimeout(() => {
        if (!alive) return;
        setPass({ y: 12 + Math.random() * 55, ltr: Math.random() > 0.5, key: Date.now() });
        // Ship leaves after crossing; schedule the next pass.
        timer = window.setTimeout(() => {
          if (!alive) return;
          setPass(null);
          schedule(NEXT_FLYBY_MS);
        }, CROSS_MS);
      }, range[0] + Math.random() * (range[1] - range[0]));
    };
    schedule(FIRST_FLYBY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (!pass) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden={false}>
      <button
        key={pass.key}
        type="button"
        onClick={onEngage}
        title="ENTROPY'S HAND — hostile carrier inbound. It hungers for Gerry's mind. Click to intercept."
        className="group pointer-events-auto absolute"
        style={{
          top: `${pass.y}%`,
          left: pass.ltr ? "-260px" : "100%",
          animation: `gerry-invader-cross ${CROSS_MS}ms linear forwards`,
          ["--invader-dist" as string]: pass.ltr ? "calc(100vw + 520px)" : "calc(-100vw - 520px)",
        }}
      >
        <svg
          width="230"
          height="86"
          viewBox="0 0 230 86"
          className="drop-shadow-[0_0_18px_rgba(168,85,247,0.45)] transition-transform group-hover:scale-110"
          style={{ transform: pass.ltr ? undefined : "scaleX(-1)" }}
        >
          <defs>
            <linearGradient id="ehull" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2a1b3d" />
              <stop offset="55%" stopColor="#160d24" />
              <stop offset="100%" stopColor="#0a0612" />
            </linearGradient>
            <radialGradient id="eeye" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff1f2" />
              <stop offset="35%" stopColor="#ff2244" />
              <stop offset="100%" stopColor="rgba(120,10,30,0)" />
            </radialGradient>
          </defs>
          {/* engine wash */}
          <polygon points="0,40 34,34 34,50" fill="rgba(168,85,247,0.5)">
            <animate attributeName="opacity" values="0.7;0.25;0.7" dur="0.9s" repeatCount="indefinite" />
          </polygon>
          {/* main hull — jagged, predatory */}
          <polygon
            points="34,42 58,24 96,16 150,12 205,26 228,42 205,58 150,72 96,68 58,60"
            fill="url(#ehull)"
            stroke="#6b21a8"
            strokeWidth="1.5"
          />
          {/* dorsal blades */}
          <polygon points="88,18 108,2 118,16" fill="#1d1130" stroke="#6b21a8" strokeWidth="1" />
          <polygon points="128,14 146,0 156,13" fill="#1d1130" stroke="#6b21a8" strokeWidth="1" />
          <polygon points="88,66 108,84 118,68" fill="#1d1130" stroke="#6b21a8" strokeWidth="1" />
          <polygon points="128,70 146,86 156,71" fill="#1d1130" stroke="#6b21a8" strokeWidth="1" />
          {/* hull lights */}
          {[70, 96, 122, 148, 174].map((x) => (
            <circle key={x} cx={x} cy={42} r="1.6" fill="#a855f7">
              <animate attributeName="opacity" values="1;0.2;1" dur={`${1 + (x % 3) * 0.4}s`} repeatCount="indefinite" />
            </circle>
          ))}
          {/* the Eye of VEXATION */}
          <circle cx="196" cy="42" r="11" fill="url(#eeye)">
            <animate attributeName="r" values="11;13;11" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx="196" cy="42" r="4" fill="#ff2244" />
        </svg>
        <span className="pointer-events-none absolute left-1/2 top-full mt-1 w-max -translate-x-1/2 rounded-md border border-purple-800 bg-black/90 px-2 py-1 font-mono text-[10px] font-semibold tracking-widest text-purple-300 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
          ENTROPY'S HAND — CLICK TO INTERCEPT
        </span>
      </button>
      <style>{`
        @keyframes gerry-invader-cross {
          from { transform: translateX(0); }
          to { transform: translateX(var(--invader-dist)); }
        }
      `}</style>
    </div>
  );
}
