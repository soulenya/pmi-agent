import { apiClient } from "./client";

export interface AgentInfo {
  name: string;
  display_name: string;
  kind: "supervisor" | "specialist" | "custodian" | "legacy";
  description: string;
  tools: string[];
  surfaces: string[];
}

export interface AgentRoster {
  agents: AgentInfo[];
  chat_model: string | null;
  chat_provider: string | null;
}

export async function getAgentRoster(): Promise<AgentRoster> {
  const resp = await apiClient.get<AgentRoster>("/agents");
  return resp.data;
}
