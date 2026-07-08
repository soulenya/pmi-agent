/**
 * AncestorRail — the narrow left rail that replaces the old sidebar.
 *
 * Top:    ancestor celestial objects as back buttons — Sun/system overview
 *         outermost, then the parent planet when inside one. Clicking an
 *         ancestor zooms back out to that level (Esc does the same).
 * Hover:  hovering a planet glides out a flyout submenu listing its moons,
 *         so any feature page is reachable from anywhere in two moves.
 * Bottom: the build badge, relocated from the old sidebar.
 */
import { useRef, useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Orbit } from "lucide-react";
import { useNavStore } from "@/stores/navStore";
import { PLANETS, type Planet } from "@/lib/solarSystem";
import { BUILD_NUMBER, BUILD_DATE } from "@/version";

/** Hover flyout listing a planet's moons; fixed-positioned so the rail's
 *  scroll container can't clip it, with a short grace timer so the pointer
 *  can cross the gap between the planet button and the panel. */
function PlanetFlyout({
  planet,
  anchor,
  activeMoonId,
  onNavigate,
  onEnter,
  onLeave,
}: {
  planet: Planet;
  anchor: DOMRect;
  activeMoonId: string | null;
  onNavigate: (route: string) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  // Keep the panel on-screen for planets near the bottom of the rail.
  const estHeight = 44 + planet.moons.length * 36;
  const top = Math.max(8, Math.min(anchor.top - 6, window.innerHeight - estHeight - 8));
  return (
    <div
      className="rail-flyout fixed z-50 min-w-48 rounded-xl border bg-popover py-1.5 shadow-xl"
      style={{ top, left: anchor.right + 10 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className="flex items-center gap-2 px-3 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider"
        style={{ color: planet.accent }}
      >
        <planet.icon className="h-3.5 w-3.5" />
        {planet.label}
      </div>
      {planet.moons.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onNavigate(m.route)}
          className={cn(
            "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground/90 transition-colors hover:bg-accent hover:text-foreground",
            activeMoonId === m.id && "bg-accent font-medium text-foreground",
          )}
        >
          <m.icon className="h-4 w-4 shrink-0" style={{ color: planet.accent }} />
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function AncestorRail() {
  const navigate = useNavigate();
  const { path, planet, moon, isSun, satellite } = useNavStore();

  const atOverview = path.length === 0;

  // Which planet's flyout is open, and where its button sits on screen.
  const [flyout, setFlyout] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const closeTimer = useRef<number | null>(null);

  function openFlyout(id: string, el: HTMLElement) {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setFlyout({ id, anchor: el.getBoundingClientRect() });
  }

  function scheduleClose() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlyout(null), 180);
  }

  function cancelClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  const flyoutPlanet = flyout ? PLANETS.find((p) => p.id === flyout.id) ?? null : null;

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r bg-card py-3">
      {/* Sun / system overview — always the outermost ancestor */}
      <button
        type="button"
        onClick={() => navigate("/")}
        title={atOverview ? "Solar system" : "Back to solar system (Esc)"}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
          atOverview
            ? "bg-gradient-to-br from-red-400 via-red-500 to-red-700 shadow-[0_0_16px_rgba(239,68,68,0.5)]"
            : "bg-gradient-to-br from-red-400/70 via-red-500/70 to-red-700/70 opacity-80 hover:opacity-100 hover:shadow-[0_0_16px_rgba(239,68,68,0.5)]",
        )}
      >
        <Orbit className="h-5 w-5 text-red-950/80" />
      </button>

      <div className="my-1 h-px w-7 shrink-0 bg-border" />

      {/* Top-level categories — the planets; hover glides out the moon menu */}
      {PLANETS.map((p) => {
        const active = planet?.id === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/planet/${p.id}`)}
            onMouseEnter={(e) => openFlyout(p.id, e.currentTarget)}
            onMouseLeave={scheduleClose}
            onFocus={(e) => openFlyout(p.id, e.currentTarget)}
            onBlur={scheduleClose}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground shadow-md transition-transform hover:scale-110",
              active && "ring-2 ring-ring ring-offset-2 ring-offset-card",
            )}
            style={{ boxShadow: `0 0 12px ${p.accent}55` }}
          >
            <p.icon className="h-4 w-4" style={{ color: p.accent }} />
          </button>
        );
      })}

      {/* Moon flyout for the hovered planet */}
      {flyout && flyoutPlanet && (
        <PlanetFlyout
          planet={flyoutPlanet}
          anchor={flyout.anchor}
          activeMoonId={moon?.id ?? null}
          onNavigate={(route) => {
            setFlyout(null);
            navigate(route);
          }}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}

      {/* Current location marker (moon / satellite / sun) */}
      {(moon || satellite || isSun) && (
        <div
          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-accent"
          title={moon?.label ?? satellite?.label ?? "Little Gerry"}
        >
          {moon ? (
            <moon.icon className="h-4 w-4 text-accent-foreground" />
          ) : satellite ? (
            <satellite.icon className="h-4 w-4 text-accent-foreground" />
          ) : (
            <span className="text-xs font-bold text-accent-foreground">LG</span>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Relocated from the old sidebar */}
      <NavLink
        to="/settings"
        className="mt-2 rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        title={`Build ${BUILD_NUMBER} — ${BUILD_DATE}. Click to see What's New.`}
      >
        b{BUILD_NUMBER}
      </NavLink>
    </nav>
  );
}
