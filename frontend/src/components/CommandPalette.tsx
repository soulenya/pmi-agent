import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  FolderOpen,
  FolderKanban,
  FileText,
  Search,
  FlaskConical,
  Globe,
  Mic,
  Mail,
  ShieldCheck,
  Bell,
  ScrollText,
  Users,
  Settings,
  Plus,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Item definitions ───────────────────────────────────────────────────────────

interface PaletteItem {
  id: string;
  label: string;
  group: "Navigation" | "Quick Actions";
  icon: React.ReactNode;
  action: (navigate: ReturnType<typeof useNavigate>) => void;
}

const ALL_ITEMS: PaletteItem[] = [
  // Navigation
  { id: "nav-solar", label: "Solar System", group: "Navigation", icon: <LayoutDashboard className="h-4 w-4" />, action: (nav) => nav("/") },
  { id: "nav-dashboard", label: "Dashboard", group: "Navigation", icon: <LayoutDashboard className="h-4 w-4" />, action: (nav) => nav("/dashboard") },
  { id: "nav-chat", label: "Little Gerry", group: "Navigation", icon: <MessageSquare className="h-4 w-4" />, action: (nav) => nav("/chat") },
  { id: "nav-projects", label: "Projects", group: "Navigation", icon: <FolderOpen className="h-4 w-4" />, action: (nav) => nav("/projects") },
  { id: "nav-tasks", label: "Tasks", group: "Navigation", icon: <FolderKanban className="h-4 w-4" />, action: (nav) => nav("/tasks") },
  { id: "nav-documents", label: "Knowledge Base", group: "Navigation", icon: <FileText className="h-4 w-4" />, action: (nav) => nav("/documents") },
  { id: "nav-search", label: "Semantic Search", group: "Navigation", icon: <Search className="h-4 w-4" />, action: (nav) => nav("/search") },
  { id: "nav-research", label: "Research", group: "Navigation", icon: <FlaskConical className="h-4 w-4" />, action: (nav) => nav("/research") },
  { id: "nav-browser", label: "Research Browser", group: "Navigation", icon: <Globe className="h-4 w-4" />, action: (nav) => nav("/browser") },
  { id: "nav-meetings", label: "Meeting Notes", group: "Navigation", icon: <Mic className="h-4 w-4" />, action: (nav) => nav("/meetings") },
  { id: "nav-emails", label: "Email Drafts", group: "Navigation", icon: <Mail className="h-4 w-4" />, action: (nav) => nav("/emails") },
  { id: "nav-regulatory", label: "Regulatory", group: "Navigation", icon: <ShieldCheck className="h-4 w-4" />, action: (nav) => nav("/regulatory") },
  { id: "nav-approvals", label: "Approvals", group: "Navigation", icon: <ShieldCheck className="h-4 w-4" />, action: (nav) => nav("/approvals") },
  { id: "nav-notifications", label: "Notifications", group: "Navigation", icon: <Bell className="h-4 w-4" />, action: (nav) => nav("/notifications") },
  { id: "nav-audit", label: "Audit Trail", group: "Navigation", icon: <ScrollText className="h-4 w-4" />, action: (nav) => nav("/audit") },
  { id: "nav-users", label: "User Management", group: "Navigation", icon: <Users className="h-4 w-4" />, action: (nav) => nav("/users") },
  { id: "nav-agents", label: "Agents", group: "Navigation", icon: <Users className="h-4 w-4" />, action: (nav) => nav("/agents") },
  { id: "nav-settings", label: "Settings", group: "Navigation", icon: <Settings className="h-4 w-4" />, action: (nav) => nav("/settings") },
  // Quick Actions
  { id: "qa-new-chat", label: "New Chat", group: "Quick Actions", icon: <Plus className="h-4 w-4 text-primary" />, action: (nav) => nav("/chat") },
  { id: "qa-new-task", label: "New Task", group: "Quick Actions", icon: <Plus className="h-4 w-4 text-primary" />, action: (nav) => nav("/tasks") },
  { id: "qa-new-project", label: "New Project", group: "Quick Actions", icon: <Plus className="h-4 w-4 text-primary" />, action: (nav) => nav("/projects") },
  { id: "qa-new-meeting", label: "New Meeting Note", group: "Quick Actions", icon: <Plus className="h-4 w-4 text-primary" />, action: (nav) => nav("/meetings") },
];

// ── Fuzzy match ────────────────────────────────────────────────────────────────

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  for (const ch of n) {
    const idx = h.indexOf(ch, i);
    if (idx === -1) return false;
    i = idx + 1;
  }
  return true;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = ALL_ITEMS.filter((item) => fuzzyMatch(item.label, query));

  // Group order
  const groups = ["Quick Actions", "Navigation"] as const;
  const grouped = groups
    .map((g) => ({ group: g, items: filtered.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);

  // Flat list for keyboard nav
  const flatItems = grouped.flatMap((g) => g.items);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const activate = useCallback(
    (item: PaletteItem) => {
      item.action(navigate);
      onClose();
    },
    [navigate, onClose]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flatItems[activeIdx]) activate(flatItems[activeIdx]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 rounded-xl border bg-background shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages and actions…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:flex h-5 items-center rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {flatItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No results for "{query}"</p>
          ) : (
            grouped.map(({ group, items }) => {
              let groupOffset = 0;
              for (const g of grouped) {
                if (g.group === group) break;
                groupOffset += g.items.length;
              }
              return (
                <div key={group}>
                  <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </p>
                  {items.map((item, i) => {
                    const flatIdx = groupOffset + i;
                    const isActive = flatIdx === activeIdx;
                    return (
                      <button
                        key={item.id}
                        data-idx={flatIdx}
                        onClick={() => activate(item)}
                        onMouseEnter={() => setActiveIdx(flatIdx)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground hover:bg-accent/50"
                        )}
                      >
                        <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                        <span className="flex-1 text-left">{item.label}</span>
                        {isActive && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 border-t px-4 py-2 text-[10px] text-muted-foreground">
          <span><kbd className="font-semibold">↑↓</kbd> navigate</span>
          <span><kbd className="font-semibold">↵</kbd> select</span>
          <span><kbd className="font-semibold">ESC</kbd> close</span>
        </div>
      </div>
    </>
  );
}
