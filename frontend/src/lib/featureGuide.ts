/**
 * "What Gerry can do" feature guide.
 *
 * A short, friendly snapshot of what Little Gerry can do in each section of the
 * app. Keyed by the celestial node id (sun / satellite / planet / moon) so the
 * same content powers both the once-per-build auto-popup and the Help button.
 */
import { HelpCircle, type LucideIcon } from "lucide-react";
import { locateRoute, SUN, SATELLITES } from "@/lib/solarSystem";

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
      "Talk hands-free, or click \"Ask Gerry\" on any item to chat about it",
    ],
  },
  dashboard: {
    tagline: "Today at a glance.",
    capabilities: [
      "See pending approvals, notifications, today's meetings and recent activity in one place",
      "Read your AI-generated daily briefing",
      "Jump straight to whatever needs your attention",
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
      "Create a room around a goal and work in it for days or weeks",
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
      "Save a page straight into the knowledge base, or pin it to a workroom",
      "A floating bar keeps those buttons on every page you visit",
      "Gerry never browses on her own — you drive",
    ],
  },

  // ── Work ────────────────────────────────────────────────────────────────
  work: {
    tagline: "Everything to run your work.",
    capabilities: [
      "Projects, tasks, schedules, calendar and meeting notes together in one area",
      "Ask Gerry to plan, track and follow up across all of them",
      "Turn emails, meetings and chats into tracked work in one step",
    ],
  },
  projects: {
    tagline: "Organise work into projects.",
    capabilities: [
      "Each project has an overview, timeline, canvas, tasks, budget, material and chat",
      "Plan on the timeline: drag to reschedule, link tasks, mark milestones, spot what is late",
      "Think on the canvas: sticky notes, shapes, pen and images, plus live cards for real tasks, documents and budgets",
      "Track tasks with sub-tasks nested under their parent and a status colour on every row",
      "Pin documents, Drive files, websites, notes and email threads on the Material tab",
      "Link projects so one waits on, gates or runs alongside another",
      "Choose who can see each project, and add people by their work email",
      "Ask Gerry to read a project, add a batch of tasks from a contract, or schedule its work \u2014 shared hub projects included",
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
      "Create, assign and update tasks just by asking Gerry in chat or by voice",
      "Turn emails, meeting action items or assistant suggestions into tasks automatically",
      "Due tasks appear in your daily briefing and home-screen panel",
    ],
  },
  "scheduled-tasks": {
    tagline: "Put routine work on autopilot.",
    capabilities: [
      "Set recurring jobs for Gerry to run on a schedule — daily, weekly or custom",
      "Automate routine briefings, checks, reports and reminders",
      "Review each run's output and adjust the schedule any time",
    ],
  },
  calendar: {
    tagline: "Your calendar, inside Gerry.",
    capabilities: [
      "View your Google Calendar and upcoming events without leaving the app",
      "Ask about your day, have Gerry find open times or prep you for meetings",
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
  knowledge: {
    tagline: "Answers grounded in your own documents.",
    capabilities: [
      "A searchable knowledge base, research tools and generated files",
      "Ask Gerry anything and get answers backed by your sources — with citations",
      "Gerry reads whole documents start-to-finish when you ask for summaries or analysis",
    ],
  },
  documents: {
    tagline: "Store what Gerry should know.",
    capabilities: [
      "Upload PDFs, Word docs and text — searchable in seconds",
      "Import from Google Drive, email threads or Odoo datasets",
      "Ask Gerry to add a Drive file, an attachment or one of her own files",
      "Keep regulated files in their own categories with tighter controls",
    ],
  },
  search: {
    tagline: "Ask, don't dig.",
    capabilities: [
      "Search across all your knowledge with natural-language questions",
      "Get answers with citations back to the source document",
      "Filter by category to narrow where answers come from",
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
  files: {
    tagline: "Everything Gerry has made for you.",
    capabilities: [
      "Find and download the documents, spreadsheets and reports Gerry generated",
      "Open one in Google Docs or add it to the knowledge base, right from the chat card",
      "Gerry follows your company's document templates from a shared Drive folder",
      "Use \"Ask Gerry\" on any file to discuss its contents",
    ],
  },

  // ── Communications ──────────────────────────────────────────────────────
  communications: {
    tagline: "Your email, contacts and Google Workspace.",
    capabilities: [
      "Read, draft and send email with Gerry's help — safely, with approval on every AI-drafted send",
      "A contacts book that builds itself from the people you email",
      "Manage your Google connection and see everything it enables",
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
  google: {
    tagline: "Connect Gmail, Calendar and Drive.",
    capabilities: [
      "One connection powers email, calendar, contacts, Drive and live Google Docs",
      "Gerry reads on request — writes always go through approvals",
      "Ask \"is the Drive backed up?\" and Gerry checks last night's backup",
    ],
  },

  // ── Odoo / Enterprise ───────────────────────────────────────────────────
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
      "Gerry can add entries when you allow it, read a folder of invoices and suggest lines, and warn you at 80% and 100%",
      "A personal financial-management aid — not the company's official books",
    ],
  },

  // ── Compliance ──────────────────────────────────────────────────────────
  compliance: {
    tagline: "Stay on the right side of the rules.",
    capabilities: [
      "Regulations, investors, approvals and your audit trail in one area",
      "Compliance answers grounded in your regulated document library",
      "Gerry keeps a tamper-evident record of sensitive actions",
    ],
  },
  regulatory: {
    tagline: "Compliance answers you can trust.",
    capabilities: [
      "Track regulatory requirements, standards and submission status",
      "Ask Gerry compliance questions — answers cite your regulated documents",
      "Gerry knows PMI's regulatory context (510(k), ISO 13485, key standards) from the company profile",
    ],
  },
  investor: {
    tagline: "Keep investors in the loop.",
    capabilities: [
      "Organise investor information and updates in one place",
      "Ask Gerry to help prepare investor communications — sends always need your approval",
      "Investor identities stay confidential — Gerry treats them as NDA-covered",
    ],
  },
  approvals: {
    tagline: "Nothing happens without your say-so.",
    capabilities: [
      "Every outbound action — emails, calendar events, ERP changes — waits here for your explicit OK",
      "Approve from wherever you are: in the email thread, in chat, from a notification, or the top-bar drawer",
      "Edit Gerry's drafted emails before approving; rejected drafts return for editing",
      "A clear 'sent' confirmation follows every approved email",
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

  // ── Administration ──────────────────────────────────────────────────────
  administration: {
    tagline: "Set Gerry up your way.",
    capabilities: [
      "Settings, users, agents, notifications and backups together",
      "Configure how Little Gerry works for you",
    ],
  },
  notifications: {
    tagline: "Stay informed without checking everywhere.",
    capabilities: [
      "See alerts about approvals, tasks, documents and system activity",
      "Approve or reject Gerry's pending actions right from the notification",
      "Every notification links straight to the page where it matters",
    ],
  },
  users: {
    tagline: "Manage who gets in.",
    capabilities: [
      "Add and manage people who can access Little Gerry",
      "Control their roles and permissions — including regulated-document access",
    ],
  },
  agents: {
    tagline: "Tune Gerry's specialist helpers.",
    capabilities: [
      "Configure the specialist agents Gerry uses — engineering, regulatory, QMS, research and more",
      "Pick models and adjust behaviour per task",
    ],
  },
  backups: {
    tagline: "Your conversations, safe and provable.",
    capabilities: [
      "Keep signed, append-only snapshots of your chats on your computer and Google Drive",
      "Check integrity and download any backup",
    ],
  },
  settings: {
    tagline: "Control how Gerry looks and behaves.",
    capabilities: [
      "Set up API keys, AI models, theme, timezone and voice",
      "View the always-loaded Company Profile and refresh it from the shared Drive file",
      "Pick Gerry's voice — the newest natural voices are listed first",
      "Check system health and install updates in-app",
    ],
  },
};

/**
 * Resolve the current router pathname to the most specific feature-guide entry
 * (moon → satellite → sun → planet). Returns null for the overview canvas or an
 * unknown route.
 */
export function resolveGuide(pathname: string): ResolvedGuide | null {
  const loc = locateRoute(pathname);

  let id: string | undefined;
  let title: string | undefined;
  let icon: LucideIcon | undefined;

  if (loc.moon) {
    id = loc.moon.id;
    title = loc.moon.label;
    icon = loc.moon.icon;
  } else if (loc.satellite) {
    id = loc.satellite.id;
    title = loc.satellite.label;
    icon = loc.satellite.icon;
  } else if (loc.isSun) {
    id = SUN.id;
    title = SUN.label;
    icon = SUN.icon;
  } else if (loc.planet) {
    id = loc.planet.id;
    title = loc.planet.label;
    icon = loc.planet.icon;
  }

  if (!id) return null;
  const entry = FEATURE_GUIDE[id];
  if (!entry) return null;

  return {
    id,
    title: title ?? "Little Gerry",
    icon: icon ?? HelpCircle,
    ...entry,
  };
}

/** All satellite ids, exported so callers can reason about non-planet sections. */
export const SATELLITE_IDS = SATELLITES.map((s) => s.id);
