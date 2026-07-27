import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AncestorRail } from "@/components/solar/AncestorRail";
import { Header } from "./Header";
import { StatusBar } from "./StatusBar";
import { ChatSidebar } from "./ChatSidebar";
import { WhatsNewModal } from "./WhatsNewModal";
import { FeatureGuideModal } from "./FeatureGuideModal";
import { useNotificationWS } from "@/hooks/useNotificationWS";
import { CommandPalette } from "@/components/CommandPalette";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import { LiveMeetingAssist } from "@/components/meetings/LiveMeetingAssist";
import { Toaster } from "@/components/Toaster";
import { AppContextProvider } from "@/contexts/AppContext";
import { useNavStore } from "@/stores/navStore";
import { useVoiceAssistantStore } from "@/stores/voiceAssistantStore";
import { parentRoute } from "@/lib/solarSystem";
import { cn } from "@/lib/utils";

export function AppShell() {
  useNotificationWS();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const syncFromPathname = useNavStore((s) => s.syncFromPathname);
  const voiceActive = useVoiceAssistantStore((s) => s.active);

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
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      // Esc zooms out one level — unless something else owns the key
      // (voice session, command palette, an open dialog, or a focused field).
      if (e.key === "Escape" && !e.defaultPrevented && !paletteOpen && !voiceActive) {
        const target = e.target as HTMLElement | null;
        const inField =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        const dialogOpen = document.querySelector('[role="dialog"][data-state="open"]');
        if (!inField && !dialogOpen) {
          const parent = parentRoute(location.pathname);
          if (parent) navigate(parent);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, voiceActive, location.pathname, navigate]);

  const isCanvas =
    location.pathname === "/" ||
    location.pathname === "/gerry" ||
    location.pathname.startsWith("/planet/");

  return (
    <AppContextProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <AncestorRail />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header onOpenPalette={() => setPaletteOpen(true)} />
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
        <VoiceAssistant />
        <LiveMeetingAssist />
        <WhatsNewModal />
        <FeatureGuideModal />
        <Toaster />
      </div>
    </AppContextProvider>
  );
}
