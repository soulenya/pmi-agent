/**
 * Precisian Defender — a Maelstrom-style arcade mini-game that plays inside the
 * solar-system overview. The ShuttleCursor (the player's mouse) is the defender;
 * each click fires a laser bolt out of the ship's nose. Asteroids and UFOs fly
 * in from outside the window toward Little Gerry (the Sun at centre). UFOs pause
 * to fire an information-stealing beam at the planets / Little Gerry. Shoot the
 * threats, protect Little Gerry, and beat the high score.
 *
 * Rendering runs on a single <canvas> overlay via requestAnimationFrame with all
 * hot state in a mutable ref (no React re-renders per frame); only the HUD
 * (score / high score / integrity / game-over) uses React state, updated on the
 * discrete events that change it.
 *
 * Controls: move mouse to fly, click to fire, Esc or the End Game button to exit.
 */
import { useEffect, useRef, useState } from "react";
import { X, Rocket, Zap } from "lucide-react";

const HIGH_SCORE_KEY = "precisian-defender-highscore";

type RockSize = "lg" | "md" | "sm";

const ROCK_RADIUS: Record<RockSize, number> = { lg: 40, md: 26, sm: 15 };
const ROCK_SCORE: Record<RockSize, number> = { lg: 25, md: 50, sm: 100 };
const ROCK_NEXT: Record<RockSize, RockSize | null> = { lg: "md", md: "sm", sm: null };

const UFO_RADIUS = 22;
const UFO_SCORE = 500;
const CORE_RADIUS = 60; // Little Gerry's protected core

const LASER_SPEED = 720; // px/s
const LASER_LIFE = 1.2; // s
const CORE_HIT_DAMAGE = 8;
const STEAL_DAMAGE = 20;
const BEAM_DURATION = 3; // s a UFO needs to complete a steal

type WeaponKind = "single" | "auto" | "spread" | "seek";
type PowerKind = Exclude<WeaponKind, "single">;

const WEAPON_DURATION = 11; // s a power-up weapon lasts once collected
const POWERUP_LIFE = 11; // s a floating power-up persists before fading
const POWERUP_RADIUS = 13;
const SEEK_TURN = 5.2; // rad/s homing turn rate for seeking missiles
const POWERUP_KINDS: PowerKind[] = ["auto", "spread", "seek"];
const WEAPON_META: Record<PowerKind, { label: string; color: string; glyph: string }> = {
  auto: { label: "Full Auto", color: "#fbbf24", glyph: "A" },
  spread: { label: "Spread", color: "#38bdf8", glyph: "S" },
  seek: { label: "Seekers", color: "#e879f9", glyph: "M" },
};

interface Asteroid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  radius: number;
  angle: number;
  spin: number;
  verts: number[];
}

interface Laser {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  seek?: boolean;
}

interface Ufo {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  state: "approach" | "beaming" | "leaving";
  beamT: number;
  bob: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Powerup {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: PowerKind;
  life: number;
  bob: number;
}

interface GameState {
  asteroids: Asteroid[];
  lasers: Laser[];
  ufos: Ufo[];
  particles: Particle[];
  powerups: Powerup[];
  ship: { x: number; y: number; angle: number };
  mx: number;
  my: number;
  prevMx: number;
  prevMy: number;
  hasMouse: boolean;
  asteroidTimer: number;
  ufoTimer: number;
  elapsed: number;
  coreFlash: number;
  score: number;
  integrity: number;
  over: boolean;
  weapon: WeaponKind;
  weaponTimer: number;
  firing: boolean;
  fireCd: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function makeVerts(): number[] {
  const n = 11;
  return Array.from({ length: n }, () => rand(0.74, 1.12));
}

export function PrecisianDefender({ onExit }: { onExit: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gRef = useRef<GameState | null>(null);

  const [score, setScore] = useState(0);
  const [integrity, setIntegrity] = useState(100);
  const [over, setOver] = useState(false);
  const [weapon, setWeaponState] = useState<WeaponKind>("single");
  const [weaponTimer, setWeaponTimerState] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const raw = Number(localStorage.getItem(HIGH_SCORE_KEY));
    return Number.isFinite(raw) ? raw : 0;
  });

  // Keep a stable ref to onExit so the effect doesn't re-run.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = root.clientWidth;
      height = root.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);

