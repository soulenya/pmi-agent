import { useParams } from "react-router-dom";
import { SolarSystemCanvas } from "@/components/solar/SolarSystemCanvas";

/** Renders the solar-system canvas at the overview ("/") or planet level. */
export function SolarSystemPage() {
  const { planetId } = useParams<{ planetId: string }>();
  return <SolarSystemCanvas planetId={planetId} />;
}
