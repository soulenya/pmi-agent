/**
 * SolarSystemCanvas — the infinite-canvas navigation surface.
 *
 * Level 0: Sun (Little Gerry) at centre, two inner satellites (Dashboard,
 *          Daily Assistant), five planets on slow idle orbits.
 * Level 1: a planet at centre with its moons orbiting around it.
 *
 * Clicking the Sun opens /chat; planets zoom in (/planet/:id); moons and
 * satellites navigate to their existing flat feature routes. Transitions
 * are transform/opacity only (400–700 ms) and degrade to fades when the
 * user prefers reduced motion. Idle orbits pause automatically because the
 * canvas unmounts whenever feature content is open.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Gauge, Keyboard, Loader2 } from "lucide-react";
import {
  PLANETS,
  SATELLITES,
  SUN,
  planetById,
  type BadgeKey,
  type Moon,
  type Planet,
} from "@/lib/solarSystem";
import { listPendingApprovals, listNotifications } from "@/api/chat";
import { getPendingSuggestionCount } from "@/api/assistant";
import { useVoiceAssistantStore } from "@/stores/voiceAssistantStore";
import {
  useOrbitSpeedStore,
  ORBIT_SPEED_MIN,
  ORBIT_SPEED_MAX,
} from "@/stores/orbitSpeedStore";
import { ShuttleCursor } from "@/components/solar/ShuttleCursor";
import { AsteroidLauncher, PrecisianDefender } from "@/components/solar/PrecisianDefender";
import { MineLauncher, PrecisianSweeper } from "@/components/solar/PrecisianSweeper";
import { IdleSystemLayer } from "@/components/solar/IdleSystemLayer";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Badge counts (same sources as the old sidebar)                      */
/* ------------------------------------------------------------------ */

function useBadgeCounts(): (badge: BadgeKey | undefined) => number {
  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => listPendingApprovals(),
    refetchInterval: 30_000,
  });
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    staleTime: 30_000,
  });
  const { data: assistantPending = 0 } = useQuery({
    queryKey: ["assistant", "suggestions", "count"],
    queryFn: getPendingSuggestionCount,
    refetchInterval: 30_000,
  });

  const approvalCount = pendingApprovals.length;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (badge) => {
    if (badge === "approvals") return approvalCount;
    if (badge === "notifications") return unreadCount;
    if (badge === "assistant") return assistantPending;
    return 0;
  };
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold text-destructive-foreground shadow">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Orbital primitives                                                  */
/* ------------------------------------------------------------------ */

/**
 * Places children on a circular orbit at `radiusPct` (% of stage half-size)
 * and `angle` degrees, inside a continuously rotating ring (plain CSS
 * keyframes — deliberately NOT gated on prefers-reduced-motion, which froze
 * the whole system on machines with OS animations off). The inner element
 * counter-rotates so labels stay upright.
 */
