/**
 * The workbench's map: eight places on the left rail, each with the pages it
 * holds. Flat feature URLs stay canonical, so every link in the app keeps
 * working; this only decides which rail item lights up and which section tabs
 * show under the header.
 */
import {
  CalendarDays,
  FileText,
  FolderKanban,
  FolderOpen,
  Mail,
  ShieldCheck,
  Sun,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface RailPage {
  route: string;
  label: string;
  /** Show a count from the badge store. */
  badge?: "approvals" | "notifications" | "assistant";
}

export interface RailItem {
  id: string;
  label: string;
  icon: LucideIcon;
  route: string;
  /** Pages under this item. One page means no section tabs are drawn. */
  pages: RailPage[];
  /** Route prefixes that also belong here (detail pages, hub twins). */
  also?: string[];
}

export const RAIL: RailItem[] = [
  {
    id: "today",
    label: "Today",
    icon: Sun,
    route: "/today",
    pages: [{ route: "/today", label: "Today" }, { route: "/assistant", label: "Suggestions", badge: "assistant" }],
    also: ["/dashboard"],
  },
  {
    id: "projects",
    label: "Projects",
    icon: FolderOpen,
    route: "/projects",
    pages: [{ route: "/projects", label: "Projects" }],
    also: ["/hub/projects", "/workrooms", "/chat", "/hub/chat", "/gerry"],
  },
  {
    id: "tasks",
    label: "Tasks",
    icon: FolderKanban,
    route: "/tasks",
    pages: [{ route: "/tasks", label: "Tasks" }],
    also: ["/scheduled-tasks"],
  },
  {
    id: "mail",
    label: "Mail",
    icon: Mail,
    route: "/inbox",
    pages: [
      { route: "/inbox", label: "Inbox" },
      { route: "/contacts", label: "Contacts" },
    ],
    also: ["/emails"],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: FileText,
    route: "/documents",
    pages: [
      { route: "/documents", label: "Knowledge Base" },
      { route: "/search", label: "Search" },
      { route: "/research", label: "Research" },
      { route: "/browser", label: "Browser" },
      { route: "/files", label: "Made by Gerry" },
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarDays,
    route: "/calendar",
    pages: [
      { route: "/calendar", label: "Calendar" },
      { route: "/meetings", label: "Meetings" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    icon: ShieldCheck,
    route: "/regulatory",
    pages: [
      { route: "/regulatory", label: "Regulatory" },
      { route: "/approvals", label: "Approvals", badge: "approvals" },
      { route: "/audit", label: "Audit trail" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: Wallet,
    route: "/budgets",
    pages: [
      { route: "/budgets", label: "Budgets" },
      { route: "/odoo", label: "Odoo" },
    ],
  },
];

/** Where a planet of the old shell lands in this one. */
export const PLANET_TO_RAIL: Record<string, string> = {
  work: "/projects",
  knowledge: "/documents",
  communications: "/inbox",
  odoo: "/budgets",
  compliance: "/regulatory",
  administration: "/settings",
};

function under(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + "/") || pathname.startsWith(route + "?");
}

/** The rail item a path belongs to, if any. */
export function railItemFor(pathname: string): RailItem | null {
  for (const item of RAIL) {
    if (item.pages.some((p) => under(pathname, p.route))) return item;
    if (item.also?.some((a) => under(pathname, a))) return item;
  }
  return null;
}

/** The page within its rail item, for the section tab strip. */
export function railPageFor(pathname: string): RailPage | null {
  const item = railItemFor(pathname);
  return item?.pages.find((p) => under(pathname, p.route)) ?? null;
}
