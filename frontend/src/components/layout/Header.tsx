import { LogOut, User, Search, AudioLines, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";
import { useVoiceAssistantStore } from "@/stores/voiceAssistantStore";
import { logout as apiLogout } from "@/api/auth";
import { getSettings } from "@/api/settings";
import { NotificationDropdown } from "@/components/NotificationDropdown";
import { ModelSwitcher } from "@/components/ModelSwitcher";
import { ServiceMenu } from "@/components/ServiceMenu";
import { ChatSidebarToggle } from "./ChatSidebar";
import { FeedbackButton } from "./FeedbackButton";
import { MeetingRecorderIndicator } from "./MeetingRecorderIndicator";
import { cn } from "@/lib/utils";
import { modLabel } from "@/lib/platform";

interface HeaderProps {
  onOpenPalette: () => void;
}

function VoiceLauncher() {
  const { data: appSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
  });
  const voiceEnabled = appSettings?.google_key_set ?? false;
  const active = useVoiceAssistantStore((s) => s.active);
  const starting = useVoiceAssistantStore((s) => s.starting);
  const requestToggle = useVoiceAssistantStore((s) => s.requestToggle);

  if (!voiceEnabled) return null;

  return (
    <button
      onClick={requestToggle}
      disabled={starting}
      title={active ? "End voice session (Esc)" : "Talk with Little Gerry"}
      className={cn(
        "flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium shadow-lg transition-colors disabled:opacity-60",
        active
          ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
          : "voice-cta bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <AudioLines className="h-5 w-5" />}
      <span className="hidden md:inline">{active ? "End voice session" : "Talk with Little Gerry"}</span>
    </button>
  );
}

export function Header({ onOpenPalette }: HeaderProps) {
  const { user, refreshToken, logout } = useAuthStore();

  async function handleLogout() {
    if (refreshToken) {
      try {
        await apiLogout(refreshToken);
      } catch {
        // Proceed with local logout even if API call fails
      }
    }
    logout();
  }

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-2">
        {/* ⌘K palette trigger */}
        <button
          onClick={onOpenPalette}
          className="flex items-center gap-2 rounded-md border bg-muted px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title={`Open command palette (${modLabel("K")})`}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline text-xs">Search…</span>
          <kbd className="hidden sm:flex h-5 items-center rounded bg-background border px-1.5 text-[10px] font-medium ml-1">
            {modLabel("K")}
          </kbd>
        </button>

        {/* Service controls (restart / update / stop) */}
        <ServiceMenu />
      </div>

      {/* Central voice hot button */}
      <VoiceLauncher />

      <div className="flex items-center gap-3">
        {/* Meeting auto-capture status */}
        <MeetingRecorderIndicator />

        {/* Model switcher */}
        <ModelSwitcher />

        {/* Chat sidebar toggle */}
        <ChatSidebarToggle />

        {/* Feedback */}
        <FeedbackButton />

        {/* Notifications */}
        <NotificationDropdown />

        {/* User avatar + name */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <User className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">{user?.display_name ?? "..."}</span>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Log out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