function OrbitBody({
  radiusPct,
  angle,
  duration,
  children,
}: {
  radiusPct: number;
  angle: number;
  duration: number;
  children: React.ReactNode;
}) {
  const durationStyle = { "--orbit-duration": `${duration}s` } as React.CSSProperties;

  return (
    // Static offset to the starting angle…
    <div className="pointer-events-none absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
      {/* …then a slow continuous spin around the stage centre. */}
      <div className="orbit-spin absolute inset-0" style={durationStyle}>
        {/* Body sits at "12 o'clock", radiusPct% of the stage from centre. */}
        <div
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ top: `${50 - radiusPct}%` }}
        >
          {/* Counter-spin keeps the label upright… */}
          <div className="orbit-spin-reverse pointer-events-auto" style={durationStyle}>
            {/* …and a static counter-offset cancels the starting angle. */}
            <div style={{ transform: `rotate(${-angle}deg)` }}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrbitRing({ radiusPct }: { radiusPct: number }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/40"
      style={{ width: `${radiusPct * 2}%`, height: `${radiusPct * 2}%` }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Celestial bodies                                                    */
/* ------------------------------------------------------------------ */

function SunBody({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Little Gerry"
      className="group absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
    >
      <div
        data-idle-body="sun"
        data-idle-color="#ef4444"
        className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-red-400 via-red-500 to-red-700 shadow-[0_0_180px_24px_rgba(239,68,68,0.45)] transition-shadow group-hover:shadow-[0_0_270px_48px_rgba(239,68,68,0.7)]"
      >
        <SUN.icon className="h-9 w-9 text-red-950/80" />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="text-sm font-bold tracking-tight text-foreground">{SUN.label}</div>
        <div className="text-[11px] text-muted-foreground">Chat &amp; voice</div>
      </div>
    </button>
  );
}

/**
 * SunView — Level "gerry": a HAL-9000-style Little Gerry filling the stage.
 * Click the eye to start/stop a voice session; it pulses while speaking.
 * Typing is the secondary option — a small button inside the red.
 */
function SunView() {
  const navigate = useNavigate();
  const active = useVoiceAssistantStore((s) => s.active);
  const starting = useVoiceAssistantStore((s) => s.starting);
  const speaking = useVoiceAssistantStore((s) => s.speaking);
  const requestToggle = useVoiceAssistantStore((s) => s.requestToggle);

  const status = starting
    ? "Connecting…"
    : speaking
      ? "Speaking…"
      : active
        ? "Listening…"
        : "Click to talk";

  return (
    <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
      <button
        type="button"
        onClick={requestToggle}
        disabled={starting}
        title={active ? "End voice session (Esc)" : "Talk with Little Gerry"}
        className={cn(
          "hal-eye relative mx-auto flex h-72 w-72 items-center justify-center rounded-full transition-transform hover:scale-[1.02]",
          speaking && "hal-speaking",
          active && !speaking && "hal-listening",
        )}
        style={{
          background:
            "radial-gradient(circle at 50% 42%, #fef2f2 0%, #fca5a5 7%, #ef4444 18%, #b91c1c 38%, #7f1d1d 62%, #450a0a 84%, #1f0707 100%)",
        }}
      >
        {/* HAL specular highlight */}
        <div className="pointer-events-none absolute left-1/2 top-[16%] h-8 w-16 -translate-x-1/2 rounded-full bg-white/25 blur-md" />

        {starting && (
          <Loader2 className="absolute h-10 w-10 animate-spin text-red-100/80" />
        )}

        {/* Secondary: type instead */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            navigate("/chat");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              navigate("/chat");
            }
          }}
          title="Type instead"
          className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 text-[11px] font-medium text-red-100/90 backdrop-blur-sm transition-colors hover:bg-black/55 hover:text-white"
        >
          <Keyboard className="h-3.5 w-3.5" />
          Type
        </span>
      </button>

      <div className="mt-6 text-lg font-bold tracking-tight text-foreground">{SUN.label}</div>
      <div className="mt-1 text-sm text-muted-foreground">{status}</div>
    </div>
  );
}

function SatelliteBody({
  moon,
  count,
  onClick,
}: {
  moon: Moon;
  count: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group relative flex flex-col items-center">
      <div className="relative">
        <CountBadge count={count} />
        <div
          data-idle-body="satellite"
          data-idle-color="#ef4444"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card shadow-md transition-transform group-hover:scale-110"
        >
          <moon.icon className="h-5 w-5 text-primary" />
        </div>
      </div>
      <span className="mt-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
        {moon.label}
      </span>
    </button>
  );
}

function PlanetBody({
  planet,
  count,
  size,
  onClick,
}: {
  planet: Planet;
  count: number;
  size: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group relative flex flex-col items-center">
      <div className="relative">
        <CountBadge count={count} />
        <div
          data-idle-body="planet"
          data-idle-color={planet.accent}
          className="flex items-center justify-center rounded-full bg-foreground shadow-lg transition-transform group-hover:scale-110"
          style={{
            width: size,
            height: size,
            boxShadow: `0 0 24px ${planet.accent}55`,
          }}
        >
          <planet.icon className="h-2/5 w-2/5" style={{ color: planet.accent }} />
        </div>
      </div>

      {/* Hover preview: planet name (its moons orbit visibly with their own labels) */}
      <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-max -translate-x-1/2 group-hover:block">
        <div className="rounded-lg border bg-popover px-3 py-1.5 text-center shadow-xl">
          <div className="text-xs font-bold tracking-tight text-popover-foreground">
            {planet.label}
          </div>
        </div>
      </div>
    </button>
  );
}

/**
 * MiniMoonRing — the planet's moons orbiting it in the Level-0 system
 * overview. Each moon shows only its icon; hovering reveals the label
 * directly over the moon. Rendered as a sibling of PlanetBody (buttons
 * cannot nest) and centred on the planet circle.
 */
