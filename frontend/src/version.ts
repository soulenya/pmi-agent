/**
 * Little Gerry — build changelog.
 * Increment BUILD_NUMBER and add an entry to CHANGELOG with every improvement.
 */

export const BUILD_NUMBER = 17;
export const BUILD_DATE = "2026-06-05";

export interface ChangelogEntry {
  build: number;
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    build: 17,
    date: "2026-06-05",
    title: "First-Run Setup Wizard",
    changes: [
      "After first Google login, a setup wizard appears to configure the AI model",
      "Choose Anthropic, OpenAI, or Ollama; enter API key or server URL",
      "Model list loads live from the selected provider",
      "Connection is tested before proceeding — won't let you in with a broken config",
    ],
  },
  {
    build: 16,
    date: "2026-06-05",
    title: "Migration Preparation",
    changes: [
      "LLM error frames now show in the chat bubble instead of being silently dropped",
      "Added backup-ollama-models.ps1 to back up model files before server migration",
      "Added migrate-to-server.ps1 — guided migration day runbook with verification",
    ],
  },
  {
    build: 15,
    date: "2026-06-05",
    title: "Remote Ollama Server Support",
    changes: [
      "Ollama server URL is now fully configurable — point to any machine on the network",
      "Settings → Ollama shows 'Ollama Server URL' field (e.g. http://192.168.1.50:11434)",
      "Health check and model list both use the configured URL (no longer hardcoded to localhost)",
      "Includes server setup and cleanup PowerShell scripts (scripts/ folder)",
    ],
  },
  {
    build: 14,
    date: "2026-06-04",
    title: "Google Workspace SSO Login",
    changes: [
      "Login now uses Google Sign-In — no more email/password form",
      "Only @pmi-llc.com and @precisianmedical.com accounts are accepted",
      "A browser window opens for Google consent; app waits and logs you in automatically",
      "Unknown accounts are rejected with a clear error message",
    ],
  },
  {
    build: 13,
    date: "2026-06-04",
    title: "First-Run Setup Fix",
    changes: [
      "First-run setup now waits for Docker Desktop to be fully ready (up to 90s) before starting the database",
      "Setup now polls PostgreSQL with pg_isready before running migrations — no more timing failures",
      "Launcher also improved: falls back to launching Docker Desktop.exe if the Windows service fails",
      "Clear user-facing error messages if Docker doesn't start in time",
    ],
  },
  {
    build: 12,
    date: "2026-06-04",
    title: "Database & Stability",
    changes: [
      "Launcher now uses docker compose up — recreates DB container if deleted",
      "Backend stderr redirected to backend/logs/backend_stderr.log for diagnostics",
      "Removed spurious import from backend lifespan",
    ],
  },
  {
    build: 11,
    date: "2026-06-04",
    title: "First-Message Fix",
    changes: [
      "Typing a message before a conversation exists no longer discards it",
      "Message is now sent automatically once the new conversation + WebSocket are ready",
    ],
  },
  {
    build: 10,
    date: "2026-06-04",
    title: "Auth Reliability",
    changes: [
      "Fixed token refresh URL (was hitting Vite dev server instead of backend)",
      "Access token now persisted across restarts to avoid broken-auth loop",
    ],
  },
  {
    build: 9,
    date: "2026-06-04",
    title: "Google OAuth — Full Consent",
    changes: [
      "Added prompt=consent so Google always shows all scopes on reconnect",
      "Prevents Google's cache from silently dropping newly added scopes",
    ],
  },
  {
    build: 8,
    date: "2026-06-04",
    title: "Character Encoding & Google Hallucination Fix",
    changes: [
      "Fixed garbled characters in chat and documents UI (encoding fix)",
      "AI now told explicitly when Google is not connected — stops fabricating file lists",
    ],
  },
  {
    build: 7,
    date: "2026-06-04",
    title: "Backend Health Indicator on Login",
    changes: [
      "Login page polls /health every 3 s and shows Connected / Connecting / Not reachable",
      "Form disabled until backend is confirmed healthy — no more confusing error messages",
      "Backend retries DB connection up to 10× on startup (handles slow Docker starts)",
    ],
  },
  {
    build: 6,
    date: "2026-06-03",
    title: "Login UX",
    changes: [
      "Remember email checkbox persists login email in localStorage",
      "Login errors now classified: network vs auth vs server (no more wrong 'invalid password')",
    ],
  },
  {
    build: 5,
    date: "2026-06-03",
    title: "Update Checker UX",
    changes: [
      "Settings > Update section shows real states: checking, up-to-date, update available",
      "Install button and error detail now visible instead of silent failures",
    ],
  },
  {
    build: 4,
    date: "2026-06-03",
    title: "In-App Service Menu",
    changes: [
      "··· menu in sidebar header: Restart Services, Update, Update & Restart, Stop All",
      "Calls backend control endpoints — no need to use system tray",
    ],
  },
  {
    build: 3,
    date: "2026-06-02",
    title: "System Tray Controls",
    changes: [
      "Tray menu: Restart Services, Update, Update & Restart, Stop All Services",
      "Backend control-file polling for cross-process commands",
    ],
  },
  {
    build: 2,
    date: "2026-06-01",
    title: "Cloud Model Switcher",
    changes: [
      "Header dropdown to switch LLM provider (OpenAI / Anthropic / Ollama)",
      "API key input inline for cloud providers; saves via PUT /settings",
    ],
  },
  {
    build: 1,
    date: "2026-05-31",
    title: "Initial Release",
    changes: [
      "AI chat with tool use (Drive, Gmail, Calendar, Contacts, Tasks, web search)",
      "Knowledge base with document upload and vector search",
      "Projects, Tasks, Calendar, Approvals, Audit Trail",
      "Google Workspace OAuth integration",
      "System tray launcher with splash screen",
    ],
  },
];
