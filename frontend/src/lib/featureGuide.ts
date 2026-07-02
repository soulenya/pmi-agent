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
      "Talk hands-free with the voice assistant, or type in chat",
      "Kick off tasks, research and drafts, then review the results",
      "Anything Gerry does that reaches the outside world waits for your OK first",
    ],
  },
  dashboard: {
    tagline: "Today at a glance.",
    capabilities: [
      "See pending approvals, notifications and recent activity in one place",
      "Jump straight to whatever needs your attention",
    ],
  },
  assistant: {
    tagline: "Your proactive daily briefing.",
    capabilities: [
      "Start the day with unread email, upcoming meetings and due tasks in one view",
      "Let Gerry suggest next actions you can approve with one click",
    ],
  },

  // ── Work ────────────────────────────────────────────────────────────────
  work: {
    tagline: "Everything to run your work.",
    capabilities: [
      "Projects, tasks, schedules, calendar and meeting notes together in one area",
      "Ask Gerry to plan, track and follow up across all of them",
    ],
  },
  projects: {
    tagline: "Organise work into projects.",
    capabilities: [
      "Keep project details, files and linked tasks in one place",
      "Ask Gerry to summarise a project or draft its next steps",
    ],
  },
  tasks: {
    tagline: "Track your to-dos on a board.",
    capabilities: [
      "Create, assign and update tasks just by asking Gerry",
      "Turn emails, meetings or chats into tasks automatically",
    ],
  },
  "scheduled-tasks": {
    tagline: "Put routine work on autopilot.",
    capabilities: [
      "Set recurring jobs for Gerry to run on a schedule",
      "Automate routine briefings, checks and reports",
    ],
  },
  calendar: {
    tagline: "Your calendar, inside Gerry.",
    capabilities: [
      "View your Google Calendar and upcoming events",
      "Ask about your day and have Gerry find times or prep for meetings",
    ],
  },
  meetings: {
    tagline: "Never lose what was said.",
    capabilities: [
      "Record or import meetings and get automatic transcripts and summaries",
      "Pull out action items and turn them into tasks",
    ],
  },

  // ── Knowledge ───────────────────────────────────────────────────────────
  knowledge: {
    tagline: "Answers grounded in your own documents.",
    capabilities: [
      "A searchable knowledge base, research tools and generated files",
      "Ask Gerry anything and get answers backed by your sources",
    ],
  },
  documents: {
    tagline: "Store what Gerry should know.",
    capabilities: [
      "Organise documents Gerry can read and cite",
      "Import from Google Drive and keep regulated files in their own categories",
    ],
  },
  search: {
    tagline: "Ask, don't dig.",
    capabilities: [
      "Search across all your knowledge with natural-language questions",
      "Get answers with citations back to the source document",
    ],
  },
  research: {
    tagline: "Let Gerry do the digging.",
    capabilities: [
      "Ask Gerry to research a topic and compile the findings for you",
      "Great for background on suppliers, regulations or markets",
    ],
  },
  files: {
    tagline: "Everything Gerry has made for you.",
    capabilities: [
      "Find documents, spreadsheets and reports Gerry generated",
      "Download them or ask Gerry to refine them further",
    ],
  },

  // ── Communications ──────────────────────────────────────────────────────
  communications: {
    tagline: "Your email, contacts and Google Workspace.",
    capabilities: [
      "Read, draft and send email with Gerry's help — safely",
      "Keep your contacts and Google connection in one place",
    ],
  },
  inbox: {
    tagline: "Your Gmail, with Gerry alongside.",
    capabilities: [
      "Read your inbox with full threads, images and attachments",
      "Compose new email yourself, or ask Gerry to draft one for your approval",
      "Tick the emails you want, then 'Draft selected' to have Gerry prepare a reply to each",
      "Move an email to Trash, and filter your inbox by any tag you've saved",
      "Smart tags and a saved signature keep your mail organised",
    ],
  },
  contacts: {
    tagline: "A contacts book that builds itself.",
    capabilities: [
      "Contacts are gathered automatically from the people you email",
      "Add or edit contacts, and ask 'who's our contact at <company>?'",
    ],
  },
  google: {
    tagline: "Connect Gmail, Calendar and Drive.",
    capabilities: [
      "Give Gerry access to your Google Workspace so it can work with it",
      "Manage your connection and permissions any time",
    ],
  },

  // ── Odoo ────────────────────────────────────────────────────────────────
  odoo: {
    tagline: "Your ERP, a question away.",
    capabilities: [
      "Connect your Odoo ERP so Gerry can look up business data",
      "Ask about orders, inventory, contacts and more",
    ],
  },

  // ── Compliance ──────────────────────────────────────────────────────────
  compliance: {
    tagline: "Stay on the right side of the rules.",
    capabilities: [
      "Regulations, investors, approvals and your audit trail in one area",
      "Gerry keeps a tamper-evident record of sensitive actions",
    ],
  },
  regulatory: {
    tagline: "Compliance answers you can trust.",
    capabilities: [
      "Track regulatory requirements and ask Gerry compliance questions",
      "Answers are grounded in your regulated document library",
    ],
  },
  investor: {
    tagline: "Keep investors in the loop.",
    capabilities: [
      "Organise investor information and updates",
      "Ask Gerry to help prepare investor communications",
    ],
  },
  approvals: {
    tagline: "Nothing happens without your say-so.",
    capabilities: [
      "Review everything Gerry wants to do before it happens",
      "Approve, edit or reject emails, tasks and other actions one by one",
    ],
  },
  audit: {
    tagline: "A record you can prove.",
    capabilities: [
      "See a complete, tamper-evident log of important actions",
      "Verify its integrity and export the record",
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
      "See alerts about approvals, tasks and system activity",
      "Catch what matters without visiting every page",
    ],
  },
  users: {
    tagline: "Manage who gets in.",
    capabilities: [
      "Add and manage people who can access Little Gerry",
      "Control their roles and permissions",
    ],
  },
  agents: {
    tagline: "Tune Gerry's specialist helpers.",
    capabilities: [
      "Configure the agents Gerry uses for different jobs",
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
      "Set up API keys, models, theme and integrations",
      "Fine-tune Little Gerry to your preferences",
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
