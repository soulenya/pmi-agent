import { useLocation, useParams } from "react-router-dom";
import { SolarSystemCanvas } from "@/components/solar/SolarSystemCanvas";
import { BriefingPanel } from "@/components/assistant/BriefingPanel";

/** Renders the solar-system canvas at the overview ("/"), planet, or Gerry level. */
export function SolarSystemPage() {
  const { planetId } = useParams<{ planetId: string }>();
  const sunFocus = useLocation().pathname === "/gerry";
  const overview = !planetId && !sunFocus;
  return (
    <div className="relative h-full w-full">
      <SolarSystemCanvas planetId={planetId} sunFocus={sunFocus} />
      {/* Daily Assistant briefing — docked beside the solar system at the overview */}
      {overview && <BriefingPanel />}
    </div>
  );
}
