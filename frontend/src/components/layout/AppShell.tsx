import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AncestorRail } from "@/components/solar/AncestorRail";
import { Header } from "./Header";
import { ServiceStatusBar } from "./ServiceStatusBar";
import { StatusBar } from "./StatusBar";
import { ChatSidebar } from "./ChatSidebar";
import { WhatsNewModal } from "./WhatsNewModal";
import { FeatureGuideModal } from "./FeatureGuideModal";
import { useNotificationWS } from "@/hooks/useNotificationWS";
import { CommandPalette } from "@/components/CommandPalette";
import { PeekHost } from "@/components/PeekHost";
import { LiveMeetingAssist } from "@/components/meetings/LiveMeetingAssist";
import { SystemNoticesBanner } from "@/components/SystemNotices";
import { Toaster } from "@/components/Toaster";
import { Rail } from "@/components/workbench/Rail";
import { WorkbenchHeader } from "@/components/workbench/WorkbenchHeader";
import { AppContextProvider } from "@/contexts/AppContext";
import { useNavStore } from "@/stores/navStore";
import { usePeekStore } from "@/stores/peekStore";
import { useShellStore } from "@/stores/shellStore";
import { useVoiceAssistantStore } from "@/stores/voiceAssistantStore";
import { parentRoute } from "@/lib/solarSystem";
import { PLANET_TO_RAIL } from "@/lib/workbench";
import { cn } from "@/lib/utils";

/** Where an old-shell route lands in the workbench. Null means it stays. */
function workbenchRedirect(pathname: string): string | null {
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const syncFromPathname = useNavStore((s) => s.syncFromPathname);
  const voiceActive = useVoiceAssistantStore((s) => s.active);
  const shell = useShellStore((s) => s.shell);
  const workbench = shell === "workbench";

  // Mirror the router URL into the celestial navigation store.
  useEffect(() => {
    syncFromPathname(location.pathname);
  }, [location.pathname, syncFromPathname]);

  // Persist the current location so navigation survives an app restart.
  useEffect(() => {
    try {
      window.localStorage.setItem("nav.lastPath", location.pathname);
    } catch { /* ignore */ }
  }, [location.pathname]);

  // The old shell's screens have no place in the workbench; send them on.
  useEffect(() => {
    if (!workbench) return;
    const to = workbenchRedirect(location.pathname);
    if (to) navigate(to + location.search, { replace: true });
  }, [workbench, location.pathname, location.search, navigate]);

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
      if ((e.ctrlKey || e.metaKey) && e.key === "k" && !workbench) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented || paletteOpen || voiceActive) return;
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const dialogOpen = document.querySelector('[role="dialog"][data-state="open"]');
      if (inField || dialogOpen) return;
      // In the workbench Esc closes what is open over the page; there is no "up".
      if (workbench) {
        if (usePeekStore.getState().peek) usePeekStore.getState().close();
        return;
      }
      const parent = parentRoute(location.pathname);
      if (parent) navigate(parent);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, voiceActive, location.pathname, navigate, workbench]);

  const isCanvas =
    !workbench &&
    (location.pathname === "/" ||
      location.pathname === "/gerry" ||
      location.pathname.startsWith("/planet/"));

  return (
    <AppContextProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        {!workbench && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />}
        {workbench ? <Rail /> : <AncestorRail />}
        <div className="flex flex-1 flex-col overflow-hidden">
          {workbench ? <WorkbenchHeader /> : <Header onOpenPalette={() => setPaletteOpen(true)} />}
          <ServiceStatusBar />
          <div className="flex flex-1 overflow-hidden">
            <main
              className={cn(
                "flex-1",
                isCanvas ? "overflow-hidden" : "overflow-y-auto p-6",
              )}
            >
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