    const G: GameState = {
      asteroids: [],
      lasers: [],
      ufos: [],
      particles: [],
      powerups: [],
      ship: { x: width / 2, y: height / 2, angle: -Math.PI / 2 },
      mx: width / 2,
      my: height / 2,
      prevMx: width / 2,
      prevMy: height / 2,
      hasMouse: false,
      asteroidTimer: 0.8,
      ufoTimer: 9,
      elapsed: 0,
      coreFlash: 0,
      score: 0,
      integrity: 100,
      over: false,
      weapon: "single",
      weaponTimer: 0,
      firing: false,
      fireCd: 0,
    };
    gRef.current = G;
    let lastShownWeaponT = -1;

    const addScore = (n: number) => {
      G.score += n;
      setScore(G.score);
    };
    const damage = (n: number) => {
      G.integrity = Math.max(0, G.integrity - n);
      G.coreFlash = 0.4;
      setIntegrity(G.integrity);
      if (G.integrity <= 0 && !G.over) {
        G.over = true;
        setOver(true);
        setHighScore((prev) => {
          const next = Math.max(prev, G.score);
          localStorage.setItem(HIGH_SCORE_KEY, String(next));
          return next;
        });
      }
    };

    const explode = (x: number, y: number, color: string, count: number) => {
      for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(40, 220);
        G.particles.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: rand(0.3, 0.7),
          maxLife: 0.7,
          color,
        });
      }
    };

    const spawnAsteroid = (size: RockSize = "lg", at?: { x: number; y: number }) => {
      let x: number;
      let y: number;
      const m = 70;
      if (at) {
        x = at.x;
        y = at.y;
      } else {
        const edge = Math.floor(rand(0, 4));
        if (edge === 0) {
          x = rand(0, width);
          y = -m;
        } else if (edge === 1) {
          x = width + m;
          y = rand(0, height);
        } else if (edge === 2) {
          x = rand(0, width);
          y = height + m;
        } else {
          x = -m;
          y = rand(0, height);
        }
      }
      // Aim toward a point near the centre (Little Gerry), with jitter.
      const tx = width / 2 + rand(-width * 0.12, width * 0.12);
      const ty = height / 2 + rand(-height * 0.12, height * 0.12);
      const ang = Math.atan2(ty - y, tx - x);
      const speed = rand(55, 95) * (1 + G.elapsed / 90) * (at ? rand(1.1, 1.6) : 1);
      G.asteroids.push({
        x,
        y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        size,
        radius: ROCK_RADIUS[size],
        angle: rand(0, Math.PI * 2),
        spin: rand(-1.4, 1.4),
        verts: makeVerts(),
      });
    };

    const splitAsteroid = (a: Asteroid) => {
      const next = ROCK_NEXT[a.size];
      addScore(ROCK_SCORE[a.size]);
      explode(a.x, a.y, "#cbd5e1", a.size === "lg" ? 18 : a.size === "md" ? 12 : 8);
      if (next) {
        spawnAsteroid(next, { x: a.x, y: a.y });
        spawnAsteroid(next, { x: a.x, y: a.y });
      }
      dropPowerup(a.x, a.y, a.size === "sm" ? 0.13 : 0.05);
    };

    const spawnUfo = () => {
      const fromLeft = Math.random() < 0.5;
      const x = fromLeft ? -UFO_RADIUS * 2 : width + UFO_RADIUS * 2;
      const y = rand(height * 0.15, height * 0.6);
      // Target Little Gerry sometimes, a planet-ring point otherwise.
      let tx = width / 2;
      let ty = height / 2;
      if (Math.random() < 0.6) {
        const ringR = Math.min(width, height) * rand(0.18, 0.34);
        const ra = rand(0, Math.PI * 2);
        tx = width / 2 + Math.cos(ra) * ringR;
        ty = height / 2 + Math.sin(ra) * ringR;
      }
      G.ufos.push({
        x,
        y,
        vx: 0,
        vy: 0,
        tx,
        ty,
        state: "approach",
        beamT: 0,
        bob: rand(0, Math.PI * 2),
      });
    };

    const spawnLaser = (angle: number, seek: boolean) => {
      const sp = seek ? LASER_SPEED * 0.6 : LASER_SPEED;
      G.lasers.push({
        x: G.ship.x,
        y: G.ship.y,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp,
        life: seek ? LASER_LIFE * 2.4 : LASER_LIFE,
        seek,
      });
    };

    const weaponCooldown = () =>
      G.weapon === "auto" ? 0.09 : G.weapon === "spread" ? 0.2 : G.weapon === "seek" ? 0.34 : 0.14;

    const fireWeapon = () => {
      if (G.over) return;
      const base = G.ship.angle;
      if (G.weapon === "spread") {
        spawnLaser(base - 0.28, false);
        spawnLaser(base - 0.1, false);
        spawnLaser(base + 0.1, false);
        spawnLaser(base + 0.28, false);
      } else if (G.weapon === "seek") {
        spawnLaser(base, true);
      } else {
        spawnLaser(base, false);
      }
    };

    const applyWeapon = (kind: WeaponKind) => {
      G.weapon = kind;
      G.weaponTimer = kind === "single" ? 0 : WEAPON_DURATION;
      setWeaponState(kind);
      setWeaponTimerState(G.weaponTimer);
    };

    const dropPowerup = (x: number, y: number, chance: number) => {
      if (Math.random() >= chance) return;
      const kind = POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
      G.powerups.push({
        x,
        y,
        vx: rand(-22, 22),
        vy: rand(-22, 22),
        kind,
        life: POWERUP_LIFE,
        bob: rand(0, Math.PI * 2),
      });
    };

    const update = (dt: number) => {
      G.elapsed += dt;
      if (G.coreFlash > 0) G.coreFlash = Math.max(0, G.coreFlash - dt);

      // Ship follows the mouse exactly; nose points along recent movement.
      G.ship.x = G.mx;
      G.ship.y = G.my;
      const mdx = G.mx - G.prevMx;
      const mdy = G.my - G.prevMy;
      if (Math.hypot(mdx, mdy) > 1) {
        const target = Math.atan2(mdy, mdx);
        let diff = ((target - G.ship.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        G.ship.angle += diff * 0.4;
      }
      G.prevMx = G.mx;
      G.prevMy = G.my;

      if (!G.over) {
        // Spawning, ramping difficulty with elapsed time.
        G.asteroidTimer -= dt;
        if (G.asteroidTimer <= 0) {
          spawnAsteroid("lg");
          G.asteroidTimer = Math.max(0.55, 1.7 - G.elapsed / 70);
        }
        G.ufoTimer -= dt;
        if (G.ufoTimer <= 0) {
          spawnUfo();
          G.ufoTimer = rand(11, 17);
        }
      }

      // Active weapon power-up countdown (reverts to the default blaster).
      if (G.weaponTimer > 0) {
        G.weaponTimer -= dt;
        if (G.weaponTimer <= 0) {
          G.weapon = "single";
          G.weaponTimer = 0;
          setWeaponState("single");
          setWeaponTimerState(0);
          lastShownWeaponT = -1;
        } else if (Math.ceil(G.weaponTimer) !== lastShownWeaponT) {
          lastShownWeaponT = Math.ceil(G.weaponTimer);
          setWeaponTimerState(lastShownWeaponT);
        }
      }

      // Held / automatic fire for the power-up weapons.
      if (G.fireCd > 0) G.fireCd -= dt;
      if (!G.over && G.firing && G.weapon !== "single" && G.fireCd <= 0) {
        fireWeapon();
        G.fireCd = weaponCooldown();
      }

      // Lasers (seekers steer toward the nearest threat before moving).
      for (const l of G.lasers) {
        if (l.seek) {
          let bx = 0;
          let by = 0;
          let bd = Infinity;
          for (const a of G.asteroids) {
            if (a.radius < 0) continue;
            const d = Math.hypot(a.x - l.x, a.y - l.y);
            if (d < bd) {
              bd = d;
              bx = a.x;
              by = a.y;
            }
          }
          for (const u of G.ufos) {
            if (u.state === "leaving") continue;
            const d = Math.hypot(u.x - l.x, u.y - l.y);
            if (d < bd) {
              bd = d;
              bx = u.x;
              by = u.y;
            }
          }
          if (bd < Infinity) {
            const desired = Math.atan2(by - l.y, bx - l.x);
            const cur = Math.atan2(l.vy, l.vx);
            const diff = ((desired - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            const maxTurn = SEEK_TURN * dt;
            const na = cur + Math.max(-maxTurn, Math.min(maxTurn, diff));
            const sp = Math.hypot(l.vx, l.vy);
            l.vx = Math.cos(na) * sp;
            l.vy = Math.sin(na) * sp;
          }
        }
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        l.life -= dt;
      }
      G.lasers = G.lasers.filter(
        (l) => l.life > 0 && l.x > -20 && l.x < width + 20 && l.y > -20 && l.y < height + 20,
      );

      // Asteroids
      for (const a of G.asteroids) {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.angle += a.spin * dt;
      }

      // Asteroid vs laser
      for (const a of G.asteroids) {
        if (a.radius < 0) continue;
        for (const l of G.lasers) {
          if (l.life <= 0) continue;
          if (Math.hypot(a.x - l.x, a.y - l.y) <= a.radius) {
            l.life = 0;
            a.radius = -1; // mark destroyed
            splitAsteroid(a);
            break;
          }
        }
      }

      // Asteroid vs core (Little Gerry)
      for (const a of G.asteroids) {
        if (a.radius < 0) continue;
        if (Math.hypot(a.x - width / 2, a.y - height / 2) <= CORE_RADIUS + a.radius * 0.5) {
          a.radius = -1;
          explode(a.x, a.y, "#f87171", 16);
          if (!G.over) damage(CORE_HIT_DAMAGE);
        }
      }

      // Cull destroyed / far-gone asteroids
      G.asteroids = G.asteroids.filter(
        (a) =>
          a.radius > 0 &&
          a.x > -160 &&
          a.x < width + 160 &&
          a.y > -160 &&
          a.y < height + 160,
      );

      // UFOs
      for (const u of G.ufos) {
        u.bob += dt * 4;
        if (u.state === "approach") {
          const dx = u.tx - u.x;
          const dy = u.ty - u.y;
          const d = Math.hypot(dx, dy);
          if (d < 6) {
            u.state = "beaming";
            u.beamT = 0;
          } else {
            const sp = 110;
            u.x += (dx / d) * sp * dt;
            u.y += (dy / d) * sp * dt;
          }
        } else if (u.state === "beaming") {
          u.beamT += dt;
          if (u.beamT >= BEAM_DURATION) {
            if (!G.over) damage(STEAL_DAMAGE);
            u.state = "leaving";
            const ang = u.x < width / 2 ? Math.PI : 0;
            u.vx = Math.cos(ang) * 170;
            u.vy = -80;
          }
        } else {
          u.x += u.vx * dt;
          u.y += u.vy * dt;
        }
      }
      // UFO vs laser
      for (const u of G.ufos) {
        if (u.state === "leaving") continue;
        for (const l of G.lasers) {
          if (l.life <= 0) continue;
          if (Math.hypot(u.x - l.x, u.y - l.y) <= UFO_RADIUS) {
            l.life = 0;
            u.state = "leaving";
            u.vx = 0;
            u.vy = -9999; // flag for removal below
            addScore(UFO_SCORE);
            explode(u.x, u.y, "#86efac", 26);
            dropPowerup(u.x, u.y, 0.65);
            break;
          }
        }
      }
      G.ufos = G.ufos.filter(
        (u) => u.vy !== -9999 && u.x > -120 && u.x < width + 120 && u.y > -160 && u.y < height + 160,
      );

      // Power-ups (drift, fade, and get collected by the ship)
      for (const pu of G.powerups) {
        pu.x += pu.vx * dt;
        pu.y += pu.vy * dt;
        pu.vx *= 0.985;
        pu.vy *= 0.985;
        pu.bob += dt * 3;
        pu.life -= dt;
        if (!G.over && Math.hypot(pu.x - G.ship.x, pu.y - G.ship.y) <= POWERUP_RADIUS + 16) {
          applyWeapon(pu.kind);
          explode(pu.x, pu.y, WEAPON_META[pu.kind].color, 16);
          pu.life = -1;
        }
      }
      G.powerups = G.powerups.filter(
        (pu) => pu.life > 0 && pu.x > -60 && pu.x < width + 60 && pu.y > -60 && pu.y < height + 60,
      );

      // Particles
      for (const p of G.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
      }
      G.particles = G.particles.filter((p) => p.life > 0);
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;

      // Protected core ring (flashes red on damage)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, CORE_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = G.coreFlash > 0 ? "rgba(248,113,113,0.9)" : "rgba(248,113,113,0.35)";
      ctx.lineWidth = G.coreFlash > 0 ? 4 : 2;
      ctx.setLineDash([6, 8]);
      ctx.stroke();
      ctx.restore();

      // UFOs + beams
      for (const u of G.ufos) {
        if (u.state === "beaming") {
          const flicker = 0.35 + Math.abs(Math.sin(u.bob * 2)) * 0.35;
          const grad = ctx.createLinearGradient(u.x, u.y, u.tx, u.ty);
          grad.addColorStop(0, `rgba(134,239,172,${flicker})`);
          grad.addColorStop(1, "rgba(134,239,172,0)");
          ctx.beginPath();
          ctx.moveTo(u.x - 4, u.y);
          ctx.lineTo(u.x + 4, u.y);
          ctx.lineTo(u.tx + 26, u.ty);
          ctx.lineTo(u.tx - 26, u.ty);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        }
        const bobY = u.y + Math.sin(u.bob) * 2;
        // Saucer
        ctx.save();
        ctx.translate(u.x, bobY);
        ctx.beginPath();
        ctx.ellipse(0, 0, UFO_RADIUS, UFO_RADIUS * 0.42, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#64748b";
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -6, UFO_RADIUS * 0.5, UFO_RADIUS * 0.42, 0, Math.PI, Math.PI * 2);
        ctx.fillStyle = "#a5f3fc";
        ctx.fill();
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(i * 7, 3, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = "#fde047";
          ctx.fill();
        }
        ctx.restore();
      }

      // Asteroids
      for (const a of G.asteroids) {
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.angle);
        ctx.beginPath();
        const n = a.verts.length;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const r = a.radius * a.verts[i];
          const px = Math.cos(ang) * r;
          const py = Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = "#475569";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#94a3b8";
        ctx.stroke();
        ctx.restore();
      }

      // Power-ups
      for (const pu of G.powerups) {
        const meta = WEAPON_META[pu.kind];
        const blink = pu.life < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(pu.bob * 3)) : 1;
        const py = pu.y + Math.sin(pu.bob) * 2;
        ctx.save();
        ctx.globalAlpha = blink;
        ctx.beginPath();
        ctx.arc(pu.x, py, POWERUP_RADIUS + 5, 0, Math.PI * 2);
        ctx.fillStyle = meta.color + "22";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pu.x, py, POWERUP_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = meta.color;
        ctx.shadowColor = meta.color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#0b1120";
        ctx.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(meta.glyph, pu.x, py + 0.5);
        ctx.restore();
      }

      // Lasers
      for (const l of G.lasers) {
        const sp = Math.hypot(l.vx, l.vy) || 1;
        const len = l.seek ? 16 : 14;
        const nx = l.vx / sp;
        const ny = l.vy / sp;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(l.x - nx * len, l.y - ny * len);
        ctx.strokeStyle = l.seek ? "#f0abfc" : "#7dd3fc";
        ctx.lineWidth = l.seek ? 4 : 3;
        ctx.lineCap = "round";
        ctx.shadowColor = l.seek ? "#e879f9" : "#38bdf8";
        ctx.shadowBlur = l.seek ? 12 : 8;
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (l.seek) {
          ctx.beginPath();
          ctx.arc(l.x, l.y, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = "#fdf4ff";
          ctx.fill();
        }
      }

      // Particles
      for (const p of G.particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const rectXY = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: MouseEvent) => {
      const p = rectXY(e);
      if (!G.hasMouse) {
        G.mx = G.prevMx = p.x;
        G.my = G.prevMy = p.y;
        G.hasMouse = true;
      }
      G.mx = p.x;
      G.my = p.y;
    };
    const onDown = (e: MouseEvent) => {
      const p = rectXY(e);
      G.mx = p.x;
      G.my = p.y;
      G.firing = true;
      if (!G.over && G.fireCd <= 0) {
        fireWeapon();
        G.fireCd = weaponCooldown();
      }
    };
    const onUp = () => {
      G.firing = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExitRef.current();
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const restart = () => {
    const G = gRef.current;
    if (!G) return;
    G.asteroids = [];
    G.lasers = [];
    G.ufos = [];
    G.particles = [];
    G.powerups = [];
    G.asteroidTimer = 0.8;
    G.ufoTimer = 9;
    G.elapsed = 0;
    G.coreFlash = 0;
    G.score = 0;
    G.integrity = 100;
    G.over = false;
    G.weapon = "single";
    G.weaponTimer = 0;
    G.firing = false;
    G.fireCd = 0;
    setScore(0);
    setIntegrity(100);
    setOver(false);
    setWeaponState("single");
    setWeaponTimerState(0);
  };

  return (
    <div ref={rootRef} className="absolute inset-0 z-40 select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* HUD — pointer-events pass through except on interactive controls */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {/* Title */}
        <div className="absolute left-4 top-4">
          <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.2em] text-sky-300 drop-shadow">
            <Rocket className="h-4 w-4" />
            Precisian Defender
          </div>
          <div className="mt-0.5 text-xs font-semibold text-rose-300/90">Protect Little Gerry!</div>
        </div>

        {/* Score / high score */}
        <div className="absolute left-1/2 top-4 -translate-x-1/2 text-center">
          <div className="text-2xl font-black tabular-nums text-foreground drop-shadow">
            {score.toLocaleString()}
          </div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            High {Math.max(highScore, score).toLocaleString()}
          </div>
        </div>

        {/* Active weapon power-up */}
        {weapon !== "single" && (
          <div
            className="absolute left-1/2 top-[70px] flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold shadow backdrop-blur"
            style={{
              borderColor: WEAPON_META[weapon].color,
              color: WEAPON_META[weapon].color,
              background: "rgba(2,6,23,0.6)",
            }}
          >
            <Zap className="h-3.5 w-3.5" />
            {WEAPON_META[weapon].label}
            <span className="tabular-nums opacity-80">{Math.max(0, weaponTimer)}s</span>
          </div>
        )}

        {/* End game */}
        <button
          type="button"
          onClick={onExit}
          className="pointer-events-auto absolute right-4 top-4 flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow backdrop-blur transition-colors hover:bg-card"
        >
          <X className="h-3.5 w-3.5" />
          End Game
          <span className="ml-1 hidden text-[10px] text-muted-foreground sm:inline">Esc</span>
        </button>

        {/* Integrity bar */}
        <div className="absolute bottom-5 left-1/2 w-64 max-w-[70%] -translate-x-1/2">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider">
            <span className="text-muted-foreground">Little Gerry integrity</span>
            <span
              className={
                integrity > 50 ? "text-emerald-400" : integrity > 25 ? "text-amber-400" : "text-rose-400"
              }
            >
              {integrity}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full border border-border bg-muted">
            <div
              className={
                "h-full rounded-full transition-[width] duration-200 " +
                (integrity > 50 ? "bg-emerald-500" : integrity > 25 ? "bg-amber-500" : "bg-rose-500")
              }
              style={{ width: `${integrity}%` }}
            />
          </div>
        </div>
      </div>

      {/* Game over */}
      {over && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="w-80 max-w-[90%] rounded-2xl border border-border bg-card p-6 text-center shadow-2xl">
            <div className="text-lg font-black uppercase tracking-wide text-rose-400">
              Little Gerry Compromised
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Score</div>
                <div className="text-xl font-black tabular-nums text-foreground">
                  {score.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Best</div>
                <div className="text-xl font-black tabular-nums text-foreground">
                  {highScore.toLocaleString()}
                </div>
              </div>
            </div>
            {score >= highScore && score > 0 && (
              <div className="mt-3 text-xs font-bold text-amber-400">New high score!</div>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={restart}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Play again
              </button>
              <button
                type="button"
                onClick={onExit}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AsteroidLauncher — the small clickable asteroid that orbits the system and
 * starts Precisian Defender when clicked.
 */
export function AsteroidLauncher({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      title="Precisian Defender — Protect Little Gerry!"
      className="group relative flex flex-col items-center"
    >
      <svg width="34" height="34" viewBox="0 0 34 34" className="transition-transform group-hover:scale-125">
        <defs>
          <radialGradient id="rock-grad" cx="38%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="60%" stopColor="#64748b" />
            <stop offset="100%" stopColor="#334155" />
          </radialGradient>
        </defs>
        <path
          d="M17 3 L25 6 L31 13 L30 22 L24 29 L15 31 L7 27 L3 19 L4 10 L10 5 Z"
          fill="url(#rock-grad)"
          stroke="#cbd5e1"
          strokeWidth="1"
        />
        <circle cx="13" cy="14" r="2.4" fill="#1e293b" opacity="0.5" />
        <circle cx="21" cy="20" r="1.8" fill="#1e293b" opacity="0.5" />
        <circle cx="22" cy="11" r="1.2" fill="#1e293b" opacity="0.4" />
      </svg>
      <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 w-max -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-[10px] font-semibold text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        Precisian Defender
      </span>
    </button>
  );
}
