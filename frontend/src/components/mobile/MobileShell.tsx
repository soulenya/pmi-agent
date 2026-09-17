/**
 * The phone shell: a slim header, the page, and five tabs along the bottom
 * with a More sheet for everything else. Phones are for noticing and
 * unblocking work, so the tabs are the places that need a glance — Today,
 * Waiting, Team, Tasks and Gerry — and nothing here is hover-only.
 *
 * Tablets and desktops never see this; AppShell picks it by width.
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Bot,
  ChevronLeft,
  FolderKanban,
  LogOut,
  Menu,
  MessagesSquare,
  Settings,
  Share,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";

import { logout as apiLogout } from "@/api/auth";
import { HubOfflineBar } from "@/components/hub/HubOfflineBar";
import { PushToggle } from "@/components/PushToggle";
import { useWaitingCounts } from "@/components/waiting/WaitingForYou";
import { useHubStatus } from "@/hooks/useAllWork";
import { useTeamUnread } from "@/hooks/useTeamUnread";
import { useIsStandalone } from "@/hooks/useViewport";
import { RAIL, railItemFor, railPageFor } from "@/lib/workbench";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  /** Route prefixes that light this tab. */
  match: string[];
}

const TABS: Tab[] = [
  { id: "today", label: "Today", icon: Sun, to: "/today", match: ["/today"] },
  { id: "waiting", label: "Waiting", icon: Bell, to: "/waiting", match: ["/waiting", "/assistant"] },
  { id: "team", label: "Team", icon: MessagesSquare, to: "/team", match: ["/team"] },
  { id: "tasks", label: "Tasks", icon: FolderKanban, to: "/tasks", match: ["/tasks"] },
  { id: "gerry", label: "Gerry", icon: Bot, to: "/chat", match: ["/chat", "/hub/chat"] },
];

const TAB_ROUTES = new Set(TABS.flatMap((t) => t.match));

function under(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + "/");
}

/** What the header calls the place you are in. */
function titleFor(pathname: string): string {
  if (under(pathname, "/chat") || under(pathname, "/hub/chat")) return "Gerry";
  if (under(pathname, "/settings")) return "Settings";
  if (under(pathname, "/users")) return "Users";
  const page = railPageFor(pathname);
  if (page) return page.label;
  return railItemFor(pathname)?.label ?? "Little Gerry";
}

/** A place under a tab is reached by drilling in; give it a way back up. */
function parentFor(pathname: string): string | null {
  if (/^\/(hub\/)?projects\/[^/]+/.test(pathname)) return "/projects";
  if (/^\/(hub\/)?chat\/[^/]+/.test(pathname)) return "/chat";
  return null;
}

export function MobileShell() {
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);

  useEffect(() => setMore(false), [pathname]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <MobileHeader pathname={pathname} />
      <HubOfflineBar />
      <main
        className="min-h-0 flex-1 overflow-y-auto p-3"
        style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
        <Outlet />
      </main>
      <TabBar pathname={pathname} moreOpen={more} onMore={() => setMore((v) => !v)} />
      {more && <MoreSheet onClose={() => setMore(false)} />}
      <AddToHomeHint />
    </div>
  );
}

