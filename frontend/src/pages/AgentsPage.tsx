import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Crown, Headphones, History, Loader2, Wrench, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAgentRoster, type AgentInfo } from "@/api/agents";

const KIND_META: Record<
  AgentInfo["kind"],
  { label: string; icon: typeof Bot; badge: string }
> = {
  supervisor: {
    label: "Router",
    icon: Crown,
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  custodian: {
    label: "Custodian",
    icon: Headphones,
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  },
  specialist: {
    label: "Specialist",
    icon: Bot,
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  },
  legacy: {
    label: "Core",
    icon: History,
    badge: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  },
};

function AgentCard({ agent }: { agent: AgentInfo }) {
  const [showTools, setShowTools] = useState(false);
  const meta = KIND_META[agent.kind];
  const Icon = meta.icon;

  return (
    <div className="flex flex-col rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent">
            <Icon className="h-4.5 w-4.5 text-accent-foreground" />
          </div>
          <div>
            <h3 className="font-semibold leading-tight">{agent.display_name}</h3>
            <span className="font-mono text-[11px] text-muted-foreground">{agent.name}</span>
          </div>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", meta.badge)}>
          {meta.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">{agent.description}</p>

      {agent.surfaces.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground/80">
          <span className="font-medium">Where:</span> {agent.surfaces.join(" · ")}
        </p>
      )}

      {agent.tools.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <button
            type="button"
            onClick={() => setShowTools((s) => !s)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Wrench className="h-3.5 w-3.5" />
            {agent.tools.length} tools
            {showTools ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showTools && (
            <div className="mt-2 flex flex-wrap gap-1">
              {agent.tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {tool}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["agents", "roster"],
    queryFn: getAgentRoster,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The multi-agent system behind Little Gerry — read-only directory, generated live
          from the running code.
          {data?.chat_provider && (
            <>
              {" "}
              Chat model: <span className="font-mono">{data.chat_provider} · {data.chat_model}</span>
            </>
          )}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading roster…
        </div>
      )}
      {isError && (
        <p className="text-sm text-destructive">Could not load the agent roster.</p>
      )}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.agents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
