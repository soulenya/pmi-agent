/**
 * The workbench's left rail: eight places, the last few things you were in,
 * and at the bottom a labelled menu for you — settings, users, help, feedback,
 * sign out. Always the same shape; only the highlight moves.
 */
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  Clock,
  HelpCircle,
  LogOut,
  MessageSquareText,
  Orbit,
  Settings,
  Users,
  X,
} from "lucide-react";

import { logout as apiLogout } from "@/api/auth";
import { BrowserDock } from "@/components/layout/BrowserDock";
import { FeedbackModal } from "@/components/layout/FeedbackButton";
import { useWaitingCounts } from "@/components/waiting/WaitingForYou";
import { RAIL, railItemFor } from "@/lib/workbench";
import { resolveGuide } from "@/lib/featureGuide";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useBootPopupStore } from "@/stores/bootPopupStore";
import { useFeatureGuideStore } from "@/stores/featureGuideStore";
import { useRecentPlacesStore } from "@/stores/recentPlacesStore";
import { useShellStore } from "@/stores/shellStore";
import { BUILD_NUMBER } from "@/version";

function Dot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function RailButton({
  to,
  label,
  active,
  count = 0,
  children,
}: {
  to: string;
  label: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      title={label}
      aria-label={label}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
      <Dot count={count} />
      <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
        {label}
      </span>
    </NavLink>
  );
}

export function Rail() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const here = railItemFor(pathname);
  const counts = useWaitingCounts();
  const places = useRecentPlacesStore((s) => s.places);
  const forget = useRecentPlacesStore((s) => s.forget);

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-card py-2">
      {RAIL.map((item) => {
        const Icon = item.icon;
        // Suggestions are a stream, not a queue; their count lives on the tab, not the rail.
        const count = item.pages.reduce((n, p) => n + (p.badge === "waiting" ? counts.total : 0), 0);
        return (
          <RailButton
            key={item.id}
            to={item.route}
            label={item.label}
            active={here?.id === item.id}
            count={count}
          >
            <Icon className="h-5 w-5" />
          </RailButton>
        );
      })}

      {places.length > 0 && (
        <>
          <div className="my-1 h-px w-7 bg-border" />
          <div className="group relative flex flex-col items-center gap-1">
            <span className="flex h-6 w-10 items-center justify-center text-muted-foreground" title="Recent">
              <Clock className="h-3.5 w-3.5" />
            </span>
            {places.map((p) => (
              <NavLink
                key={p.path}
                to={p.path}
                title={p.label}
                className={cn(
                  "group/place relative flex h-8 w-10 items-center justify-center rounded-md text-[11px] font-semibold transition-colors",
                  pathname === p.path
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {p.label.slice(0, 2).toUpperCase()}
                <button
                  type="button"
                  aria-label={`Forget ${p.label}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    forget(p.path);
                  }}
                  className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full border bg-background text-muted-foreground group-hover/place:flex hover:text-foreground"
                >
                  <X className="h-2 w-2" />
                </button>
                <span className="pointer-events-none absolute left-full z-50 ml-2 hidden max-w-[16rem] truncate whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover/place:block">
                  {p.label}
                  {p.tag ? <span className="ml-1 text-muted-foreground">· {p.tag}</span> : null}
                </span>
              </NavLink>
            ))}
          </div>
        </>
      )}

      <div className="flex-1" />

      <BrowserDock />
      <YouMenu onNavigate={navigate} />
    </nav>
  );
}

function YouMenu({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const { user, refreshToken, logout } = useAuthStore();
  const requestGuide = useFeatureGuideStore((s) => s.requestOpen);
  const showWhatsNew = useBootPopupStore((s) => s.reopenWhatsNew);
  const setShell = useShellStore((s) => s.setShell);
  const counts = useWaitingCounts();
  const guide = resolveGuide(pathname);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  async function handleLogout() {
    if (refreshToken) {
      try {
        await apiLogout(refreshToken);
      } catch {
        /* proceed with local logout */
      }
    }
    logout();
  }

  const initials = (user?.display_name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const go = (to: string) => {
    setOpen(false);
    onNavigate(to);
  };

  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent";

  return (
    <div ref={ref} className="relative mb-1 flex flex-col items-center gap-1">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">You</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${user?.display_name ?? "You"} — settings, users, help`}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
          open ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent",
        )}
      >
        {initials}
        <Dot count={counts.notifications} />
      </button>

      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-2 w-60 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{user?.display_name ?? "…"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <div className="my-1 border-t" />
          <button type="button" className={item} onClick={() => go("/settings")}>
            <Settings className="h-4 w-4" /> Settings
            <kbd className="ml-auto rounded border bg-background px-1 text-[10px]">Ctrl+,</kbd>
          </button>
          <button type="button" className={item} onClick={() => go("/waiting?tab=notifications")}>
            <Bell className="h-4 w-4" /> Notifications
            {counts.notifications > 0 && (
              <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
                {counts.notifications}
              </span>
            )}
          </button>
          {isAdmin && (
            <button type="button" className={item} onClick={() => go("/users")}>
              <Users className="h-4 w-4" /> Users
            </button>
          )}
          <div className="my-1 border-t" />
          {guide && (
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                requestGuide(guide.id);
              }}
            >
              <HelpCircle className="h-4 w-4" /> What Gerry can do here
            </button>
          )}
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              showWhatsNew();
            }}
          >
            <BookOpen className="h-4 w-4" /> What's new
            <span className="ml-auto text-[10px] text-muted-foreground">b{BUILD_NUMBER}</span>
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              setFeedback(true);
            }}
          >
            <MessageSquareText className="h-4 w-4" /> Send feedback
          </button>
          <button
            type="button"
            className={item}
            title="Go back to the solar system for this session. Settings › Appearance keeps it."
            onClick={() => {
              setOpen(false);
              setShell("orbit");
              onNavigate("/");
            }}
          >
            <Orbit className="h-4 w-4" /> Old layout
          </button>
          <div className="my-1 border-t" />
          <button type="button" className={cn(item, "text-destructive")} onClick={handleLogout}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}

      {feedback && <FeedbackModal onClose={() => setFeedback(false)} />}
    </div>
  );
}
