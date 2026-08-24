import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquare,
  FolderKanban,
  FolderOpen,
  FileText,
  ShieldCheck,
  FlaskConical,
  Bell,
  Settings,
  Search,
  Mic,
  Mail,
  ScrollText,
  Users,
  CalendarDays,
  CalendarClock,
  Globe,
  TrendingUp,
  Sparkles,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { listPendingApprovals, listNotifications } from "@/api/chat";
import { getPendingSuggestionCount } from "@/api/assistant";
import { ServiceMenu } from "@/components/ServiceMenu";
import { BUILD_NUMBER, BUILD_DATE } from "@/version";

type BadgeKey = "approvals" | "notifications" | "assistant";

type NavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
  badge?: BadgeKey;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

// Always-visible "hero" destinations (not collapsible).
const pinnedItems: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/chat", icon: MessageSquare, label: "Little Gerry" },
  { to: "/assistant", icon: Sparkles, label: "Daily Assistant", badge: "assistant" },
];

// Collapsible groups.
const navGroups: NavGroup[] = [
  {
    id: "work",
    label: "Work",
    items: [
      { to: "/projects", icon: FolderOpen, label: "Projects" },
      { to: "/tasks", icon: FolderKanban, label: "Tasks" },
      { to: "/scheduled-tasks", icon: CalendarClock, label: "Scheduled Tasks" },
      { to: "/calendar", icon: CalendarDays, label: "Calendar" },
      { to: "/meetings", icon: Mic, label: "Meeting Notes" },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    items: [
      { to: "/documents", icon: FileText, label: "Knowledge Base" },
      { to: "/search", icon: Search, label: "Search" },
      { to: "/research", icon: FlaskConical, label: "Research" },
      { to: "/browser", icon: Globe, label: "Research Browser" },
      { to: "/files", icon: FileText, label: "Generated Files" },
    ],
  },
  {
    id: "communications",
    label: "Communications",
    items: [
      { to: "/emails", icon: Mail, label: "Email Drafts" },
      { to: "/google", icon: Globe, label: "Google Workspace" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      { to: "/regulatory", icon: ShieldCheck, label: "Regulatory" },
      { to: "/investor", icon: TrendingUp, label: "Investor Relations" },
      { to: "/approvals", icon: ShieldCheck, label: "Approvals", badge: "approvals" },
      { to: "/audit", icon: ScrollText, label: "Audit Trail" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      { to: "/notifications", icon: Bell, label: "Notifications", badge: "notifications" },
      { to: "/users", icon: Users, label: "User Management" },
      { to: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

const COLLAPSE_STORAGE_KEY = "sidebar.collapsedGroups";

export function Sidebar() {
  const location = useLocation();

  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => listPendingApprovals(),
    refetchInterval: 30_000,
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    staleTime: 30_000,
  });

  const { data: assistantPending = 0 } = useQuery({
    queryKey: ["assistant", "suggestions", "count"],
    queryFn: getPendingSuggestionCount,
    refetchInterval: 30_000,
  });

  const approvalCount = pendingApprovals.length;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const badgeCount = (badge: BadgeKey | undefined) => {
    if (badge === "approvals") return approvalCount;
    if (badge === "notifications") return unreadCount;
    if (badge === "assistant") return assistantPending;
    return 0;
  };

  // Which group (if any) contains the active route, so we can keep it open.
  const activeGroupId = useMemo(() => {
    const isActivePath = (to: string) =>
      to === "/"
        ? location.pathname === "/"
        : location.pathname === to || location.pathname.startsWith(`${to}/`);
    return navGroups.find((g) => g.items.some((i) => isActivePath(i.to)))?.id;
  }, [location.pathname]);

  // Persisted collapse state: a set of collapsed group ids.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      return raw ? new Set<string>(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COLLAPSE_STORAGE_KEY,
        JSON.stringify(Array.from(collapsed)),
      );
    } catch {
      /* ignore persistence failures */
    }
  }, [collapsed]);

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNavItem = ({ to, icon: Icon, label, badge }: NavItem) => {
    const count = badgeCount(badge);
    return (
      <NavLink
        key={to}
        to={to}
        end={to === "/"}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            isActive
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )
        }
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1">{label}</span>
        {count > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold text-destructive-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <nav className="flex w-56 flex-col border-r bg-card py-4">
      {/* Logo */}
      <div className="flex items-start justify-between px-4 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-primary">Little Gerry</h1>
          <p className="text-xs text-muted-foreground">VACTOR Platform</p>
        </div>
        <ServiceMenu />
      </div>

      <div className="flex-1 min-h-0 space-y-1 overflow-y-auto px-2">
        {/* Pinned, always-visible destinations */}
        {pinnedItems.map(renderNavItem)}

        {/* Collapsible groups */}
        {navGroups.map((group) => {
          // The active group is always expanded regardless of stored state.
          const isOpen = group.id === activeGroupId || !collapsed.has(group.id);
          const groupBadge = group.items.reduce(
            (sum, item) => sum + badgeCount(item.badge),
            0,
          );
          return (
            <div key={group.id} className="pt-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-transform",
                    isOpen ? "rotate-0" : "-rotate-90",
                  )}
                />
                <span className="flex-1 text-left">{group.label}</span>
                {!isOpen && groupBadge > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {groupBadge > 99 ? "99+" : groupBadge}
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="mt-1 space-y-1">{group.items.map(renderNavItem)}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Version badge */}
      <div className="px-4 pt-3 border-t">
        <NavLink
          to="/settings"
          className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
          title={`Build ${BUILD_NUMBER} — ${BUILD_DATE}. Click to see What's New.`}
        >
          <span>Little Gerry</span>
          <span className="rounded-full bg-accent px-2 py-0.5 font-mono">
            b{BUILD_NUMBER}
          </span>
        </NavLink>
      </div>
    </nav>
  );
}
