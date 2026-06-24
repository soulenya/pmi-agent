/**
 * AncestorRail — the narrow left rail that replaces the old sidebar.
 *
 * Top:    ancestor celestial objects as back buttons — Sun/system overview
 *         outermost, then the parent planet when inside one. Clicking an
 *         ancestor zooms back out to that level (Esc does the same).
 * Bottom: the build badge, relocated from the old sidebar.
 */
import { useNavigate, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Orbit } from "lucide-react";
import { useNavStore } from "@/stores/navStore";
import { PLANETS } from "@/lib/solarSystem";
import { BUILD_NUMBER, BUILD_DATE } from "@/version";

export function AncestorRail() {
  const navigate = useNavigate();
  const { path, planet, moon, isSun, satellite } = useNavStore();

  const atOverview = path.length === 0;

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

      {/* Top-level categories — the planets, always selectable */}
      {PLANETS.map((p) => {
        const active = planet?.id === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/planet/${p.id}`)}
            title={p.label}
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
