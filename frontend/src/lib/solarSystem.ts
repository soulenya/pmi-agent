/**
 * Solar-system navigation model.
 *
 * Single source of truth for the celestial hierarchy:
 *   Sun        = Little Gerry (chat + voice)            → /chat
 *   Satellites = Dashboard, Daily Assistant (Level 0)   → /dashboard, /assistant
 *   Planets    = the five feature categories (Level 1)  → /planet/:id
 *   Moons      = feature pages (Level 2)                → existing flat routes
 *
 * Flat feature URLs remain canonical so every existing navigate() call,
 * command-palette entry, and deep link keeps working unchanged.
 */
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
  Bot,
  type LucideIcon,
} from "lucide-react";

export type BadgeKey = "approvals" | "notifications" | "assistant";

export interface Moon {
  id: string;
  route: string;
  label: string;
  icon: LucideIcon;
  badge?: BadgeKey;
}

export interface Planet {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the planet body. */
  color: string;
  /** Glow / ring accent (CSS color value). */
  accent: string;
  /** Orbit radius as a fraction of the stage radius (0..1). */
  orbit: number;
  /** Initial angle on the orbit, degrees. */
  angle: number;
  /** Planet size in px at Level 0. */
  size: number;
  moons: Moon[];
}

export interface Satellite extends Moon {
  orbit: number;
  angle: number;
}

export const SUN = {
  id: "gerry",
  route: "/chat",
  label: "Little Gerry",
  icon: MessageSquare,
} as const;

export const SATELLITES: Satellite[] = [
  { id: "dashboard", route: "/dashboard", label: "Dashboard", icon: LayoutDashboard, orbit: 0.21, angle: 200 },
  { id: "assistant", route: "/assistant", label: "Daily Assistant", icon: Sparkles, badge: "assistant", orbit: 0.21, angle: 20 },
];

export const PLANETS: Planet[] = [
  {
    id: "work",
    label: "Work",
    icon: FolderOpen,
    color: "from-sky-400 to-blue-600",
    accent: "#38bdf8",
    orbit: 0.38,
    angle: 315,
    size: 64,
    moons: [
      { id: "projects", route: "/projects", label: "Projects", icon: FolderOpen },
      { id: "tasks", route: "/tasks", label: "Tasks", icon: FolderKanban },
      { id: "scheduled-tasks", route: "/scheduled-tasks", label: "Scheduled Tasks", icon: CalendarClock },
      { id: "calendar", route: "/calendar", label: "Calendar", icon: CalendarDays },
      { id: "meetings", route: "/meetings", label: "Meeting Notes", icon: Mic },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: FileText,
    color: "from-emerald-400 to-teal-600",
    accent: "#34d399",
    orbit: 0.55,
    angle: 30,
    size: 58,
    moons: [
      { id: "documents", route: "/documents", label: "Knowledge Base", icon: FileText },
      { id: "search", route: "/search", label: "Search", icon: Search },
      { id: "research", route: "/research", label: "Research", icon: FlaskConical },
      { id: "files", route: "/files", label: "Generated Files", icon: FileText },
    ],
  },
  {
    id: "communications",
    label: "Communications",
    icon: Mail,
    color: "from-amber-300 to-orange-500",
    accent: "#fbbf24",
    orbit: 0.7,
    angle: 105,
    size: 50,
    moons: [
      { id: "emails", route: "/emails", label: "Email Drafts", icon: Mail },
      { id: "google", route: "/google", label: "Google Workspace", icon: Globe },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    icon: ShieldCheck,
    color: "from-rose-400 to-red-600",
    accent: "#fb7185",
    orbit: 0.84,
    angle: 170,
    size: 56,
    moons: [
      { id: "regulatory", route: "/regulatory", label: "Regulatory", icon: ShieldCheck },
      { id: "investor", route: "/investor", label: "Investor Relations", icon: TrendingUp },
      { id: "approvals", route: "/approvals", label: "Approvals", icon: ShieldCheck, badge: "approvals" },
      { id: "audit", route: "/audit", label: "Audit Trail", icon: ScrollText },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    icon: Settings,
    color: "from-violet-400 to-purple-600",
    accent: "#a78bfa",
    orbit: 0.97,
    angle: 250,
    size: 52,
    moons: [
      { id: "notifications", route: "/notifications", label: "Notifications", icon: Bell, badge: "notifications" },
      { id: "users", route: "/users", label: "User Management", icon: Users },
      { id: "agents", route: "/agents", label: "Agents", icon: Bot },
      { id: "settings", route: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function planetById(id: string | undefined): Planet | undefined {
  return PLANETS.find((p) => p.id === id);
}

export interface NavLocation {
  /** Hierarchical path, e.g. [], ["work"], ["work","tasks"], ["gerry"], ["dashboard"]. */
  path: string[];
  planet?: Planet;
  moon?: Moon;
  satellite?: Satellite;
  isSun: boolean;
}

/** Resolve a router pathname to a position in the celestial hierarchy. */
export function locateRoute(pathname: string): NavLocation {
  if (pathname === "/") return { path: [], isSun: false };

  if (pathname === "/chat" || pathname.startsWith("/chat/")) {
    return { path: ["gerry"], isSun: true };
  }

  const planetMatch = pathname.match(/^\/planet\/([^/]+)/);
  if (planetMatch) {
    const planet = planetById(planetMatch[1]);
    return planet
      ? { path: [planet.id], planet, isSun: false }
      : { path: [], isSun: false };
  }

  for (const sat of SATELLITES) {
    if (pathname === sat.route || pathname.startsWith(`${sat.route}/`)) {
      return { path: [sat.id], satellite: sat, isSun: false };
    }
  }

  for (const planet of PLANETS) {
    for (const moon of planet.moons) {
      if (pathname === moon.route || pathname.startsWith(`${moon.route}/`)) {
        return { path: [planet.id, moon.id], planet, moon, isSun: false };
      }
    }
  }

  return { path: [], isSun: false };
}

/** Route one level up from the given pathname (Esc behaviour). */
export function parentRoute(pathname: string): string | null {
  const loc = locateRoute(pathname);
  if (loc.moon && loc.planet) return `/planet/${loc.planet.id}`;
  if (loc.planet) return "/";
  if (loc.isSun || loc.satellite) return "/";
  return null; // already at the overview
}