function MobileHeader({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const parent = parentFor(pathname);
  const item = railItemFor(pathname);
  const page = railPageFor(pathname);
  const counts = useWaitingCounts();
  const pills = item && item.pages.length > 1 && !parent ? item.pages : [];
  return (
    <header className="shrink-0 border-b bg-card" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex h-12 items-center gap-2 px-3">
        {parent ? (
          <button
            type="button"
            onClick={() => navigate(parent)}
            aria-label="Back"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <img src="/icons/icon-192.png" alt="" className="h-6 w-6 rounded" />
        )}
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          {pills.length ? item!.label : titleFor(pathname)}
        </h1>
      </div>
      {pills.length > 0 && (
        <nav aria-label={`${item!.label} sections`} className="flex gap-1.5 overflow-x-auto px-3 pb-2">
          {pills.map((p) => {
            const active = page?.route === p.route;
            const n = p.badge === "waiting" ? counts.total : p.badge === "assistant" ? counts.suggestions : 0;
            return (
              <NavLink
                key={p.route}
                to={p.route}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                  active ? "border-primary bg-primary/10 font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                {p.label}
                {n > 0 && (
                  <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-4 text-white">{n}</span>
                )}
              </NavLink>
            );
          })}
        </nav>
      )}
    </header>
  );
}

function TabBar({
  pathname,
  moreOpen,
  onMore,
}: {
  pathname: string;
  moreOpen: boolean;
  onMore: () => void;
}) {
  const counts = useWaitingCounts();
  const teamUnread = useTeamUnread();
  const inTabs = [...TAB_ROUTES].some((r) => under(pathname, r));
  const badge: Record<string, number> = {
    waiting: counts.total,
    team: teamUnread,
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t bg-card/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((t) => {
        const active = !moreOpen && t.match.some((r) => under(pathname, r));
        const n = badge[t.id] ?? 0;
        return (
          <NavLink
            key={t.id}
            to={t.to}
            aria-label={t.label}
            className={cn(
              "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]",
              active ? "text-primary" : "text-muted-foreground active:text-foreground",
            )}
          >
            <t.icon className="h-5 w-5" />
            {t.label}
            {n > 0 && (
              <span
                className={cn(
                  "absolute left-1/2 top-1.5 ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none text-white",
                  t.id === "waiting" && counts.approvals > 0 ? "bg-amber-500" : "bg-destructive",
                )}
              >
                {n > 99 ? "99+" : n}
              </span>
            )}
          </NavLink>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-label="More"
        aria-expanded={moreOpen}
        className={cn(
          "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]",
          moreOpen || !inTabs ? "text-primary" : "text-muted-foreground active:text-foreground",
        )}
      >
        <Menu className="h-5 w-5" />
        More
      </button>
    </nav>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { user, refreshToken, logout } = useAuthStore();
  const { data: hub } = useHubStatus();
  const rest = RAIL.filter((item) => !TABS.some((t) => t.match.includes(item.route)));

  async function signOut() {
    if (refreshToken) {
      try {
        await apiLogout(refreshToken);
      } catch {
        /* local logout still happens */
      }
    }
    logout();
  }

  const row =
    "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm active:bg-accent";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="More"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t bg-background shadow-2xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user?.display_name ?? "You"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.email}
              {hub?.here ? " · on the hub" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 px-3 py-2">
          {rest.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.route)}
              className="flex flex-col items-center gap-1.5 rounded-xl border bg-card px-2 py-3 text-xs active:bg-accent"
            >
              <item.icon className="h-5 w-5 text-muted-foreground" />
              {item.label}
            </button>
          ))}
        </div>
        <div className="mx-3 my-1 h-px bg-border" />
        <div className="px-3 py-2">
          <PushToggle compact />
        </div>
        <div className="mx-3 my-1 h-px bg-border" />
        <div className="px-3">
          <button type="button" onClick={() => navigate("/settings")} className={row}>
            <Settings className="h-4 w-4 text-muted-foreground" /> Settings
          </button>
          <button type="button" onClick={() => void signOut()} className={cn(row, "text-destructive")}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    </>
  );
}

const A2HS_KEY = "lg.addToHome.dismissed";

/**
 * A one-time nudge to put the hub on the home screen: a full-screen app with
 * its own icon, and on iPhones the only way to receive notifications.
 * Safari has no prompt of its own, so the steps are spelled out.
 */
function AddToHomeHint() {
  const standalone = useIsStandalone();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(A2HS_KEY) === "1";
    } catch {
      return true;
    }
  });
  if (standalone || dismissed) return null;

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const dismiss = () => {
    try {
      window.localStorage.setItem(A2HS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      role="note"
      className="fixed inset-x-3 z-30 flex items-start gap-3 rounded-xl border bg-card p-3 text-xs shadow-lg"
      style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
    >
      <Share className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Keep Gerry on your home screen</p>
        <p className="mt-0.5 text-muted-foreground">
          {ios
            ? "Tap Share, then Add to Home Screen. Opens full-screen, and notifications can reach you."
            : "Open the browser menu and choose Install app or Add to Home screen."}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
