/**
 * A hub project's Team tab: the project's channel, everyone with a role on the
 * project already in it. Opening the tab creates the channel if it does not
 * exist yet.
 */
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { Loader2, Users } from "lucide-react";

import { ensureProjectChannel } from "@/api/team";
import { TeamChannelView } from "@/components/team/TeamChannelView";
import { apiErrorText } from "@/components/waiting/WaitingForYou";

export function ProjectTeamTab({ projectId }: { projectId: string }) {
  const channel = useQuery({
    queryKey: ["team", "project-channel", projectId],
    queryFn: () => ensureProjectChannel(projectId),
    refetchInterval: 15_000,
    retry: false,
  });

  return (
    <div className="flex h-full min-h-[60vh] flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {channel.data
            ? `${channel.data.members.length} ${channel.data.members.length === 1 ? "person" : "people"} on this project. Everyone with a role here can read and write.`
            : "The project's own conversation, for the people on it."}
        </p>
        {channel.data && (
          <NavLink
            to={`/team?channel=${channel.data.id}`}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Open in Team
          </NavLink>
        )}
      </div>
      {channel.isLoading && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {channel.isError && (
        <p className="p-6 text-sm text-destructive">
          {apiErrorText(channel.error, "The project's channel could not be opened.")}
        </p>
      )}
      {channel.data && <TeamChannelView channel={channel.data} />}
    </div>
  );
}
