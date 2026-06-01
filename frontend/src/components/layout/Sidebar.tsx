import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquare,
  FolderKanban,
  FileText,
  ShieldCheck,
  FlaskConical,
  Bell,
  Settings,
  Search,
} from "lucide-react";
import { listPendingApprovals } from "@/api/chat";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/chat", icon: MessageSquare, label: "AI Assistant" },
  { to: "/tasks", icon: FolderKanban, label: "Tasks" },
  { to: "/documents", icon: FileText, label: "Knowledge Base" },
  { to: "/search", icon: Search, label: "Search" },
  { to: "/regulatory", icon: ShieldCheck, label: "Regulatory" },
  { to: "/research", icon: FlaskConical, label: "Research" },
  { to: "/approvals", icon: ShieldCheck, label: "Approvals", badge: true },
  { to: "/notifications", icon: Bell, label: "Notifications" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: listPendingApprovals,
    refetchInterval: 30_000,
  });
  const approvalCount = pendingApprovals.length;

  return (
    <nav className="flex w-56 flex-col border-r bg-card py-4">
      {/* Logo */}
      <div className="px-4 pb-4">
        <h1 className="text-lg font-bold tracking-tight text-primary">PMI Agent</h1>
        <p className="text-xs text-muted-foreground">VACTOR Platform</p>
      </div>

      <div className="flex-1 space-y-1 px-2">
        {navItems.map(({ to, icon: Icon, label, badge }) => (
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
            {badge && approvalCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold text-destructive-foreground">
                {approvalCount > 99 ? "99+" : approvalCount}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
