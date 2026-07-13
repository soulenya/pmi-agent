/**
 * Little Gerry — build changelog.
 * Increment BUILD_NUMBER and add an entry to CHANGELOG with every improvement.
 */

export const BUILD_NUMBER = 135;
export const BUILD_DATE = "2026-07-13";

export interface ChangelogEntry {
  build: number;
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    build: 135,
    date: "2026-07-13",
    title: "'What Gerry can do' now shows the full picture",
    changes: [
      "The help popup on every page now advertises the section's real capabilities — live Google Docs collaboration, approve-anywhere, attachment-to-KB, voice, the briefing panel, company profile awareness, and more",
      "Every section's guide grew from a couple of lines to a proper capability list, current with the latest features",
    ],
  },
  {
    build: 134,
    date: "2026-07-13",
    title: "Work on Google Docs together with Gerry, live — plus one-click return to chat",
    changes: [
      "Say 'help me with this document' and Gerry lists your recent Google Docs, confirms which one, and follows it — re-reading your latest edits on every message so her feedback always matches what's on your screen",
      "Paste a Google Docs link for instant feedback, or ask Gerry to 'follow' it for the whole conversation; 'stop following' ends it",
      "A new chat button at the top of the left rail jumps straight back to your last open conversation from any page — no more convoluted navigation after visiting Generated Files or another moon",
    ],
  },
  {
    build: 133,
    date: "2026-07-09",
    title: "Installer sets up WSL 2 automatically — no Ubuntu, no Unix account prompt",
    changes: [
      "The installer now enables the WSL 2 kernel that Docker Desktop needs, without installing Ubuntu — new users are never dropped into a 'Create a default Unix user account' prompt",
    ],
  },
  {
    build: 132,
    date: "2026-07-09",
    title: "Fix: first-run setup finds Python wherever it's installed",
    changes: [
      "New installs no longer fail with 'No interpreter found' — setup now checks both per-user and machine-wide Python locations, and if Python is missing entirely it downloads one automatically",
    ],
  },
  {
    build: 131,
    date: "2026-07-09",
    title: "Fix: first-run setup no longer fails on fresh machines",
    changes: [
      "New installs no longer stop with \"'uv' is not recognized\" — the first-run setup now finds uv wherever it was installed, or installs it automatically if it's missing",
      "Clearer guidance if setup still can't proceed (pointing to the installer instead of a cryptic error)",
    ],
  },
  {
    build: 130,
    date: "2026-07-08",
    title: "Your signature on every Gerry draft",
    changes: [
      "Every email Gerry drafts — from chat, the Email Drafts page, or inbox replies — now ends with the signature you picked in the signature settings (Gmail signature, custom, or none)",
      "The signature is never doubled if it's already present",
    ],
  },
  {
    build: 129,
    date: "2026-07-08",
    title: "Gerry knows who you are, and email drafts always get a real recipient",
    changes: [
      "Gerry now knows who she's assisting — your name, your account, and the Gmail address mail sends from — so drafts are signed with your real name, never a placeholder",
      "When you ask for an email to someone by name, Gerry looks up their address in your contacts automatically; if it's ambiguous or unknown she asks you instead of filing a draft that can't be sent",
      "If you're listed in the company profile's Key People, Gerry uses that entry for your role and company email",
    ],
  },
  {
    build: 128,
    date: "2026-07-08",
    title: "Hover menus on the left rail — jump to any page in one click",
    changes: [
      "Hover over a planet in the left rail and a menu smoothly glides out listing its moons — click any page to jump straight there from anywhere in the app",
      "The menu highlights the page you're currently on and works with keyboard focus too",
    ],
  },
  {
    build: 127,
    date: "2026-07-08",
    title: "Load more emails in the inbox",
    changes: [
      "A 'Load 30 more' button at the bottom of the email list fetches older conversations — keep clicking to go as far back as you need",
      "Works in every folder, in search results, and in tag-filtered views; switching folders starts back at the newest emails",
    ],
  },
  {
    build: 126,
    date: "2026-07-08",
    title: "Much snappier, more natural voice conversations",
    changes: [
      "Gerry now starts speaking as soon as her first sentence is ready, instead of waiting for the entire answer to finish — long answers no longer mean long silences",
      "Spoken replies are now short and conversational (a few sentences), and Gerry always offers to go deeper when there's more detail available",
      "Upgraded to Google's newest Chirp 3 HD voice (Kore) for more natural speech; if you've picked a specific voice in Settings it stays as-is, and the app falls back to the previous voice automatically if the new one isn't available",
      "Voice picker in Settings now lists the Chirp 3 HD voices first",
    ],
  },
  {
    build: 125,
    date: "2026-07-08",
    title: "Gmail auto-refresh and missing attachments fixed",
    changes: [
      "The inbox now refreshes itself every minute (and instantly when you return to the app) — no more manual reloading",
      "An open email thread also refreshes automatically, so new replies appear on their own",
      "Attachments from Outlook and other corporate senders now show up — they were being mistaken for inline images and hidden",
    ],
  },
  {
    build: 124,
    date: "2026-07-07",
    title: "Gerry can now add contacts to the Contacts page",
    changes: [
      "Ask Gerry to save a person — or import a whole pasted list — and the contacts land directly on the Contacts page (Communications → Contacts)",
      "Existing entries with the same email are updated rather than duplicated, and Odoo CRM contacts still go through Approvals as before",
    ],
  },
  {
    build: 123,
    date: "2026-07-07",
    title: "Fix: Gerry now actually uses the Company Profile in chat",
    changes: [
      "Asking Gerry about PMI's people, products, or partners now answers straight from the Company Profile instead of searching Gmail and the Knowledge Base",
      "The profile was syncing correctly but wasn't being loaded into the standard chat engine — only into the experimental multi-agent mode",
    ],
  },
  {
    build: 122,
    date: "2026-07-07",
    title: "Company Profile works out of the box — no setup needed",
    changes: [
      "The shared PMI company-context file is now preconfigured in every install — it loads automatically at launch with zero setup (you can still point to a different file in Settings if ever needed)",
      "The company profile size limit was raised from 4,000 to 6,000 characters",
    ],
  },
  {
    build: 121,
    date: "2026-07-06",
    title: "Little Gerry always knows your company — shared Company Profile from Google Drive",
    changes: [
      "A small company-context file (key people, products, partners, regulatory context) is now loaded into every conversation automatically — no more asking Gerry to look up who's who",
      "The profile lives in a shared Google Drive file so every teammate's copy of Little Gerry stays consistent — it syncs at launch and via Settings → Company Profile → Refresh now",
      "Settings shows the loaded profile (read-only), when it last synced, and a link to edit the file in Drive",
    ],
  },
  {
    build: 120,
    date: "2026-07-06",
    title: "Approve & send from Email Drafts, plus a clear 'sent' confirmation everywhere",
    changes: [
      "After submitting a draft for approval, the draft card now shows Approve & Send and Reject buttons — no need to go anywhere else",
      "The card tells you the outcome on the spot: sent, rejected back to editing, or why sending failed",
      "Approving a Gerry-drafted email now always shows a 'sent' confirmation toast — whether you approve from the email thread, chat, Email Drafts, the approvals drawer, or a notification",
    ],
  },
  {
    build: 119,
    date: "2026-07-06",
    title: "Approve anywhere — no more page-hopping — plus a Daily Assistant briefing on the home screen",
    changes: [
      "Gerry's drafted email replies now appear right inside the email thread — approve, edit, or reject without leaving your inbox",
      "When Gerry proposes an action during a chat, the approval appears right in the conversation",
      "New approvals drawer in the top bar (clipboard icon with a live count) — review and approve from any page",
      "Approval notifications now have Approve and Reject buttons built in, and other notifications take you straight to the right page",
      "A Daily Assistant briefing panel is docked on the home screen next to the solar system — today's schedule, unread email, tasks due, pending approvals, suggestions, and your Odoo bank balances at a glance",
      "Email threads now show the newest message at the top",
    ],
  },
  {
    build: 118,
    date: "2026-07-06",
    title: "Fix: sending email and adding email attachments to the Knowledge Base",
    changes: [
      "Sending an email now works again — a plain message (without attachments) no longer fails with 'Cannot reach the server'",
      "Adding an email attachment to the Knowledge Base now works instead of failing with 'Cannot reach the server'",
    ],
  },
  {
    build: 117,
    date: "2026-07-06",
    title: "Gmail folders & sorting, add attachments to your Knowledge Base, and clearer email text",
    changes: [
      "Browse all of Gmail's standard folders from the inbox — Inbox, Sent, Drafts, Starred, Important, Archived, Spam, Trash and All Mail",
      "Sort your mail the way you like: newest first (the default), oldest first, sender A–Z, or unread first",
      "Every email attachment now has an 'Add to Knowledge Base' button, so you can save a file for Gerry to reference in one click",
      "Emails now always display with readable text in dark mode — no more black-on-black text in replies and quoted messages",
      "When you ask Gerry to summarize or analyze a Knowledge Base document, she now reads the whole document instead of just a few excerpts",
    ],
  },
  {
    build: 116,
    date: "2026-07-06",
    title: "Fix: sending an email you wrote yourself now works",
    changes: [
      "Composing a new email and pressing Send no longer fails with 'Something went wrong'",
      "The email now sends correctly whether or not you add attachments",
    ],
  },
  {
    build: 115,
    date: "2026-07-06",
    title: "Fix: approved emails no longer get stuck showing 'pending approval'",
    changes: [
      "Approving an email now reliably sends it and marks the draft as Sent right away",
      "If an email can't be sent — most often because it has no recipient address — it's returned to your Email Drafts with a clear note, so you can add the missing detail and submit it again instead of it getting stuck",
      "Rejecting an email now returns it to Drafts (editable) rather than leaving it stuck on 'pending approval'",
      "The Approvals page now shows a clear confirmation when an email is sent, or an explanation when it couldn't be",
    ],
  },
  {
    build: 114,
    date: "2026-07-04",
    title: "Ask Gerry about anything — one click to start a chat about a task, email, file, contact and more",
    changes: [
      "New 'Ask Gerry' button on your tasks, projects, contacts, emails, email drafts, calendar events, Knowledge Base documents, generated files and email attachments",
      "Click it and Gerry opens a fresh chat already primed with that item's details, so you can dive straight into questions",
      "For files — email attachments and generated files — Gerry reads the actual contents so you can ask about what's inside",
      "Every 'Ask Gerry' chat starts in the Little Gerry side panel and becomes its own conversation you can return to",
    ],
  },
  {
    build: 113,
    date: "2026-07-04",
    title: "Reply all, edit Gerry's drafts before sending, and jump straight to Approvals",
    changes: [
      "New 'Reply all' button on an email thread — it replies to the sender and everyone else on the message (Cc included), leaving you off the list",
      "You can now add or edit the Cc line on any reply",
      "Edit Gerry's drafted emails before they go out: on the Approvals page, click 'Edit' to tweak the To, Cc, subject or wording, then approve to send your edited version",
      "After you ask Gerry to draft a reply, a 'Go to Approvals' button appears so you can review it in one click",
    ],
  },
  {
    build: 112,
    date: "2026-07-02",
    title: "Open email attachments straight in Google Docs, Sheets and Slides",
    changes: [
      "Attachments now open in Google Workspace: click a Word, Excel or PowerPoint attachment and Gerry opens it in Google Docs, Sheets or Slides — no download needed",
      "Other files (PDFs, and anything Google can't convert) open in the Google Drive viewer instead",
      "Prefer the old behaviour? Each attachment still has an 'open with your default app' button and a Download button",
    ],
  },
  {
    build: 111,
    date: "2026-07-02",
    title: "Pick which emails Gerry drafts, move mail to Trash, and filter your inbox by tag",
    changes: [
      "'Draft today's unread' is now 'Draft selected' — tick the emails you want (from any list: Inbox, Unread, Today or a tag) and Gerry drafts a reply for each one, all waiting in Approvals for your review",
      "Move an email to Trash right from the inbox (hover an email and click the bin) — it's recoverable from Gmail for 30 days",
      "Filter your inbox by any tag you've saved: pick a tag to see every email from the people and companies you've filed under it",
      "Deleting emails needs one extra Google permission — reconnect your Google account once (Google Workspace → reconnect) to enable it",
    ],
  },
  {
    build: 110,
    date: "2026-06-30",
    title: "The 'What's New' window now shows after this update too",
    changes: [
      "Fixed the 'What's New' window not appearing after updating: it now shows whenever there's something you haven't seen — including right after an update that reset the app's local storage — instead of staying quiet",
    ],
  },
  {
    build: 109,
    date: "2026-06-30",
    title: "'What's New' and the feature guide now show reliably, and Discard truly stops a stuck recording",
    changes: [
      "The 'What's New' window now appears reliably after an update — what you've already seen is remembered on the server, so it no longer gets forgotten each time the app updates itself",
      "The 'What Gerry can do' guide is remembered the same way, so it pops up once per section after an update instead of never (or every time)",
      "Discarding a stuck recording now actually stops it — Little Gerry cancels any transcription that was still running in the background, so the header no longer shows 'Transcribing…' after you delete it",
    ],
  },
  {
    build: 108,
    date: "2026-06-30",
    title: "Discard stuck recording recoveries, and a more reliable 'What Gerry can do' guide",
    changes: [
      "If a recording keeps trying (and failing) to recover every time you open Little Gerry, there's now a Discard button next to 'Recover recordings' to delete it for good and stop the retries",
      "The 'What Gerry can do' guide now reliably pops up once per section after an update — it politely waits for the 'What's New' window to close first, instead of being skipped",
    ],
  },
  {
    build: 107,
    date: "2026-06-30",
    title: "Compose new email, a tidier Gmail, and a built-in guide to what Gerry can do",
    changes: [
      "The Inbox is now called Gmail, with Inbox and Drafts as tabs in one place — and a new Compose button to start a fresh email",
      "Write and send a new email yourself with To, Cc/Bcc, a subject, your signature and file attachments — or switch to 'Ask Gerry', give a recipient and a few key points, and Gerry drafts the whole email for you (it waits in Approvals for your review, never sent automatically)",
      "'Draft today's unread' now skips automated senders — no-reply addresses, notifications, and Gemini, Teams, Slack or calendar notices — so Gerry only prepares replies to real people",
      "Email attachments now download and open reliably from the desktop app",
      "Fixed 'No Gmail signature found' happening for some accounts",
      "New 'What Gerry can do' guide — a short snapshot of each area pops up once after an update, and you can reopen it any time from the help button in the top bar",
    ],
  },
  {
    build: 106,
    date: "2026-06-30",
    title: "Your email, with Little Gerry: read, draft, tag, contacts — plus tamper-evident conversation backups",
    changes: [
      "Read your Gmail inbox right inside Little Gerry — a new Inbox under Communications shows your threads with full message history, images and attachments, and quick filters for Unread and Today",
      "Turn any email thread into knowledge — pick a thread and add it (and its attachments) to a dedicated Email knowledge category, kept separate from your regulated documents",
      "Reply and compose from the reading pane — emails you write yourself send straight away, while anything Little Gerry drafts always goes to Approvals for your review first, never sent automatically",
      "Let Gerry Draft a reply with one click, and 'Draft today's unread' to have Gerry prepare a response to every unread email from today — each one waits in Approvals for you to send, edit or delete individually",
      "Unreviewed Gerry drafts tidy themselves up the next day, and you can set your email signature (use your Gmail signature, write a custom one, or none)",
      "Smart tags that learn — confirm tags on a sender or company once and Little Gerry remembers them, automatically labelling future mail from that contact or domain when you open your inbox",
      "A Contacts book that builds itself — contacts are gathered from the people you email, you can add or edit them by hand, recipient fields autofill as you type, and you can ask Gerry 'who's our contact at <company>?'",
      "Tamper-evident conversation backups — a new Conversation Backups page under Administration saves signed, append-only snapshots of your chats both on your computer and to your Google Drive, with a one-click integrity check and download",
    ],
  },
  {
    build: 105,
    date: "2026-06-30",
    title: "Importing a big knowledge-base manifest now works reliably",
    changes: [
      "Fixed importing a large shared knowledge-base manifest (hundreds of documents) failing partway with a misleading 'Cannot reach the server' message — it was actually just taking longer than the app's time limit while pulling every file from Drive",
      "Imports now run in small batches with a live 'Importing 40/300' progress count, so you can watch it work and large libraries come in without timing out",
      "If a batch does hit a snag, everything imported so far is kept and the message tells you how many made it in, so you can simply run it again to finish — duplicates are skipped automatically",
    ],
  },
  {
    build: 104,
    date: "2026-06-26",
    title: "Resize the chat box to fit what you're writing",
    changes: [
      "Both the main chat box and the persistent Little Gerry side panel now grow as you type, so longer messages are easier to read and edit instead of being squeezed into one line",
      "You can also grab the small handle at the top of either chat box and drag it up or down to set it to exactly the height you want — your choice is remembered",
      "Double-click that handle any time to snap the box back to growing automatically with your text",
    ],
  },
  {
    build: 103,
    date: "2026-06-24",
    title: "Never lose a recording, quicker navigation, and tidier email drafts",
    changes: [
      "If Little Gerry is closed or restarts while it's still transcribing a recording, the audio is now saved safely to disk first — when you reopen the app it automatically finishes any interrupted transcription, and a 'Recover recordings' button appears so you can pick up exactly where you left off",
      "The left sidebar now lists every area — Work, Knowledge, Communications, Odoo, Compliance and Administration — as quick-access icons under the home button, so you can jump straight to any section from anywhere",
      "Added a speed slider to the solar-system view so you can dial the orbiting planets faster or slower to your taste, and your choice is remembered",
      "When you ask Little Gerry to draft an email it now files it under Communications → Email Drafts for you to review, edit and send, instead of mixing it in with approvals",
      "Email approval requests now show a clean To / Subject / Body preview with proper paragraph spacing, instead of a single run-on line of raw text",
    ],
  },
  {
    build: 102,
    date: "2026-06-24",
    title: "Start and stop recording whenever you like",
    changes: [
      "You can now record any conversation on demand — click the new 'Record' button in the top bar to start capturing right away, even for in-person meetings or calls that Little Gerry can't detect automatically",
      "Click 'Stop recording' when you're done and Little Gerry transcribes the audio and writes up a summary with decisions and action items, just like an auto-captured meeting",
      "The Stop button works for any active recording, whether you started it yourself or it began automatically when a meeting was detected",
    ],
  },
  {
    build: 101,
    date: "2026-06-24",
    title: "Automatic meeting capture, and a What's New popup",
    changes: [
      "Little Gerry can now notice when you join a Zoom, Microsoft Teams, Google Meet or Webex meeting — turn on capture from the new status pill in the top bar and it records the call, transcribes it, and writes up a summary with decisions and action items automatically, no upload needed",
      "When a meeting is detected, a gentle popup offers to start capturing, and you can toggle capture on or off any time from the top bar",
      "Each meeting now has an 'Add to KB' button so you can file its notes into the knowledge base in one click",
      "If a computer doesn't have the transcription key yet, uploading a recording now offers a one-click 'Download credentials' popup that fetches it from the company's shared Drive — no files to move",
      "After every update you'll see a short 'What's New' popup summarising the changes, so you always know what just improved",
    ],
  },
  {
    build: 100,
    date: "2026-06-24",
    title: "Transcribe meeting recordings, and preview generated documents",
    changes: [
      "You can now upload a meeting recording on the Meetings page and have it automatically transcribed — even long recordings over an hour — so you can turn a conversation into notes, decisions and action items without typing it up",
      "The Generate Document wizard now lets you open and preview the finished document right from the final step, instead of hunting for the file afterwards",
      "Added a Preview button to the Generated Files page so you can read any document Little Gerry created without downloading it first",
    ],
  },
  {
    build: 99,
    date: "2026-06-22",
    title: "No more repeated daily-assistant notifications",
    changes: [
      "Fixed the daily assistant sending you the same suggestion over and over — follow-ups are now tracked per email conversation instead of per message, so a busy thread no longer turns into a pile of duplicate reminders",
      "Suggested tasks are now remembered by what they refer to rather than their wording, so once you dismiss one it stays dismissed instead of coming back slightly reworded after each scan",
      "Added a smart duplicate check that recognises when two suggestions are essentially the same thing phrased differently and quietly skips the repeat",
    ],
  },
  {
    build: 98,
    date: "2026-06-19",
    title: "Bank balances now load on more Odoo versions",
    changes: [
      "Fixed the Odoo Bank Balance card failing with an 'account.move.line.read_group does not exist' error on newer Odoo versions — it now falls back to summing the posted account lines directly, so balances load regardless of your Odoo version",
    ],
  },
  {
    build: 97,
    date: "2026-06-19",
    title: "Bank balances on the Odoo page, and a safer way to delete knowledge base documents",
    changes: [
      "The Odoo page now shows your live bank and cash balances pulled straight from Odoo — a total available figure plus a per-account breakdown, with a Refresh button",
      "Little Gerry can now delete a knowledge base document for you, but only after you give final approval in a confirmation popup — nothing is removed until you click Delete",
      "This works in both text chat and the voice assistant, and the agent never deletes anything on its own",
    ],
  },
  {
    build: 96,
    date: "2026-06-18",
    title: "Regulatory document generation now pulls in your company data",
    changes: [
      "Fixed the Generate Document wizard and AI Draft so they search the knowledge base with the same embedding provider your documents were ingested with — previously, if you used OpenAI or Voyage embeddings, the search found nothing and every detail came out as a [FILL IN: …] placeholder",
      "Generated regulatory documents now auto-populate PMI and VACTOR specifics from the knowledge base as intended",
    ],
  },
  {
    build: 95,
    date: "2026-06-18",
    title: "Odoo connect no longer kicks you to the login screen",
    changes: [
      "Fixed a bug where a failed Odoo connection (wrong database, email, or API key) would bounce you back to the Google sign-in screen instead of showing the error",
      "The Odoo page now displays the actual reason a connection failed so you can correct it",
      "Fixed token refresh so an expired session is renewed automatically instead of signing you out",
    ],
  },
  {
    build: 94,
    date: "2026-06-18",
    title: "Smoother install on fresh Windows PCs",
    changes: [
      "The installer now checks for the Microsoft Visual C++ runtime and installs it automatically when missing — fixing a first-run error on brand-new Windows machines",
      "Each prerequisite is detected first and only installed if it isn't already on the machine, so nothing already present gets reinstalled",
    ],
  },
  {
    build: 93,
    date: "2026-06-17",
    title: "New mini-game — Precisian Sweeper",
    changes: [
      "Added a second arcade game to the solar system: click the hazard beacon orbiting Little Gerry to play Precisian Sweeper, a space-themed Minesweeper",
      "Sweep the minefield around Little Gerry across three difficulties — Inner System, Asteroid Belt, and Deep Space — with your best time saved for each",
      "Left-click to scan a sector, right-click or long-press to plant a warning beacon, and Esc or End Game to exit",
    ],
  },
  {
    build: 92,
    date: "2026-06-17",
    title: "Take action in Odoo — with your approval",
    changes: [
      "Little Gerry can now make changes in Odoo, but never on its own: every write becomes a pending approval you review and approve first",
      "Supported actions: confirm a quotation, register an invoice payment, create a CRM lead, log an internal note, update a record's fields, and create a contact",
      "Added quick action buttons in the Odoo browser — confirm a quotation or register a payment straight from the table",
      "The Daily Assistant can now offer a one-click ‘Confirm quotation’ or ‘Register payment’ on its Odoo alerts, and Gerry can propose Odoo changes in chat — all routed through the approval queue",
    ],
  },
  {
    build: 91,
    date: "2026-06-17",
    title: "Odoo gets smart — alerts in your Daily Assistant & searchable records",
    changes: [
      "The Daily Assistant now watches your Odoo ERP and recommends tasks for overdue customer invoices, aging quotations, overdue vendor bills, and low product stock",
      "Added \u201cImport to Knowledge Base\u201d buttons in the Odoo browser \u2014 import all visible records or a single row so Little Gerry can search and answer questions about them",
    ],
  },
  {
    build: 90,
    date: "2026-06-17",
    title: "New Odoo planet — read your ERP data",
    changes: [
      "Added a new Odoo planet to the solar system. Connect your Odoo ERP with an API key and browse live customers, sales orders, invoices, products & inventory, CRM leads, purchase orders, manufacturing orders, and employees right inside Little Gerry",
      "The company, database, and your login are filled in automatically — you just paste an API key from your Odoo profile",
    ],
  },
  {
    build: 89,
    date: "2026-06-17",
    title: "Daily Assistant stops nagging about things you've handled",
    changes: [
      "The Daily Assistant no longer re-recommends an item once you've already turned it into a task, note, or follow-up",
      "If you dismiss a suggestion twice it won't come back — but a single dismissal now resurfaces it once, so an accidental dismissal won't silently lose a recommendation",
      "Dismissing now asks you to confirm, and an Undo button appears for a few seconds afterward in case you change your mind",
    ],
  },
  {
    build: 88,
    date: "2026-06-17",
    title: "Idle scenes are now actually random",
    changes: [
      "The idle solar-system animation was almost always showing the same one or two scenarios. It was accidentally limited whenever Windows 'Animation effects' were turned off — now all six scenarios are equally likely, and the same one never plays twice in a row",
    ],
  },
  {
    build: 87,
    date: "2026-06-17",
    title: "The solar system comes alive when you step away",
    changes: [
      "After 30 seconds of inactivity on the home view, tiny space dots drift in from off-screen and play out one of six random scenarios around Little Gerry's solar system — colonizing the worlds, building a Dyson sphere, waging a perpetual war, migrating past on a gravity slingshot, terraforming the planets, or weaving glowing trade routes",
      "The moment you move the mouse, click, scroll, or type, everything is swept outward away from Little Gerry and the system returns to normal",
    ],
  },
  {
    build: 86,
    date: "2026-06-17",
    title: "Fix: exiting could stall on Mac (had to force quit)",
    changes: [
      "On macOS, quitting Little Gerry could hang with the window gone but the app still running, forcing a Force Quit. Shutdown is now bounded with timeouts and a safety net that always closes the app, so exiting is quick and clean",
    ],
  },
  {
    build: 85,
    date: "2026-06-17",
    title: "Fix: stop creating empty 'untitled' conversations",
    changes: [
      "Opening the Little Gerry side panel could quietly create one or more blank 'untitled conversation' entries you never started, cluttering your history. That no longer happens — the panel now reuses your most recent conversation and only ever creates a new one when you genuinely have none",
    ],
  },
  {
    build: 84,
    date: "2026-06-17",
    title: "Attach reference files to a conversation",
    changes: [
      "You can now attach files to a chat using the new 'Attach file' button just above the message box. Little Gerry reads those files and uses them as reference while you talk in that conversation — handy for documents you're editing or want answers about without adding them to the Knowledge Base",
      "Attached files stay with that one conversation, are stored encrypted on this computer, and can be removed any time by clicking the × on the file. Supported types: PDF, Word (.docx), plain text, Markdown, and CSV",
    ],
  },
  {
    build: 83,
    date: "2026-06-16",
    title: "External links now open in your real browser",
    changes: [
      "Clicking a link to an outside website (for example a source link in a chat answer) used to load that page inside the Little Gerry window, which has no back, forward, refresh, or address bar — leaving you stuck. Those links now open in your normal web browser instead, so the app window always stays on Little Gerry. Links inside the app and file downloads are unaffected",
    ],
  },
  {
    build: 82,
    date: "2026-06-15",
    title: "Download company Google credentials from the sign-in screen",
    changes: [
      "If this computer doesn't have the company google_credentials.json yet, the sign-in screen now shows a 'Download credentials' button. One click fetches the file from the company's shared link and places it in the right folder automatically, then enables sign-in — no manual file copying needed",
      "If no shared link is configured, the sign-in screen shows the exact folder to drop the file into for both Windows and macOS",
    ],
  },
  {
    build: 81,
    date: "2026-06-15",
    title: "Fix: Export manifest now actually saves the files",
    changes: [
      "Share KB → Export manifest reported success but no files appeared, because the desktop app window can't perform a normal browser download. Little Gerry now writes littlegerry-kb.json and littlegerry-kb.md straight to your Downloads folder, and the confirmation tells you exactly where they were saved",
    ],
  },
  {
    build: 80,
    date: "2026-06-15",
    title: "Fix: macOS app closed instantly instead of starting up",
    changes: [
      "On a Mac, double-clicking Little Gerry after installing the .pkg quit immediately with no setup window. It now opens a Terminal and runs the first-run setup in full view — installing its prerequisites (Homebrew, Docker Desktop, Node, uv), starting the database, applying migrations, and installing dependencies — just like the Windows installer flow",
      "If first-run setup hits a problem, the Terminal window now stays open with the error and a pointer to the logs instead of vanishing, so it's clear what to fix",
    ],
  },
  {
    build: 79,
    date: "2026-06-15",
    title: "Share your Knowledge Base with teammates",
    changes: [
      "New \"Share KB\" button on the Knowledge Base page bundles your library into a portable manifest. Export it and Little Gerry saves two files — a one-click littlegerry-kb.json and a readable littlegerry-kb.md table with a Google Drive link for every document — so a teammate who has access to the same Drive files can rebuild your whole Knowledge Base in seconds",
      "\"Import manifest\" rebuilds a shared Knowledge Base straight from Drive: pick the littlegerry-kb.json file and Little Gerry re-imports every document, skipping any identical files you already have. Because each document stays linked to its Drive source, \"Check for updates\" keeps working on the imported library too",
      "\"Link uploads to Drive\" matches documents you uploaded from your computer to the same file on your Drive, so previously-uploaded files become update-trackable and shareable in a manifest",
    ],
  },
  {
    build: 78,
    date: "2026-06-15",
    title: "No more duplicate documents in the Knowledge Base",
    changes: [
      "Little Gerry now catches duplicate files before they pile up: if you upload or import a document that's identical to one already in the Knowledge Base, she pauses and shows which existing document it matches so you can Skip it or Import anyway",
      "New \"Find duplicates\" button on the Knowledge Base page scans everything you've already stored, groups identical files together, marks the original to keep, and lets you delete the extra copies in one click",
    ],
  },
  {
    build: 77,
    date: "2026-06-14",
    title: "Precisian Defender — protect Little Gerry!",
    changes: [
      "New hidden arcade game: click the little asteroid orbiting the solar-system page to launch \"Precisian Defender\". Your spaceship cursor is the defender — click or hold to fire, blast incoming asteroids and the information-stealing UFOs, and keep Little Gerry's integrity above zero. Press Esc or End Game to leave. Your high score is saved",
      "Weapon power-ups drop from destroyed enemies — grab Full Auto for rapid fire, Spread for a wide fan of shots, or Seekers for homing missiles that chase down threats. Each lasts a few seconds and shows a countdown",
    ],
  },
  {
    build: 76,
    date: "2026-06-14",
    title: "Gerry never reports work he didn't actually do",
    changes: [
      "Gerry will no longer say a file, document, or upload is done unless it really happened — he now double-checks that each file was actually saved (and that uploads truly landed in Google Drive) before telling you it's finished, and he reports an honest failure if something didn't work",
      "Gerry no longer makes up details like file links, email addresses, or phone numbers; when something isn't in his sources he now says so instead of guessing",
    ],
  },
  {
    build: 75,
    date: "2026-06-13",
    title: "Long conversations no longer break",
    changes: [
      "Fixed an error that could stop Gerry from replying in long conversations (\"the conversation must end with a user message\"); he now always uses your most recent messages instead of the oldest ones, so replies keep working and stay on-topic no matter how long the chat gets",
    ],
  },
  {
    build: 74,
    date: "2026-06-13",
    title: "Setup wizard fits the screen, shuttle cursor works on Windows",
    changes: [
      "The setup wizard no longer grows past the window on taller steps — the content scrolls and the Back/Next buttons always stay visible",
      "The spaceship mouse cursor now appears on Windows 11 even when system animation effects are turned off; the engine trail is the only part skipped when reduced motion is on",
    ],
  },
  {
    build: 73,
    date: "2026-06-12",
    title: "The window remembers where you left it",
    changes: [
      "Little Gerry now reopens at the same size and position it had when you closed it; if the saved spot is on a monitor that's no longer connected, it falls back to a centered window",
    ],
  },
  {
    build: 72,
    date: "2026-06-12",
    title: "Voice Gerry acknowledges, answers briefly, checks the knowledge base first",
    changes: [
      "After you speak, Gerry immediately says a short acknowledgment (\"Okay, I'm on it\", \"Let me check\") while he works — no more silent waiting; if the answer is ready before the acknowledgment finishes, it plays right after",
      "Spoken answers are now short and to the point — \"Based on my research in X, …\" / \"After looking through X, I found …\" / \"… I couldn't find anything because …\" — no process recaps, one to three sentences unless you ask for detail",
      "Research and document generation now always start with the PMI knowledge base; Drive, email, the web, and specialists come after",
    ],
  },
  {
    build: 71,
    date: "2026-06-12",
    title: "Tool calls fixed at the root, file actions, living orbits",
    changes: [
      "Found and fixed the true root cause of every \"Gerry's tools come back empty\" loop — the framework silently advertised a broken parameter schema to the model, so structured arguments could never arrive; searches, reads, and delegation now receive their arguments correctly",
      "Generated Files: each file now has Knowledge and Drive buttons — move a file into the Knowledge Base (ingested and searchable, then removed from the list) or upload it straight to Google Drive with an Open-in-Drive link",
      "The main solar system now shows each planet's moons orbiting it — icons only, with the name appearing over a moon when you hover; moons are clickable shortcuts",
      "In the space views the mouse is now a NASA-style shuttle that turns nose-first into your direction of travel and leaves a brief engine trail (disabled when reduced motion is on)",
    ],
  },
  {
    build: 70,
    date: "2026-06-12",
    title: "Search tools accept plain-text arguments",
    changes: [
      "Fixed the \"empty query\" loop — when Gerry sent a search or read request as plain text instead of structured fields, the tools rejected it even though the text was right there; plain text now maps onto each tool's main parameter (search query, page URL, file ID, …)",
      "Tool failures are now written to the log with their argument shapes, so glitches like this can be diagnosed instead of being invisible",
    ],
  },
  {
    build: 69,
    date: "2026-06-12",
    title: "Delegation works again, morning scan fixed",
    changes: [
      "Fixed Gerry repeatedly failing to hand work to specialists (\"the delegation tool is stripping the agent field\") — tool arguments sent in slightly different shapes were being dropped before they reached the tools; all shapes are now accepted",
      "When a delegation call is malformed, the error now shows the correct format so Gerry fixes it on the next try instead of looping",
      "Fixed the daily assistant scan, which had been silently crashing every morning — reminders and suggestions from the 7:00 AM scan will run again",
    ],
  },
  {
    build: 68,
    date: "2026-06-12",
    title: "macOS groundwork",
    changes: [
      "Keyboard shortcuts now respect your platform — Cmd+K and Cmd+/ work on a Mac, and the labels show ⌘ instead of Ctrl there (Windows is unchanged)",
      "The Postgres database image is pinned to an exact multi-platform version so Windows and Apple Silicon Macs run the identical database",
      "macOS build scripts gained the microphone permission text required for voice sessions, and the install script now uses the same Python version as Windows",
    ],
  },
  {
    build: 67,
    date: "2026-06-11",
    title: "Voice Gerry sees your Google connection",
    changes: [
      "Fixed voice sessions claiming Google Drive was not connected even when Settings showed it connected — the voice agents were checking a credentials table that is never written; they now use the same token check as the Drive tools and Settings",
    ],
  },
  {
    build: 66,
    date: "2026-06-11",
    title: "HAL-9000 Little Gerry",
    changes: [
      "Clicking the Sun now zooms into a large HAL-9000-style red eye — click the eye to start or stop a voice session; it breathes while listening and pulses while Gerry speaks",
      "A small Type button inside the red opens the classic text chat as the secondary option",
      "On the solar-system overview, the Sun's name stays hidden until you hover over it, and its glow is three times stronger",
    ],
  },
  {
    build: 65,
    date: "2026-06-11",
    title: "The planets actually orbit now",
    changes: [
      "Fixed orbits being completely frozen — the animation was silently disabled whenever Windows has 'Animation effects' turned off; planets and moons now always drift on their orbits",
      "Zoom in/out transitions still soften to fades when your system prefers reduced motion",
    ],
  },
  {
    build: 64,
    date: "2026-06-11",
    title: "Visible orbits and a reachable service menu",
    changes: [
      "Planets now sweep around Little Gerry at one revolution per minute — like the second hand of a clock — so the motion is actually perceptible",
      "The service controls menu (Restart, Update, Stop) moved from the bottom-left rail — where its dropdown was cut off by the window edge — to the top bar next to Search",
    ],
  },
  {
    build: 63,
    date: "2026-06-11",
    title: "Gerry can see your Drive's top-level folders",
    changes: [
      "New list_shared_drives tool — Little Gerry and the specialists can now list your shared (team) drives, the top-level trees like Communications, Knowledge and Compliance that sit beside My Drive",
      "list_drive_folder can now browse inside a shared drive's root (new drive_id option)",
      "Fixed a bug where browsing a Drive folder silently passed the result limit as the drive ID",
    ],
  },
  {
    build: 62,
    date: "2026-06-11",
    title: "Galaxy polish — cleaner planets, hover previews, red Gerry",
    changes: [
      "Planets are now black in light mode and white in dark mode, with their category color on the icon",
      "Planet names no longer float on the canvas — hover over a planet to see its name and a preview of its moons",
      "Little Gerry is now always red",
      "Orbits moved outward so Dashboard and the Daily Assistant no longer crowd the Sun",
      "All planets sweep around Little Gerry at one slow, uniform pace — like the minute hand of a clock",
    ],
  },
  {
    build: 61,
    date: "2026-06-11",
    title: "Solar-system navigation — the sidebar becomes a galaxy",
    changes: [
      "The left menu is now a solar system: Little Gerry is the Sun (click to chat or talk), Dashboard and the Daily Assistant orbit close-in, and the five categories — Work, Knowledge, Communications, Compliance, Administration — are planets whose moons are the feature pages",
      "Click a planet to zoom in, click a moon to open the page; notification and approval counts appear on the relevant moons and roll up onto their planets",
      "A narrow rail on the left shows where you are (Sun → planet → page) as back buttons, and Esc zooms out one level; the Service menu and build badge moved to the bottom of this rail",
      "Your position is part of the URL and is restored after a restart; all existing links, the command palette and voice navigation keep working unchanged (Dashboard now lives at /dashboard)",
      "New Agents page under Administration: a live, read-only directory of the multi-agent system — the supervisor, the House Manager, the seven specialists and the core chat agent, each with its tools and where you meet it",
      "Orbits pause and zooms become gentle fades if your system prefers reduced motion",
    ],
  },
  {
    build: 60,
    date: "2026-06-11",
    title: "Little Gerry House Manager — voice sessions get an app-wide custodian",
    changes: [
      "Voice sessions now talk to the House Manager, a custodian agent that oversees the whole app: it can list, read, rename, pin, archive and delete conversations, manage generated files, tasks, schedules and knowledge base documents, and report on settings, users, the audit trail and approvals (those four are strictly read-only)",
      "The House Manager can delegate work to any specialist agent (research, regulatory, QMS, IR, engineering, operations, executive assistant) and report back — up to five delegations per turn",
      "Destructive actions (deleting anything, disabling schedules) and Google Drive uploads always require your spoken confirmation first",
      "The voice panel now shows what Gerry is doing while thinking (\"Asking a specialist…\", \"Searching the web…\")",
    ],
  },
  {
    build: 59,
    date: "2026-06-11",
    title: "Voice button promoted to the top bar",
    changes: [
      "The \"Talk with Little Gerry\" button moved from the bottom corner to the center of the top bar — always visible on every page, with a faint pulsing glow and shimmer",
      "While a session is running the button turns into \"End voice session\"; the live status panel still appears bottom-right",
    ],
  },
  {
    build: 58,
    date: "2026-06-10",
    title: "Gerry no longer reads emojis aloud",
    changes: [
      "Emojis and symbols (\u2705 \u26a0\ufe0f \ud83d\ude80 \u2192 \u2026) are now stripped from spoken replies, so Gerry won't say things like 'rocket' or 'warning sign' mid-sentence \u2014 they still appear in the on-screen text",
    ],
  },
  {
    build: 57,
    date: "2026-06-10",
    title: "Talk with Little Gerry from anywhere",
    changes: [
      "New floating \"Talk with Little Gerry\" button in the bottom-right corner of every page — ask Gerry to create a file, look something up, or anything else without leaving what you're doing",
      "Each session starts a fresh conversation that appears in your chat history, with a \"View conversation\" shortcut on the voice panel",
      "Same hands-free loop as Voice chat: speak, pause, Gerry answers aloud and listens again — with Interrupt and Esc to end",
    ],
  },
  {
    build: 56,
    date: "2026-06-10",
    title: "Long generated files no longer cut off",
    changes: [
      "Fixed long documents and reports being truncated mid-sentence: the AI's response limit was capped at roughly 3,000 words per file — it's now 8\u00d7 larger, so lengthy reports, plans, and Word documents generate in full",
    ],
  },
  {
    build: 55,
    date: "2026-06-10",
    title: "Voice conversations — talk with Little Gerry hands-free",
    changes: [
      "New Voice chat button in Chat: speak naturally, pause, and Gerry answers out loud — then listens for your reply automatically, no clicking between turns",
      "A live status banner shows what's happening (listening / got it / thinking / speaking), with an Interrupt button to cut Gerry off mid-sentence and Esc to exit",
      "Requires the Google Cloud voice key (same one that powers the mic button)",
    ],
  },
  {
    build: 54,
    date: "2026-06-10",
    title: "Research search fixed, updates keep dependencies in sync",
    changes: [
      "Fixed Research returning zero results: the old DuckDuckGo search package stopped working and the replacement was missing from installed apps — search now uses the working package only and reports clearly if it's unavailable",
      "App updates now refresh behind-the-scenes dependencies on every launch, so future releases that add new components can't silently break features",
    ],
  },
  {
    build: 53,
    date: "2026-06-10",
    title: "Run now actually runs — scheduled tasks fixed",
    changes: [
      "Fixed Run Now on Scheduled Tasks silently doing nothing: long runs were cut off after 2 minutes by the browser's request timeout, so no report was produced and no failure was recorded",
      "Run Now starts the task in the background and returns immediately — the task card shows a live ⟳ running… status and updates with the result when it finishes",
      "A task can't be started twice at once, and runs interrupted by an app restart are now marked failed instead of appearing stuck",
    ],
  },
  {
    build: 52,
    date: "2026-06-10",
    title: "Choose where downloads go + full knowledge base listing",
    changes: [
      "Downloading a regulatory or generated file now asks where it should go: pick an exact folder on your computer (native Save-As dialog) or upload straight to Google Drive",
      "The Google Drive option lets you browse My Drive and shared drives, pick the destination folder, and shows exactly where the file landed with an Open in Drive link",
      "Fixed the Knowledge Base only showing the first 25 documents — all imported documents now appear and the Total documents stat is accurate (your other documents were always stored and searchable; only the list was cut off)",
    ],
  },
  {
    build: 51,
    date: "2026-06-10",
    title: "Calendar on the Dashboard, smarter setup wizard",
    changes: [
      "Dashboard now scans your Google Calendar: today's events appear in Today's Agenda and a new Upcoming Events card shows the next 7 days (only when Google is connected)",
      "Setup wizard gains a Voice step explaining the Google Cloud API key — including that PMI's company cloud project may already have one — with in-wizard key entry",
      "Setup wizard's “Using it” tour refreshed to cover voice chat, the Generate Document wizard, per-task models, and the Dashboard",
      "Fixed Models per Task wrongly showing “provider key not configured” when a recommended model exists under a dated name (e.g. claude-haiku-4-5-20251001)",
    ],
  },
  {
    build: 50,
    date: "2026-06-10",
    title: "Talk to Little Gerry — voice input and spoken replies",
    changes: [
      "New microphone button in chat: click, speak, click again — your words appear in the message box as editable text before you send",
      "Optional “Speak replies aloud”: Little Gerry reads chat answers out loud in a natural Google Neural2/Studio voice, selectable in Settings → Voice",
      "Powered by Google Cloud Speech — audio is processed by your own Google Cloud project (where your Workspace data already lives) and never stored",
      "Voice features appear only when a Google Cloud API key is saved in Settings → Voice (stored in the OS keychain, like all other keys)",
    ],
  },
  {
    build: 49,
    date: "2026-06-10",
    title: "Generate FDA & ISO documents from templates",
    changes: [
      "New “Generate Document” wizard on the Regulatory Files page: create 510(k) outlines, Design Control plans, CAPA and Complaint Handling SOPs, DHF indexes, ISO 13485 Quality Manuals, ISO 14971 Risk Management Plans & Reports, generic SOPs, and EU Declarations of Conformity",
      "The wizard asks what you want to create, researches and recommends the best-practice section structure and output format (Word .docx or in-app-editable Markdown), and lets you adjust both before generating",
      "Optional auto-populate fills in PMI and VACTOR specifics from the company profile and knowledge base — anything unknown is left as an explicit [FILL IN: …] placeholder, never invented",
      "Generated files land directly in the Regulatory file store as editable documents and are labelled “Generated” in the Source column",
      "After generating, Little Gerry recommends a one-click high-priority review task (due in one week) so AI-drafted content always gets a human review",
    ],
  },
  {
    build: 48,
    date: "2026-06-10",
    title: "Pick a model per task + live model catalog + tidier Settings",
    changes: [
      "New “Models per Task” in Settings: choose a different AI model for each kind of work — Chat & Agent, Daily Assistant, Briefings, Email Drafting, Meetings, Regulatory, and Research — each with a ★ recommended pick and a one-line reason",
      "Every category defaults to your global model; overrides are always your explicit choice and Little Gerry never switches models on its own",
      "Model lists are now discovered live from each provider and only show providers with an active API key (no OpenAI models offered if no OpenAI key is set); newly released models are flagged · NEW",
      "The model catalog rescans automatically every week, immediately after you add a new API key, and on demand via the “Refresh model list” button",
      "Settings page sections are now collapsible menus (like the sidebar) and start condensed, so the page is much easier to scan",
    ],
  },
  {
    build: 47,
    date: "2026-06-10",
    title: "Research search fixed + selective Drive sync for Regulatory files",
    changes: [
      "Fixed Research returning zero results every time — web search now uses the maintained search engine and reliably returns sources for your AI-synthesised reports",
      "New on the Regulatory Files page: a “Check for updates” button that detects when a Drive-linked file has been changed, renamed, or deleted at the source",
      "Because Regulatory is a controlled store, changes are never applied automatically — you review the flagged files and choose exactly which ones to re-import (or dismiss), one by one",
      "Changed files are now badged in the file list (“Update available”, “Renamed in source”, “Source deleted”) so it's clear at a glance what needs attention",
    ],
  },
  {
    build: 46,
    date: "2026-06-10",
    title: "Scheduled tasks, reliable answers when you switch away, and a Drive import fix",
    changes: [
      "New Scheduled Tasks page: set Little Gerry to run a prompt on a repeating schedule — for example, “create a report every Thursday morning about the previous week” — and it runs automatically in the background and notifies you when it's done",
      "Your chat answer is no longer lost if you navigate away mid-reply: Little Gerry now keeps working server-side and saves the answer, so it's waiting for you when you come back",
      "The Little Gerry sidebar chat can now create Word documents and upload to Google Drive, just like the full chat — generated files land on the Generated Files page",
      "Fixed “Import from Drive” showing an empty folder in the Knowledge Base when browsing Google Drive folders",
    ],
  },
  {
    build: 45,
    date: "2026-06-10",
    title: "Create Word documents and upload them to Google Drive",
    changes: [
      "Little Gerry can now create Microsoft Word (.docx) documents on request — reports, memos, weekly updates, meeting notes — and they appear on the Generated Files page ready to download",
      "New: ask Little Gerry to upload a generated file to your Google Drive and it returns a shareable link (reconnect Google in Settings to grant upload access)",
      "Complex multi-step requests (search → gather many items → build a document → upload) no longer stop early with “maximum tool call rounds” — the limit was raised and the assistant now always writes its final answer instead of erroring",
    ],
  },
  {
    build: 44,
    date: "2026-06-09",
    title: "Fixed chat errors on the newest Claude models",
    changes: [
      "Fixed “LLM error… `temperature` is deprecated for this model” when chatting after switching to one of the newest Claude models",
      "Little Gerry now automatically adapts to models that no longer accept the temperature setting, so chat works across every available model",
    ],
  },
  {
    build: 43,
    date: "2026-06-09",
    title: "Auto-update actually applies now — the updater survives the app closing",
    changes: [
      "Fixed updates still failing at “Installing update…”: the updater is now started through the Windows shell so it keeps running after the app closes to swap files, then relaunches automatically",
      "This replaces the previous approach, which the operating system could silently terminate before the update ever began",
    ],
  },
  {
    build: 42,
    date: "2026-06-09",
    title: "Auto-update reliability — the updater no longer gets killed mid-install",
    changes: [
      "Fixed the app quitting at “Installing update…” without ever applying the update",
      "The updater now runs as a fully independent process so it survives the app closing to swap files, then relaunches automatically",
    ],
  },
  {
    build: 41,
    date: "2026-06-09",
    title: "Tidier sidebar — scrollable, with collapsible sections",
    changes: [
      "The left navigation now scrolls when there are more items than fit on screen",
      "Navigation is grouped into collapsible sections (Work, Knowledge, Communications, Compliance, Administration) with Dashboard, Little Gerry, and Daily Assistant pinned at the top",
      "Collapsed sections show a badge with any pending counts inside them, so nothing important gets hidden",
      "The section containing your current page stays open, and your collapsed/expanded choices are remembered between sessions",
    ],
  },
  {
    build: 40,
    date: "2026-06-08",
    title: "Reliable startup — self-heal a leftover database container",
    changes: [
      "Fix the app failing to start with a “container name pmi_postgres is already in use” error when a stale database container was left behind",
      "On launch the app now removes any conflicting leftover database container it doesn’t own before starting its own",
    ],
  },
  {
    build: 39,
    date: "2026-06-08",
    title: "Email invites + Google sign-in onboarding + automatic updates",
    changes: [
      "Invite teammates by email: send a link to download the app and sign in with Google — no passwords to manage",
      "Accounts are created automatically on first Google sign-in; everyone joins as a full-access member, you stay the admin",
      "The Invite dialog is now just an email, optional name, and an optional personal note",
      "The app updates itself on launch — it pulls the latest version and applies any database changes automatically",
    ],
  },
  {
    build: 38,
    date: "2026-06-08",
    title: "First-use setup wizard — guided one-time onboarding",
    changes: [
      "New guided wizard on first login: welcome, how it works (why Docker and Python were installed), and a tour of importing, editing, chatting, and submitting feedback",
      "Walks you through connecting Claude (Anthropic) and Voyage (document search) with the keys your team already has — Claude + Voyage are pre-set as the defaults",
      "Optional Google Workspace connection step, plus an explainer of roles and per-user privileges",
      "Shows only once per user (tracked server-side); change anything later in Settings",
    ],
  },
  {
    build: 37,
    date: "2026-06-08",
    title: "In-app feedback — report bugs / request features from the top bar",
    changes: [
      "New Feedback button in the top bar: open a box, pick Bug or Feature, and write in an issue or request",
      "Submissions are saved and routed to the owner's Notifications (tab + bell), so feedback from any user shows up there",
      "Fix Notifications failing to load (500) when a notification linked to an entity — entity_id type corrected",
      "Fix Alembic migrations: run as the privileged DB role and hand new-table ownership to the app role so endpoints don't hit permission errors",
    ],
  },
  {
    build: 36,
    date: "2026-06-08",
    title: "Regulatory file explorer + per-user write permissions",
    changes: [
      "Regulatory page rebuilt as a file explorer: browse folders, create folders, upload files, import from Google Drive, edit text files, rename, move, and delete",
      "Everyone can read/write all sections except Regulatory; Regulatory write access is granted per user (admins always allowed)",
      "New per-user 'Regulatory write' permission with a toggle on the Users page and a checkbox in the invite dialog",
      "Files are stored locally; renames and moves only update the database (fast, no re-upload)",
      "Import from Drive exports Google Docs/Sheets/Slides to Office formats automatically",
      "Fix Alembic migrations creating tables owned by the wrong DB role (caused permission-denied 500s) — migrations now use the app role by default",
    ],
  },
  {
    build: 35,
    date: "2026-06-08",
    title: "Milestone v0.9.0 — Drive auto-update detection, KB polish, copy fix",
    changes: [
      "Automatic Google Drive document update detection: background scan at 06:00/12:00/18:00 plus a manual 'Check for updates' button",
      "Detects modified, renamed, and deleted source files and flags them for human approval (no auto-overwrite) — Apply update re-imports, Dismiss re-baselines",
      "Records Drive source linkage on import; notifies the owner when a linked file changes",
      "Knowledge Base: in-modal progress bar and per-file status during Drive import",
      "Fix Drive import of uploaded Word files: parse .docx with python-docx (export() returns 403 for non-Google files)",
      "Fix GET /documents 500: add limit property to pagination params",
      "Fix delete and edit not persisting: routes now commit (get_db never auto-commits)",
      "Fix Drive-imported content mis-parsed: use a text extension so ingestion doesn't PDF-parse plain text",
      "Surface real Drive import/upload error messages instead of swallowing them",
      "Fix email draft generation 500: type EmailDraftOut timestamps as datetime",
      "Enable text selection/copy in the desktop window (pywebview disabled it by default)",
    ],
  },
  {
    build: 34,
    date: "2026-06-08",
    title: "Knowledge Base & Search — end-to-end fixes",
    changes: [
      "Fix Knowledge Base uploads silently failing: upload and Drive-import routes never committed the transaction, so documents rolled back and the KB stayed empty",
      "Fix 500 on upload: refresh document after ingest so server-generated timestamps serialize without a MissingGreenlet error",
      "Fix semantic search returning no results: corrected repository session attribute and switched to typed pgvector cosine_distance",
      "Fix Google shared-drive browsing: list shared-drive roots via corpora+driveId; Drive search now spans all drives",
      "Fix ingestion root cause: document was never added to the session, leaving null IDs and orphaned files",
      "Voyage embeddings: per-provider default model resolution, batch embedding, and rate-limit retry; axios timeout raised to 120s",
      "Google Calendar: scope events to the viewed month; raise maxResults so recurring events no longer swamp results",
      "Verified live end-to-end over HTTP: PC upload, Drive import from PMI Share Drive, and semantic search all working",
    ],
  },
  {
    build: 33,
    date: "2026-06-07",
    title: "Phase 7: Advanced Features",
    changes: [
      "Fix meetings.py _llm_summarize bug: db session was not in scope (runtime crash on Summarize)",
      "Investor Relations page (/investor): company snapshot, 510k/DHF doc registry, AI draft, recent research, IR chat shortcut",
      "Investor Relations nav item added to sidebar (TrendingUp icon)",
      "All Phase 7 features now operational: meetings, briefings, regulatory, QMS/CAPA, Drive KB ingestion, in-app update",
    ],
  },
  {
    build: 32,
    date: "2026-06-08",
    title: "Phase 6: LangGraph multi-agent system",
    changes: [
      "Add LangGraph v2 multi-agent architecture under services/agent/v2/",
      "Seven specialist agents: ExecutiveAssistant, Research, Regulatory, QMS, IR, Engineering, Operations",
      "Supervisor routes each message to the best specialist via LLM classification",
      "LangChain tool wrappers delegate to existing dispatch_tool() without code duplication",
      "Feature flag: llm.use_langgraph (default false) — toggle in system_settings",
      "v1 AgentExecutor remains fully operational; zero user-facing disruption",
    ],
  },
  {
    build: 31,
    date: "2026-06-07",
    title: "Phase 5: Approval workflow — execute on approve, audit trail for all decisions",
    changes: [
      "POST /approvals/{id}/resolve now executes the approved action immediately after human sign-off",
      "send_email intent: calls gmail_send() with payload fields (to/recipient_email, subject, body/draft_body)",
      "create_calendar_event intent: calls calendar_create_event() with payload fields",
      "Email drafts submitted for approval are marked 'sent' in the database once executed",
      "All approval decisions (approved + rejected) are written to the immutable hash-chained audit log",
      "Execution result (success/error/no_action) returned in resolve response and displayed in the Approvals UI",
      "Approve/Reject buttons show loading state and are disabled during submission",
      "Execution failure never rolls back the human approval decision",
    ],
  },
  {
    build: 30,
    date: "2026-06-07",
    title: "Phase 4: Settings UI — model dropdowns, re-index workflow, live AI health panel",
    changes: [
      "llm.provider added to EXPOSED_KEYS so the provider field is always persisted correctly",
      "New GET /settings/ai-options endpoint returns per-provider model lists (Anthropic, OpenAI, Voyage, Ollama)",
      "Embedding model is now a proper dropdown per provider (voyage-3/voyage-3-lite, text-embedding-3-large/small, Ollama list)",
      "Fixed incorrect dimension hints in Voyage AI and OpenAI info boxes (was 768 dims, now provider-native)",
      "Warning banner (⚠ Re-index required) appears automatically when embedding provider/model changes dimension",
      "Re-index Now button opens a progress modal with real-time SSE stream showing doc-by-doc progress",
      "Compact LLM ● / Embeddings ● live status row added at the top of AI Engine settings (from GET /settings/health)",
      "System Health section now includes Embeddings row (provider/model/dims) and re-index flag from GET /health",
      "Default mergedSettings updated to anthropic/voyage/1024 dims instead of ollama/768 dims",
    ],
  },
  {
    build: 29,
    date: "2026-06-07",
    title: "Phase 3: Live API health pings for LLM and embedding providers",
    changes: [
      "GET /health now performs a real live API call to verify each provider (Anthropic count_tokens, OpenAI models.retrieve, Voyage embed)",
      "GET /health now includes an 'embedding' check with provider, model, and measured dimension",
      "GET /health now includes 'kb_needs_reindex' flag from system_settings",
      "New GET /settings/health endpoint: lightweight LLM + embedding ping only, no disk/DB checks, < 3s target",
      "Both health endpoints run LLM and embedding pings concurrently (asyncio.gather) for speed",
      "Anthropic ping uses count_tokens (free, no tokens billed); OpenAI ping uses models.retrieve (free metadata)",
    ],
  },
  {
    build: 28,
    date: "2026-06-07",
    title: "Phase 2: Anthropic/Voyage defaults, no silent Ollama fallback",
    changes: [
      "Default LLM provider changed from Ollama to Anthropic (claude-sonnet-4-6)",
      "Default embedding provider changed from Ollama to Voyage AI (voyage-3, 1024 dims)",
      "LLM router no longer falls back silently to Ollama when a cloud API key is missing",
      "Missing API key now raises a RuntimeError with a clear Settings link instead of silently switching provider",
      "Removed get_llm_client_no_db() — it was never safe to build a client without DB context",
      "config.py defaults updated: default_llm_model=claude-sonnet-4-6, default_embedding_model=voyage-3",
      ".env.example updated with DEFAULT_LLM_PROVIDER, DEFAULT_EMBEDDING_PROVIDER, DEFAULT_EMBEDDING_DIMENSION",
    ],
  },
  {
    build: 27,
    date: "2026-06-07",
    title: "Phase 1: Native embedding dimensions (Voyage 1024, OpenAI 1536/3072)",
    changes: [
      "Voyage AI now returns native 1024-dim vectors (was forced to 768 — losing retrieval quality)",
      "OpenAI text-embedding-3-small/large now return native 1536/3072-dim vectors",
      "Added PROVIDER_DIMENSIONS lookup table for all supported providers and models",
      "POST /documents/reindex SSE endpoint: ALTERs pgvector column, re-embeds all documents, streams progress",
      "Settings PUT now detects embedding dimension mismatch and sets llm.kb_needs_reindex=true",
      "SettingsOut now includes embedding_dimension (int) and reindex_required (bool)",
      "Migration 002: adds document_chunks.embedding_dimension column + seeds system_settings keys",
      "DocumentChunkRepository: added delete_all_chunks() and get_all_document_ids_ready() for re-index",
    ],
  },
  {
    build: 26,
    date: "2026-06-07",
    title: "Planning: v2 Roadmap & documentation suite",
    changes: [
      "Created ROADMAP.md — 7-phase implementation plan with gap analysis and README update directives per phase",
      "Created CHANGELOG.md, USER_GUIDE.md, and DEVELOPER_GUIDE.md",
      "Identified critical gap: all embedding providers forced to 768 dims; Voyage AI native is 1024",
      "v2 spec (LittleGerry_ProjectPrompt_v2.md) accepted as authoritative — supersedes Ollama-first prompt",
    ],
  },
  {
    build: 25,
    date: "2026-06-07",
    title: "Fix: Gerry tool calls — Anthropic streaming rewrite",
    changes: [
      "Root cause found: Anthropic streaming used Raw SSE event string matching which silently dropped tool_use blocks",
      "Rewrote chat_stream to use stream.text_stream (SDK-documented API) + get_final_message() for tool extraction",
      "Gerry now correctly calls Drive, Gmail, Calendar, and KB tools instead of saying 'Let me check'",
      "Google is confirmed connected and valid — tool execution was blocked by streaming parser, now fixed",
    ],
  },
  {
    build: 24,
    date: "2026-06-07",
    title: "Fix: Embedding service & Gerry tool-calling",
    changes: [
      "Agent executor now reads embedding provider from DB — no longer hardcoded to Ollama",
      "KB import and semantic search now work with Voyage AI / OpenAI embedding providers",
      "Gerry: strengthened Google tool-calling instruction — now calls Drive/Gmail immediately instead of saying 'I'll check'",
      "Search error now shows the actual backend error message instead of a hardcoded Ollama hint",
    ],
  },
  {
    build: 23,
    date: "2026-06-07",
    title: "Fix: Embedding provider resets to Ollama after Save",
    changes: [
      "Settings page now invalidates the settings query after a successful save",
      "Embedding provider selection now persists correctly — no longer reverts to Ollama",
      "Added embedding_provider and voyage_key_set to loading state defaults",
    ],
  },
  {
    build: 22,
    date: "2026-06-07",
    title: "Voyage AI Embeddings — Full Anthropic-Only Support",
    changes: [
      "Added Voyage AI as a third embedding provider (Anthropic's official embedding partner)",
      "Voyage AI uses voyage-3 at 768 dims — no database migration required",
      "Settings now offers: Ollama (local), Voyage AI (cloud, Anthropic users), OpenAI (cloud)",
      "Voyage AI API key stored securely in OS keychain; get a free key at dash.voyageai.com",
      "Removed requirement for Ollama or OpenAI when using Anthropic as the LLM provider",
    ],
  },
  {
    build: 21,
    date: "2026-06-06",
    title: "Cloud Embeddings (OpenAI) — Ollama No Longer Required",
    changes: [
      "New 'Embedding Provider' setting: choose Ollama (local) or OpenAI (cloud)",
      "OpenAI text-embedding-3-small at 768 dims — matches the existing KB schema, no database migration needed",
      "Anthropic users without Ollama can now use Knowledge Base and Semantic Search via OpenAI embeddings",
      "Settings page now shows the embedding section clearly, with guidance when Ollama is not available",
      "OpenAI API key entry shown automatically when OpenAI embeddings are selected with Anthropic as LLM",
    ],
  },
  {
    build: 20,
    date: "2026-06-06",
    title: "Bug Fixes — Research, KB, Search, Calendar, Emails",
    changes: [
      "Research agent now returns results — ddgs package was missing from the venv and has been installed",
      "Knowledge Base import and Semantic Search now work — Ollama Server URL field is always visible in Settings regardless of LLM provider (embeddings always use Ollama)",
      "Document ingestion errors now show the actual failure reason instead of a generic message",
      "Google Calendar: added Sync button with spinner; shows error banner if sync fails",
      "Email Drafts: fixed regenerate crashing silently (missing db parameter); errors now shown in the form",
    ],
  },
  {
    build: 19,
    date: "2026-06-07",
    title: "Google Workspace Integration",
    changes: [
      "Import Google Drive files directly into the Knowledge Base from the Documents page",
      "Google Calendar events appear on the Calendar grid alongside local tasks and meetings",
      "Import tasks from Google Tasks — select from a list and import in bulk to the Tasks board",
      "Task attachments: attach Drive files or AI-generated files to any task from the task drawer",
      "Drive browser now shows company Shared Drives alongside My Drive",
    ],
  },
  {
    build: 18,
    date: "2026-06-06",
    title: "Persistent Chat Sidebar + File Generation",
    changes: [
      "New persistent assistant panel — stays open while you navigate between tabs",
      "Sidebar sends the current page name as context so the AI knows what you're viewing",
      "AI can now generate files (TXT, Markdown, CSV, JSON) via the generate_file tool",
      "Download buttons appear automatically in chat when a file is generated",
      "New Generated Files page to browse and download all AI-created files",
      "Status bar shows OpenAI, Anthropic, and Ollama connection states",
    ],
  },
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
