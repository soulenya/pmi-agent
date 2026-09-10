/**
 * "What Gerry can do" feature guide.
 *
 * A short, friendly snapshot of what Little Gerry can do in each section of the
 * app. Keyed by page id so the same content powers both the once-per-build
 * auto-popup and the Help entry in the You menu.
 */
import {
  Bell,
  Bot,
  Boxes,
  CalendarDays,
  Compass,
  FileText,
  FlaskConical,
  FolderKanban,
  FolderOpen,
  Handshake,
  Inbox,
  MessagesSquare,
  Mic,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface FeatureGuideEntry {
  tagline: string;
  capabilities: string[];
}

export interface ResolvedGuide extends FeatureGuideEntry {
  id: string;
  title: string;
  icon: LucideIcon;
}

export const FEATURE_GUIDE: Record<string, FeatureGuideEntry> = {
  gerry: {
    tagline: "Your AI chief of staff — chat or talk out loud.",
    capabilities: [
      "Ask about your projects, documents, email and calendar in plain language",
      "Knows PMI's people, products and regulatory picture — and who you are",
      "Drafts email, creates tasks, researches topics and writes documents",
      "Anything that reaches the outside world waits for your approval",
      "Click the microphone beside Send to talk out loud in the same conversation; click \"Ask Gerry\" on any item to chat about it",
    ],
  },
  dashboard: {
    tagline: "Today at a glance.",
    capabilities: [
      "What is due today, what is overdue, and what is waiting for you \u2014 approvals, suggestions, notifications \u2014 across this computer and the hub",
      "Read your AI-generated daily briefing",
      "Click a task and it opens over the page; Esc puts you back where you were",
      "Ctrl+K in the search box jumps to anything by name, or asks Gerry a question",
    ],
  },
  assistant: {
    tagline: "Your proactive daily briefing.",
    capabilities: [
      "A daily scan of Gmail and Google Tasks surfaces follow-ups you may owe",
      "The home-screen panel shows your schedule, unread mail, tasks due and approvals",
      "Accept a suggestion to turn it into a task — it never acts on its own",
    ],
  },
  workrooms: {
    tagline: "Persistent co-work spaces with Gerry.",
    capabilities: [
      "Every project has a room built in; make one here for work that is not a project",
      "Pin documents, files, notes, email threads, tasks and records to the room",
      "Every message carries the goal, the pins and recent progress — no re-explaining",
      "Gerry works between sessions: scheduled jobs, a morning digest, suggested next steps",
      "Share a room to Drive so a teammate can join a mirror of it",
    ],
  },
  browser: {
    tagline: "Browse the web with Gerry looking over your shoulder.",
    capabilities: [
      "A real browser inside the app — tabs, bookmarks and logins that survive a restart",
      "Turn on \"Browse with Gerry\" and the page you are reading joins the chat",
      "Save a page straight into the knowledge base, or pin it to a room",
      "A floating bar keeps those buttons on every page you visit",
      "Gerry never browses on her own — you drive",
    ],
  },

  // ── Work ────────────────────────────────────────────────────────────────
  projects: {
    tagline: "Organise work into projects.",
    capabilities: [
      "Each project has an overview, timeline, canvas, tasks, budget, room and chat",
      "Plan on the timeline: drag to reschedule, link tasks, mark milestones, spot what is late",
      "Think on the canvas: sticky notes, shapes, pen and images, plus live cards for real tasks, documents and budgets",
      "Zoom out on the canvas and it folds a layer at a time \u2014 notes first, then sub-tasks into their parent \u2014 with a count you can click to open",
      "Track tasks with sub-tasks nested under their parent, and file one under another by dropping its canvas card on top",
      "Collect a project's invoices from Drive folders, the inbox or a file you hand over, and share a budget from your own machine after a warning about who will read it",
      "Pin material to the room, link projects to one another, and see what waits on what",
      "Inside a project the side panel is the project's Gerry: it knows the project, its goal, its pins and which tab you are on, and the Chat tab shows the same conversation without leaving the space",
      "Move a project made on this computer to the hub to share it \u2014 with the people you name, or everyone at the firm; its tasks then show on your board, calendar, dashboard and portfolio with a hub pill",
      "Ask Gerry to read a project, add a batch of tasks from a contract, break a task into sub-tasks, or schedule its work \u2014 shared hub projects included",
    ],
  },
  portfolio: {
    tagline: "Every project, and how they relate.",
    capabilities: [
      "See all the projects you can access laid out by what waits on what",
      "Each card shows open work, late work, open gates and the next milestone",
      "Gates and dependencies are drawn as arrows; work running alongside is drawn dashed",
      "A link into a project you cannot see is drawn without its name",
      "Double-click a card to open that project's space",
    ],
  },
  tasks: {
    tagline: "Track your to-dos on a board.",
    capabilities: [
      "Drag-and-drop kanban board with priorities, assignees and due dates",
      "One form everywhere: title, project, due, priority, assignee — More for description, dates, tags and milestone. The project decides whether it lives here or on the hub",
      "Create, assign and update tasks just by asking Gerry in chat or by voice",
      "Turn emails, meeting action items or assistant suggestions into tasks automatically",
      "Routines: recurring jobs Gerry runs on a schedule, each run's output kept",
    ],
  },
  calendar: {
    tagline: "Your calendar, inside Gerry.",
    capabilities: [
      "View your Google Calendar and upcoming events without leaving the app",
      "Ask about your day, have Gerry find open times or prep you for meetings",
      "Click a day and press + to make a task due that day",
      "Gerry can create events for you — each one goes through your approval first",
      "Today's schedule shows on the home-screen briefing panel",
    ],
  },
  meetings: {
    tagline: "Never lose what was said.",
    capabilities: [
      "Record or import meetings and get automatic transcripts and summaries",
      "Pull out action items and turn them into tasks with one click",
      "Ask Gerry questions about any past meeting — 'what did we decide about the pump head?'",
    ],
  },

  // ── Knowledge ───────────────────────────────────────────────────────────

  documents: {
    tagline: "Store what Gerry should know.",
    capabilities: [
      "Three tabs: Library, Search (ask in plain language, filter by category) and Made by Gerry (files she generated)",
      "Upload PDFs, Word docs and text — searchable in seconds",
      "Every Add to Knowledge Base button — email, meetings, browser, Drive, Gerry's files — asks the same three things: title, category, regulated",
      "Duplicates are named, not skipped: choose Add anyway or stop",
      "Each document shows where it came from: From email, From a meeting, Made by Gerry, From the web, From Drive",
    ],
  },
  research: {
    tagline: "Let Gerry do the digging.",
    capabilities: [
      "Ask Gerry to research a topic on the web and compile the findings for you",
      "Great for background on suppliers, competitors, regulations or markets",
      "Save findings into the knowledge base so they're citable later",
    ],
  },
  inbox: {
    tagline: "Your Gmail, with Gerry alongside.",
    capabilities: [
      "All of Gmail's folders, with search, sorting, tags and auto-refresh",
      "Read full threads with images and attachments, legible in dark mode",
      "Open Office attachments in Google Docs, or add any of them to the knowledge base",
      "Send your own mail, or have Gerry draft replies for your approval — several at once if you like",
    ],
  },
  contacts: {
    tagline: "A contacts book that builds itself.",
    capabilities: [
      "Contacts gather themselves from the people you email, plus Google Contacts",
      "Ask Gerry to save a person or import a whole pasted list",
      "Gerry fills in addresses when drafting, and asks when it's ambiguous",
    ],
  },

  // ── Finance ───────────────────────────────────────────────────
  odoo: {
    tagline: "Your ERP, a question away.",
    capabilities: [
      "Connect Odoo and ask about customers, sales, invoices, purchases, inventory and leads in plain language",
      "Check bank balances instantly — they also show on the home-screen briefing panel",
      "Import ERP datasets into the Knowledge Base so answers cite real business data",
      "Gerry can propose ERP changes — every write goes through your approval first",
    ],
  },
  budgets: {
    tagline: "Your personal budgets — one ledger, two surfaces.",
    capabilities: [
      "A budget lives as a Google Sheet in the shared folder — edit it here or in Sheets",
      "Set an allotment and watch spending against it",
      "Mark lines Spent, Allocated, Collected or Expected, so commitments count before they are paid",
      "Collect invoices from watched Drive folders, from the inbox, or by handing one over — everything found waits for you to accept it",
      "A category read off an invoice that the sheet does not have yet is added to it",
      "Gerry can add entries when you allow it, and warn you at 80% and 100%",
      "A personal financial-management aid — not the company's official books",
    ],
  },

  // ── Compliance ──────────────────────────────────────────────────────────

  regulatory: {
    tagline: "Compliance answers you can trust.",
    capabilities: [
      "Track regulatory requirements, standards and submission status",
      "Ask Gerry compliance questions — answers cite your regulated documents",
      "Gerry knows PMI's regulatory context (510(k), ISO 13485, key standards) from the company profile",
    ],
  },
  waiting: {
    tagline: "One list of what needs you.",
    capabilities: [
      "Approvals, Gerry's suggestions and notifications in one place, with a tab for each",
      "The bell at the top opens the same list from any page; its number is decisions, suggestions and unread notifications, each counted once",
      "Approve or reject right here — the buttons only show while the decision is still open",
      "Every outbound action — emails, calendar events, ERP changes — waits for your explicit OK; edit a drafted email before approving",
      "Accept a suggestion, mark it already done, or dismiss it without leaving the list — each confirms what it did, and nothing you dismiss comes back on its own",
    ],
  },
  team: {
    tagline: "Your team, in one place.",
    capabilities: [
      "Everyone — one channel for the whole company, on the hub, so every computer reads the same thread",
      "A channel for each hub project, with everyone who has a role on it already inside; open it from the project's Team tab too",
      "Named groups and direct messages; rename a group, add or remove people, leave when you are done",
      "@mention someone and it lands under Waiting for you; unread counts on the rail and on each channel",
      "Attach files up to 15 MB (kept on the hub), link a hub task, or add a link — they show as chips anyone can open",
      "Markdown in messages; edit or delete your own — a deleted message says so rather than vanishing",
    ],
  },
  audit: {
    tagline: "A record you can prove.",
    capabilities: [
      "A complete, tamper-evident log of important actions — kept forever, deletions impossible by design",
      "Every entry is hash-chained so any alteration is detectable",
      "Verify integrity and export the record any time",
    ],
  },

  // ── You ──────────────────────────────────────────────────────────────────────────────
  users: {
    tagline: "Manage who gets in.",
    capabilities: [
      "Add and manage people who can access Little Gerry",
      "Control their roles and permissions — including regulated-document access",
    ],
  },
  settings: {
    tagline: "Control how Gerry looks and behaves.",
    capabilities: [
      "Five tabs: Profile, AI, Connections, Company, System",
      "Set up API keys, AI models, theme, timezone and voice; tune the specialist agents per task",
      "Connect Google Workspace, Odoo and the hub; view the always-loaded Company Profile",
      "Check system health, keep conversation backups, and install updates in-app",
    ],
  },
};

/** Longest matching prefix wins. Query strings are ignored on purpose. */
const ROUTE_GUIDES: { prefix: string; id: string; title: string; icon: LucideIcon }[] = [
  { prefix: "/today", id: "dashboard", title: "Today", icon: Sun },
  { prefix: "/dashboard", id: "dashboard", title: "Today", icon: Sun },
  { prefix: "/waiting", id: "waiting", title: "Waiting for you", icon: Bell },
  { prefix: "/assistant", id: "assistant", title: "Suggestions", icon: Sparkles },
  { prefix: "/chat", id: "gerry", title: "Little Gerry", icon: Bot },
  { prefix: "/hub/chat", id: "gerry", title: "Little Gerry", icon: Bot },
  { prefix: "/projects/portfolio", id: "portfolio", title: "Graph", icon: Network },
  { prefix: "/projects", id: "projects", title: "Projects", icon: FolderOpen },
  { prefix: "/hub/projects", id: "projects", title: "Projects", icon: FolderOpen },
  { prefix: "/workrooms", id: "workrooms", title: "Rooms", icon: Handshake },
  { prefix: "/tasks", id: "tasks", title: "Tasks", icon: FolderKanban },
  { prefix: "/team", id: "team", title: "Team", icon: MessagesSquare },
  { prefix: "/calendar", id: "calendar", title: "Calendar", icon: CalendarDays },
  { prefix: "/meetings", id: "meetings", title: "Meetings", icon: Mic },
  { prefix: "/documents", id: "documents", title: "Knowledge Base", icon: FileText },
  { prefix: "/research", id: "research", title: "Research", icon: FlaskConical },
  { prefix: "/browser", id: "browser", title: "Research Browser", icon: Compass },
  { prefix: "/inbox", id: "inbox", title: "Mail", icon: Inbox },
  { prefix: "/contacts", id: "contacts", title: "Contacts", icon: Users },
  { prefix: "/odoo", id: "odoo", title: "Odoo", icon: Boxes },
  { prefix: "/budgets", id: "budgets", title: "Budgets", icon: Wallet },
  { prefix: "/regulatory", id: "regulatory", title: "Regulatory", icon: ShieldCheck },
  { prefix: "/audit", id: "audit", title: "Audit trail", icon: ScrollText },
  { prefix: "/users", id: "users", title: "Users", icon: Users },
  { prefix: "/settings", id: "settings", title: "Settings", icon: Settings },
];

/** The feature-guide entry for a router pathname, or null for an unknown route. */
export function resolveGuide(pathname: string): ResolvedGuide | null {
  const path = pathname.split("?")[0];
  let best: (typeof ROUTE_GUIDES)[number] | undefined;
  for (const r of ROUTE_GUIDES) {
    const hit = path === r.prefix || path.startsWith(r.prefix + "/");
    if (hit && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  if (!best) return null;
  const entry = FEATURE_GUIDE[best.id];
  if (!entry) return null;
  return { id: best.id, title: best.title, icon: best.icon, ...entry };
}
