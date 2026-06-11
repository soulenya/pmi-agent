import { useLocation, useParams } from "react-router-dom";
import { SolarSystemCanvas } from "@/components/solar/SolarSystemCanvas";

/** Renders the solar-system canvas at the overview ("/"), planet, or Gerry level. */
export function SolarSystemPage() {
  const { planetId } = useParams<{ planetId: string }>();
  const sunFocus = useLocation().pathname === "/gerry";
  return <SolarSystemCanvas planetId={planetId} sunFocus={sunFocus} />;
}
