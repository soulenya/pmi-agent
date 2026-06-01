import { Bell, LogOut, User } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { logout as apiLogout } from "@/api/auth";

export function Header() {
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
      <div />

      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button
          className="relative rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

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
