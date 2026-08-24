import { useLocation, useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { hostOf } from "@/api/browser";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";

/**
 * Collapsed research browser, docked in the navigation rail. The window itself
 * is hidden while the user is elsewhere in the app, so this is what says the
 * session is still alive and gets them back to it.
 */
export function BrowserDock() {
  const navigate = useNavigate();
  const location = useLocation();
  const { open, url, title } = useBrowserSessionStore();

  if (!open || location.pathname === "/browser") return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/browser")}
      title={`Research browser — ${title || url}`}
      className="mt-1 flex h-9 w-9 shrink-0 animate-pulse items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-110"
    >
      <Compass className="h-4 w-4" />
      <span className="sr-only">{title || hostOf(url)}</span>
    </button>
  );
}
