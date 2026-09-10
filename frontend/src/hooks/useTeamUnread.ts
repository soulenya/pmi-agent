import { useQuery } from "@tanstack/react-query";

import { listChannels } from "@/api/team";
import { useHubConnected } from "@/hooks/useAllWork";

/** Unread team-chat messages across every channel, for the rail badge. */
export function useTeamUnread(): number {
  const hub = useHubConnected();
  const { data } = useQuery({
    queryKey: ["team", "unread"],
    queryFn: async () => (await listChannels()).reduce((n, c) => n + c.unread, 0),
    enabled: hub,
    refetchInterval: 15_000,
    retry: false,
  });
  return data ?? 0;
}