function MiniMoonRing({
  planet,
  size,
  onMoonClick,
}: {
  planet: Planet;
  size: number;
  onMoonClick: (moon: Moon) => void;
}) {
  const ring = size + 60; // ring diameter in px
  const duration = { "--orbit-duration": "36s" } as React.CSSProperties;

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: ring, height: ring }}
      aria-hidden={false}
    >
      <div className="absolute inset-0 rounded-full border border-border/30" />
      <div className="orbit-spin absolute inset-0" style={duration}>
        {planet.moons.map((moon, i) => {
          const angle = (360 / planet.moons.length) * i;
          return (
            <div key={moon.id} className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
              <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
                <div className="orbit-spin-reverse" style={duration}>
                  <div style={{ transform: `rotate(${-angle}deg)` }}>
                    <button
                      type="button"
                      onClick={() => onMoonClick(moon)}
                      data-idle-body="moon"
                      data-idle-color={planet.accent}
                      className="group/moon pointer-events-auto relative flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card shadow transition-transform hover:scale-125"
                    >
                      <moon.icon className="h-3 w-3" style={{ color: planet.accent }} />
                      {/* Hover label, shown over the moon */}
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-popover px-1.5 py-0.5 text-[10px] font-medium text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/moon:opacity-100">
                        {moon.label}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MoonBody({
  moon,
  count,
  onClick,
}: {
  moon: Moon;
  count: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group relative flex flex-col items-center">
      <div className="relative">
        <CountBadge count={count} />
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card shadow-md transition-transform group-hover:scale-110">
          <moon.icon className="h-6 w-6 text-primary" />
        </div>
      </div>
      <span className="mt-1.5 max-w-28 whitespace-nowrap text-xs font-medium text-muted-foreground group-hover:text-foreground">
        {moon.label}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

function SystemOverview({
  badgeCount,
  onStartGame,
  onStartSweeper,
  idleEnabled,
}: {
  badgeCount: (b: BadgeKey | undefined) => number;
  onStartGame: () => void;
  onStartSweeper: () => void;
  idleEnabled: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="relative h-full w-full">
      {/* Ambient idle behaviour — random "space dots" scenarios after 30s of
          no input; any input disperses them outward. */}
      <IdleSystemLayer enabled={idleEnabled} />
      {/* Orbit rings */}
      <OrbitRing radiusPct={SATELLITES[0].orbit * 50} />
      {PLANETS.map((p) => (
        <OrbitRing key={p.id} radiusPct={p.orbit * 50} />
      ))}

      <SunBody onClick={() => navigate(SUN.route)} />

      {/* Precisian Defender launcher — a small asteroid on its own orbit */}
      <OrbitBody radiusPct={0.39 * 50} angle={135} duration={50}>
        <AsteroidLauncher onStart={onStartGame} />
      </OrbitBody>

      {/* Precisian Sweeper launcher — a hazard beacon on its own orbit */}
      <OrbitBody radiusPct={0.46 * 50} angle={300} duration={70}>
        <MineLauncher onStart={onStartSweeper} />
      </OrbitBody>

      {SATELLITES.map((sat, i) => (
        <OrbitBody
          key={sat.id}
          radiusPct={sat.orbit * 50}
          angle={sat.angle}
          duration={90 + i * 15}
        >
          <SatelliteBody
            moon={sat}
            count={badgeCount(sat.badge)}
            onClick={() => navigate(sat.route)}
          />
        </OrbitBody>
      ))}

      {PLANETS.map((planet) => {
        const planetBadge = planet.moons.reduce((sum, m) => sum + badgeCount(m.badge), 0);
        return (
          <OrbitBody
            key={planet.id}
            radiusPct={planet.orbit * 50}
            angle={planet.angle}
            duration={60}
          >
            <div className="relative">
              <MiniMoonRing
                planet={planet}
                size={planet.size}
                onMoonClick={(moon) => navigate(moon.route)}
              />
              <PlanetBody
                planet={planet}
                count={planetBadge}
                size={planet.size}
                onClick={() => navigate(`/planet/${planet.id}`)}
              />
            </div>
          </OrbitBody>
        );
      })}
    </div>
  );
}

function PlanetView({
  planet,
  badgeCount,
}: {
  planet: Planet;
  badgeCount: (b: BadgeKey | undefined) => number;
}) {
  const navigate = useNavigate();
  const moonOrbit = 33; // % of stage half-size

  return (
    <div className="relative h-full w-full">
      <OrbitRing radiusPct={moonOrbit} />

      {/* Planet at centre */}
      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
        <div
          className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-foreground shadow-xl"
          style={{ boxShadow: `0 0 50px ${planet.accent}66` }}
        >
          <planet.icon className="h-12 w-12" style={{ color: planet.accent }} />
        </div>
        <div className="mt-2 text-base font-bold tracking-tight text-foreground">
          {planet.label}
        </div>
      </div>

      {planet.moons.map((moon, i) => {
        const angle = (360 / planet.moons.length) * i - 90;
        return (
          <OrbitBody
            key={moon.id}
            radiusPct={moonOrbit}
            angle={angle}
            duration={240}
          >
            <MoonBody
              moon={moon}
              count={badgeCount(moon.badge)}
              onClick={() => navigate(moon.route)}
            />
          </OrbitBody>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

/** Floating slider to speed up / slow down the idle orbits. */
function OrbitSpeedControl() {
  const { speed, setSpeed } = useOrbitSpeedStore();
  return (
    <div className="absolute bottom-4 left-4 z-30 flex items-center gap-2 rounded-full border bg-card/80 px-3 py-2 shadow-lg backdrop-blur">
      <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        type="range"
        min={ORBIT_SPEED_MIN}
        max={ORBIT_SPEED_MAX}
        step={0.05}
        value={speed}
        onChange={(e) => setSpeed(parseFloat(e.target.value))}
        aria-label="Orbit speed"
        title="Orbit speed"
        className="h-1.5 w-28 cursor-pointer accent-primary"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {speed.toFixed(2)}×
      </span>
    </div>
  );
}

export function SolarSystemCanvas({
  planetId,
  sunFocus,
}: {
  planetId?: string;
  sunFocus?: boolean;
}) {
  const reduced = useReducedMotion() ?? false;
  const badgeCount = useBadgeCounts();
  const planet = planetById(planetId);
  const orbitSpeed = useOrbitSpeedStore((s) => s.speed);

  // Precisian Defender mini-game — only available on the system overview.
  const [gameActive, setGameActive] = useState(false);
  const showGame = gameActive && !planet && !sunFocus;

  // Precisian Sweeper mini-game — also only on the system overview.
  const [sweeperActive, setSweeperActive] = useState(false);
  const showSweeper = sweeperActive && !planet && !sunFocus;

  // Deterministic starfield, generated once.
  const stars = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: `${(i * 37.7) % 100}%`,
        top: `${(i * 53.3) % 100}%`,
        size: 1 + ((i * 7) % 3),
        opacity: 0.15 + ((i * 13) % 40) / 100,
      })),
    [],
  );

  const zoomIn = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.65 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 1.35 },
      };

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ "--orbit-speed": orbitSpeed } as React.CSSProperties}
    >
      {/* Starfield backdrop */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {stars.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-foreground/60"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              opacity: s.opacity,
            }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={sunFocus ? "gerry" : planet ? planet.id : "system"}
          className="absolute inset-0 flex items-center justify-center"
          transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
          {...zoomIn}
        >
          {/* Square stage that fits the available area */}
          <div className="relative aspect-square h-[min(92%,92vw)] max-h-full max-w-full">
            {sunFocus ? (
              <SunView />
            ) : planet ? (
              <PlanetView planet={planet} badgeCount={badgeCount} />
            ) : (
              <SystemOverview
                badgeCount={badgeCount}
                onStartGame={() => setGameActive(true)}
                onStartSweeper={() => setSweeperActive(true)}
                idleEnabled={!showGame && !showSweeper}
              />
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Precisian Defender overlay — covers the system and captures clicks so
          planet/moon/sun navigation is blocked while the game is running. */}
      {showGame && <PrecisianDefender onExit={() => setGameActive(false)} />}

      {/* Precisian Sweeper overlay — covers the system while the game runs. */}
      {showSweeper && <PrecisianSweeper onExit={() => setSweeperActive(false)} />}

      {/* Orbit-speed slider — only on space views with visible orbits. */}
      {!sunFocus && !showGame && !showSweeper && <OrbitSpeedControl />}

      {/* Spaceship cursor with engine trail — space views only. Always mounted
          (even under reduced motion, where the engine trail is suppressed) so the
          custom cursor appears on Windows 11 machines that report reduced motion
          when system "Animation effects" are turned off. */}
      <ShuttleCursor />
    </div>
  );
}
