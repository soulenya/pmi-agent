/**
 * The workbench's top bar: back/forward, the omnibar, and the four things that
 * have to be one click from anywhere. Everything about you is in the rail's You
 * menu; the model switcher moved into the conversation it belongs to.
 */
import { ChatSidebarToggle } from "@/components/layout/ChatSidebar";
import { HistoryNav } from "@/components/layout/HistoryNav";
import { MeetingRecorderIndicator } from "@/components/layout/MeetingRecorderIndicator";
import { WaitingBell } from "@/components/waiting/WaitingBell";
import { Omnibar } from "./Omnibar";
import { SectionTabs } from "./SectionTabs";

export function WorkbenchHeader() {
  return (
    <header className="border-b bg-card">
      <div className="flex h-14 items-center gap-3 px-4">
        <HistoryNav />
        <div className="flex flex-1 justify-center">
          <Omnibar />
        </div>
        <div className="flex items-center gap-2">
          <MeetingRecorderIndicator />
          <WaitingBell />
          <ChatSidebarToggle />
        </div>
      </div>
      <SectionTabs />
    </header>
  );
}
