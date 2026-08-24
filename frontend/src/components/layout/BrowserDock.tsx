import { useLocation, useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { hostOf } from "@/api/browser";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";

/**
 * Research browser handle, always docked in the navigation rail. The window
 * itself is hidden while the user is elsewhere in the app, so this pulses to
 * say the session is still alive and gets them back to it.
 */
export function BrowserDock() {
  const navigate = useNavigate();
  const location = useLocation();
  const { open, url, title } = useBrowserSessionStore();
  const here = location.pathname === "/browser";

  return (
    <button
      type="button"
      onClick={() => navigate("/browser")}
      title={open ? `Research browser — ${title || hostOf(url) || "open"}` : "Research browser"}
      className={cn(
        "mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-md transition-transform hover:scale-110",
        open ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
        open && !here && "animate-pulse",
        here && "ring-2 ring-ring ring-offset-2 ring-offset-card",
      )}
    >
      <Compass className="h-4 w-4" />
      <span className="sr-only">Research browser</span>
    </button>
  );
}
