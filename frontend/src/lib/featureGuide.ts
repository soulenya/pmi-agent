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
      "Ask questions across your projects, documents, email and calendar in plain language",
      "Gerry always knows PMI's people, products, partners and regulatory picture from the shared company profile — and knows who you are",
      "Say \"help me with this document\" and Gerry follows your Google Doc live, re-reading your latest edits on every message",
      "Talk hands-free with the voice assistant — Gerry answers out loud in short, natural replies and offers to go deeper",
      "Draft emails (with your signature), create tasks and contacts, research topics, generate documents — then review the results",
      "Approve Gerry's proposed actions right in the chat — anything that reaches the outside world waits for your OK first",
      "Click \"Ask Gerry\" on any task, contact, email, file, document, event or project to start a chat about it",
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
      "A once-a-day scan of Gmail and Google Tasks surfaces follow-ups you may owe and emails that need replies",
      "The briefing panel on the home screen shows today's schedule, unread email, tasks due, approvals, suggestions and Odoo balances at a glance",
      "Accept a suggestion with one click to turn it into a task — the assistant never acts on its own",
    ],
  },
  workrooms: {
    tagline: "Persistent co-work spaces with Gerry.",
    capabilities: [
      "Create a room around a goal — a 510(k) submission, an audit prep, a fundraise — and work in it for days or weeks",
      "Pin Drive docs, KB documents, generated files, notes, email threads, tasks, Odoo records and regulatory documents to the room",
      "Every message in the room's chat carries the goal, pinned items and recent progress — no re-explaining context each session",
      "Ask Gerry to pin things or log progress herself — and files she creates, docs she imports and documents she follows in the room are pinned and journaled automatically",
      "Gerry works between sessions: standing room tasks run on a schedule inside the room, a morning digest reports what changed since yesterday, and Gerry proposes next steps you can accept or dismiss",
      "Share a room to the company Drive so a teammate can join a mirror of it — same goal and pinned documents, their own Gerry and journal",
      "Log progress in the journal so Gerry (and future you) always knows where things stand",
    ],
  },
  browser: {
    tagline: "Browse the web with Gerry looking over your shoulder.",
    capabilities: [
      "A real browser inside the app — tabs, back and forward, bookmarks, and logins that survive a restart",
      "Turn on \"Browse with Gerry\" and the page you are reading joins the chat, so you can ask about it without copying anything across",
      "Save a page straight into the knowledge base, or pin it to a workroom",
      "The same buttons ride on a bar in the bottom-left corner of every page you visit, so you never have to come back to the app window",
      "\"Fit to window\" parks the browser over the page area, leaving the navigation and the chat panel clear",
      "Leave the browser page and the window tucks away; the compass at the foot of the left rail pulses and brings it back",
      "Gerry never browses on her own — you drive, and page text reaches her as material you are showing her, never as instructions",
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
      "Keep project details, files and linked tasks in one place",
      "Open a project's space for its overview, tasks, material and conversation",
      "Choose who can see each project: private, a named member list, or the whole company",
      "Ask Gerry to summarise a project, draft its next steps or report its status",
      "Use \"Ask Gerry\" on any project to start a conversation seeded with its details",
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
      "Upload PDFs, Word docs and text — auto-chunked and searchable in seconds",
      "Import straight from Google Drive, email threads or Odoo datasets",
      "Or just ask Gerry in chat — she can add Drive files and her generated files to the knowledge base for you",
      "Add email attachments to the knowledge base with one click from your inbox",
      "Keep regulated files in their own categories with tighter controls",
      "Share a knowledge-base manifest so teammates can import the same library",
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
      "Find documents, spreadsheets and reports Gerry generated",
      "Download them, upload them to Drive, or ask Gerry to refine them further",
      "Files Gerry creates in chat carry an action card: Download, Open in Workspace (edits in Google Docs), or Add to KB — right in the conversation",
      "Gerry follows your company's document templates (memo, SOP, letter…) from a shared Drive folder — drop in a new template doc and every teammate's output updates instantly",
      "Use \"Ask Gerry\" on any file to discuss its actual contents",
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
      "Browse all of Gmail's folders — Inbox, Sent, Drafts, Starred, Spam and more — with sorting, search, tags and auto-refresh every minute",
      "Read full threads (newest message first) with images and attachments rendered legibly in dark mode",
      "Open Word, Excel and PowerPoint attachments straight in Google Docs, Sheets and Slides — or add any attachment to the Knowledge Base in one click",
      "Compose and send your own email instantly; ask Gerry to draft replies — they appear right in the thread for approval, complete with your signature",
      "Tick several emails and 'Draft selected' to have Gerry prepare a reply to each",
      "'Load 30 more' reaches older conversations as far back as you need",
    ],
  },
  contacts: {
    tagline: "A contacts book that builds itself.",
    capabilities: [
      "Contacts are gathered automatically from the people you email — plus Google Contacts",
      "Ask Gerry to save a person or import a whole pasted list straight to this page",
      "Gerry uses these contacts to fill in email addresses when drafting — and asks when it's ambiguous",
      "Ask 'who's our contact at <company>?' any time",
    ],
  },
  google: {
    tagline: "Connect Gmail, Calendar and Drive.",
    capabilities: [
      "One connection powers email, calendar, contacts, Drive search and live Google Docs collaboration",
      "Gerry reads your Drive and Docs on request — writes always go through approvals",
      "Ask 'is the Drive backed up?' — Gerry checks the nightly backup bucket against live Drive and reports what's changed since",
      "Manage your connection and permissions any time",
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
      "Create a budget and it lives as a Google Sheet in the company's shared budgets folder — edit it here or in Sheets, changes reflect in both",
      "Set an optional allotment and watch spending against it with live progress bars",
      "Grant Gerry per-budget permission to add and edit entries at your request — deletions always confirm with you first",
      "Proactive nudges: 80%/100% allotment alerts, category-cap warnings, and monthly rollups — read-only, never touching your sheet",
      "Link Drive folders of invoices or receipts — Gerry reads them (OCR included), extracts the amounts, and suggests entries you accept or dismiss",
      "Link any existing spreadsheet read-only; unlinking never deletes your sheet",
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
