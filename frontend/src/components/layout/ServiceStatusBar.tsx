import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getGoogleStatus } from "@/api/google";
import { getHubStatus } from "@/api/hub";
import { getSettingsHealth } from "@/api/settings";
import { getOdooStatus } from "@/api/odoo";
import { getSttCredentialsStatus } from "@/api/meetings";
import { cn } from "@/lib/utils";

type State = "ok" | "off" | "error" | "unknown";

const DOT: Record<State, string> = {
  ok: "bg-green-500",
  off: "bg-amber-500",
  error: "bg-red-500",
  unknown: "bg-muted-foreground/40",
};

interface Service {
  key: string;
  label: string;
  state: State;
  detail: string;
  /** Where to go to connect or disconnect this service. */
  to: string;
}

function ServiceChip({ service }: { service: Service }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(service.to)}
      title={`${service.label} — ${service.detail}. Click to manage.`}
      className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[service.state])} />
      <span className="whitespace-nowrap">{service.label}</span>
    </button>
  );
}

const POLL = { staleTime: 60_000, refetchInterval: 60_000, retry: false } as const;

export function ServiceStatusBar() {
  const { data: google, isPending: googlePending } = useQuery({
    queryKey: ["google-status"],
    queryFn: getGoogleStatus,
    ...POLL,
  });
  const { data: hub } = useQuery({ queryKey: ["hub-status"], queryFn: getHubStatus, ...POLL });
  const { data: health } = useQuery({
    queryKey: ["settings-health"],
    queryFn: getSettingsHealth,
    ...POLL,
  });
  const { data: odoo } = useQuery({ queryKey: ["odoo-status"], queryFn: getOdooStatus, ...POLL });
  const { data: stt } = useQuery({
    queryKey: ["stt-credentials-status"],
    queryFn: getSttCredentialsStatus,
    ...POLL,
  });

  const services: Service[] = [];

  services.push({
    key: "google",
    label: "Google Workspace",
    state: googlePending ? "unknown" : google?.connected ? "ok" : "off",
    detail: google?.connected
      ? `signed in as ${google.email ?? "your account"}`
      : google?.configured === false
        ? "not set up on this computer"
        : "not connected",
    to: "/google",
  });

  // A build with no hub address can't connect to one, so there's nothing to show.
  if (hub?.available) {
    services.push({
      key: "hub",
      label: "The hub",
      state: hub.connected ? "ok" : hub.last_error ? "error" : "off",
      detail: hub.connected
        ? `connected as ${hub.email ?? "your account"}`
        : (hub.last_error ?? "not connected"),
      to: "/settings?section=hub",
    });
  }

  if (health) {
    services.push({
      key: "llm",
      label: health.llm.model || health.llm.provider || "Language model",
      state: health.llm.status === "ok" ? "ok" : "error",
      detail: health.llm.detail ?? `${health.llm.provider} ${health.llm.model}`,
      to: "/settings?section=llm",
    });
    services.push({
      key: "embedding",
      label: "Embeddings",
      state: health.embedding.status === "ok" ? "ok" : "error",
      detail: health.embedding.detail ?? `${health.embedding.provider} ${health.embedding.model}`,
      to: "/settings?section=llm",
    });
  }

  if (stt) {
    services.push({
      key: "stt",
      label: "Transcription",
      state: stt.present ? "ok" : "off",
      detail: stt.present ? "Google Speech credentials in place" : "no credentials on this computer",
      to: "/meetings",
    });
  }

  if (odoo) {
    services.push({
      key: "odoo",
      label: "Odoo",
      state: odoo.connected ? "ok" : "off",
      detail: odoo.connected ? `connected to ${odoo.database ?? odoo.url ?? "Odoo"}` : "not connected",
      to: "/odoo",
    });
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/30 px-5 text-xs text-muted-foreground">
      {services.map((s) => (
        <ServiceChip key={s.key} service={s} />
      ))}
    </div>
  );
}
