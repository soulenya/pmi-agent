import { LogOut, User, Search } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { logout as apiLogout } from "@/api/auth";
import { NotificationDropdown } from "@/components/NotificationDropdown";
import { ModelSwitcher } from "@/components/ModelSwitcher";
import { ChatSidebarToggle } from "./ChatSidebar";

interface HeaderProps {
  onOpenPalette: () => void;
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
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      {/* ⌘K palette trigger */}
      <button
        onClick={onOpenPalette}
        className="flex items-center gap-2 rounded-md border bg-muted px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title="Open command palette (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline text-xs">Search…</span>
        <kbd className="hidden sm:flex h-5 items-center rounded bg-background border px-1.5 text-[10px] font-medium ml-1">
          Ctrl+K
        </kbd>
      </button>

      <div className="flex items-center gap-3">
        {/* Model switcher */}
        <ModelSwitcher />

        {/* Chat sidebar toggle */}
        <ChatSidebarToggle />

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
