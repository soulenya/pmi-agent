import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ServiceStatusBar } from "./ServiceStatusBar";
import { StatusBar } from "./StatusBar";
import { ChatSidebar } from "./ChatSidebar";
import { WhatsNewModal } from "./WhatsNewModal";
import { FeatureGuideModal } from "./FeatureGuideModal";
import { useNotificationWS } from "@/hooks/useNotificationWS";
import { PeekHost } from "@/components/PeekHost";
import { LiveMeetingAssist } from "@/components/meetings/LiveMeetingAssist";
import { SystemNoticesBanner } from "@/components/SystemNotices";
import { Toaster } from "@/components/Toaster";
import { Rail } from "@/components/workbench/Rail";
import { WorkbenchHeader } from "@/components/workbench/WorkbenchHeader";
import { AppContextProvider } from "@/contexts/AppContext";
import { usePeekStore } from "@/stores/peekStore";
import { useVoiceAssistantStore } from "@/stores/voiceAssistantStore";
import { PLANET_TO_RAIL } from "@/lib/workbench";

/** Where a route of the retired solar-system shell lands. Null means it stays. */
function legacyRedirect(pathname: string): string | null {
  if (pathname === "/") return "/today";
  if (pathname === "/gerry") return "/chat";
  if (pathname === "/dashboard") return "/today";
  if (pathname.startsWith("/planet/")) {
    const id = pathname.slice("/planet/".length);
    return PLANET_TO_RAIL[id] ?? "/today";
  }
  return null;
}

export function AppShell() {
  useNotificationWS();
  const location = useLocation();
  const navigate = useNavigate();
  const voiceActive = useVoiceAssistantStore((s) => s.active);

  // Persist the current location so navigation survives an app restart.
  useEffect(() => {
    try {
      window.localStorage.setItem("nav.lastPath", location.pathname);
    } catch { /* ignore */ }
  }, [location.pathname]);

  // Bookmarks and restored paths from the old shell are sent on.
  useEffect(() => {
    const to = legacyRedirect(location.pathname);
    if (to) navigate(to + location.search, { replace: true });
  }, [location.pathname, location.search, navigate]);

  // Guard: a file dropped outside a drop zone must never navigate the WebView
  // away to the file itself. Zones call stopPropagation, so this only catches
  // misses.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  // On boot at the bare root, restore the last visited location.
  useEffect(() => {
    try {
      const last = window.localStorage.getItem("nav.lastPath");
      if (window.location.pathname === "/" && last && last !== "/") {
        navigate(last, { replace: true });
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented || voiceActive) return;
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const dialogOpen = document.querySelector('[role="dialog"][data-state="open"]');
      if (inField || dialogOpen) return;
      // Esc closes what is open over the page; there is no "up".
      if (usePeekStore.getState().peek) usePeekStore.getState().close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voiceActive, navigate]);

  return (
    <AppContextProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Rail />
        <div className="flex flex-1 flex-col overflow-hidden">
          <WorkbenchHeader />
          <ServiceStatusBar />
          <div className="flex flex-1 overflow-hidden">
            <main className="flex-1 overflow-y-auto p-6">
              <Outlet />
            </main>
            <ChatSidebar />
          </div>
          <StatusBar />
        </div>
        <PeekHost />
        <LiveMeetingAssist />
        <SystemNoticesBanner />
        <WhatsNewModal />
        <FeatureGuideModal />
        <Toaster />
      </div>
    </AppContextProvider>
  );
}
