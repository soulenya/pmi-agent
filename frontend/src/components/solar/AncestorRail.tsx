/**
 * AncestorRail — the narrow left rail that replaces the old sidebar.
 *
 * Top:    ancestor celestial objects as back buttons — Sun/system overview
 *         outermost, then the parent planet when inside one. Clicking an
 *         ancestor zooms back out to that level (Esc does the same).
 * Bottom: ServiceMenu and the build badge, relocated from the old sidebar
 *         so no functionality is lost.
 */
import { useNavigate, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Orbit } from "lucide-react";
import { useNavStore } from "@/stores/navStore";
import { ServiceMenu } from "@/components/ServiceMenu";
import { BUILD_NUMBER, BUILD_DATE } from "@/version";

export function AncestorRail() {
  const navigate = useNavigate();
  const { path, planet, moon, isSun, satellite } = useNavStore();

  const atOverview = path.length === 0;

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center border-r bg-card py-3">
      {/* Sun / system overview — always the outermost ancestor */}
      <button
        type="button"
        onClick={() => navigate("/")}
        title={atOverview ? "Solar system" : "Back to solar system (Esc)"}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full transition-all",
          atOverview
            ? "bg-gradient-to-br from-yellow-200 via-amber-400 to-orange-500 shadow-[0_0_16px_rgba(251,191,36,0.5)]"
            : "bg-gradient-to-br from-yellow-200/70 via-amber-400/70 to-orange-500/70 opacity-80 hover:opacity-100 hover:shadow-[0_0_16px_rgba(251,191,36,0.5)]",
        )}
      >
        <Orbit className="h-5 w-5 text-amber-900/80" />
      </button>

      {/* Parent planet — shown while inside a planet or one of its moons */}
      {planet && (
        <button
          type="button"
          onClick={() => navigate(`/planet/${planet.id}`)}
          title={moon ? `Back to ${planet.label} (Esc)` : planet.label}
          className={cn(
            "mt-3 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br shadow-md transition-transform hover:scale-110",
            planet.color,
            !moon && "ring-2 ring-ring ring-offset-2 ring-offset-card",
          )}
          style={{ boxShadow: `0 0 12px ${planet.accent}55` }}
        >
          <planet.icon className="h-4 w-4 text-white/90" />
        </button>
      )}

      {/* Current location marker (moon / satellite / sun) */}
      {(moon || satellite || isSun) && (
        <div
          className="mt-3 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-accent"
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
      <ServiceMenu />
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
