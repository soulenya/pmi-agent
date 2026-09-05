# Little Gerry — User Guide
**AI Executive Assistant for Precisian Medical Instruments**

Build 43 (v1.1.0) · June 2026

---

## What is Little Gerry?

Little Gerry is your AI Executive Assistant, Chief of Staff, and Knowledge Manager for the VACTOR program. She can:

- Answer questions about your documents and company knowledge
- Search Gmail, Google Drive, and Calendar on your behalf
- Surface daily suggestions from your Gmail and Google Tasks for you to review
- Research topics on the web and produce cited reports
- Draft emails, summaries, and regulatory content
- Manage and track tasks and projects
- Keep a full audit trail of all AI actions

**All your data stays on your machine.** Conversations, documents, and tasks are stored locally. API keys are kept in your operating system's secure keychain — not on disk.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Logging In](#logging-in)
3. [Inviting Teammates](#inviting-teammates)
4. [AI Configuration (First Time)](#ai-configuration-first-time)
5. [Features at a Glance](#features-at-a-glance)
6. [Talking to Little Gerry](#talking-to-little-gerry)
7. [Ask Gerry About Anything](#ask-gerry-about-anything)
8. [Daily Assistant](#daily-assistant)
9. [Workrooms](#workrooms)
10. [Knowledge Base](#knowledge-base)
11. [Semantic Search](#semantic-search)
12. [Research](#research)
13. [Research Browser](#research-browser)
14. [Tasks & Projects](#tasks--projects)
15. [The Hub](#the-hub)
16. [Calendar](#calendar)
17. [Gmail (Inbox, Compose & Replies)](#gmail-inbox-compose--replies)
18. [Email Drafts](#email-drafts)
19. [Meeting Notes](#meeting-notes)
20. [Regulatory Documents](#regulatory-documents)
21. [Slide Decks](#slide-decks)
22. [Investor Relations](#investor-relations)
23. [Google Workspace](#google-workspace)
24. [Odoo ERP](#odoo-erp)
25. [Manage Budgets](#manage-budgets)
26. [Approvals Queue](#approvals-queue)
27. [Notifications](#notifications)
28. [Settings](#settings)
29. [Updating Little Gerry](#updating-little-gerry)
30. [Tips & Example Prompts](#tips--example-prompts)

---

## Getting Started

### Installation

Little Gerry ships as a native installer for **Windows 11** and **macOS (Apple
Silicon)**. Both installers are attached to every release at
<https://github.com/soulenya/pmi-agent/releases/latest>. For full step-by-step
instructions (including trusting the publisher and adding Google credentials),
see [docs/INSTALL.md](docs/INSTALL.md).

**Windows 11**

1. Download **`Trust-Little-Gerry.bat`** and right-click → **Run as
   administrator** (one-time, so Windows trusts the publisher).
2. Run **`LittleGerry_Setup.exe`** and follow the wizard.
3. Launch from the **Start Menu** or **desktop shortcut**.

**macOS (Apple Silicon, macOS 12+)**

1. Download **`LittleGerry.pkg`** — it is signed & notarized, so double-click
   and follow the installer (everything installs per-user to
   `~/Applications/Little Gerry`, no admin password needed).
2. On a fresh Mac only, run the one-time prerequisites installer:
   `bash "$HOME/Applications/Little Gerry/scripts/install.sh"`.
3. Launch **Little Gerry.app** from `~/Applications/Little Gerry`.

The installer sets up Docker, PostgreSQL, and all required services
automatically. Updates are delivered in-app on both platforms.


### Starting and Stopping

| Action | How |
|--------|-----|
| Start | Double-click the desktop shortcut or `Start Little Gerry.bat` |
| Stop | Close the window (a confirmation dialog appears) or use the system tray → Stop All Services |
| Restart services | Click `···` in the sidebar → Restart Services |

---

## Logging In

Click **Sign in with Google**. Little Gerry uses Google sign-in only — there are no passwords. Your Google account must be on an approved Workspace domain (`pmi-llc.com` or `precisianmedical.com`). On your **first** sign-in your account is created automatically: the owner is the **admin** and everyone else joins as a **full-access member**.

---

## Inviting Teammates

If you're the admin, you can invite others from **Users** → **Invite**:

1. Enter their **email** (a display name and a short personal note are optional).
2. Click **Send Invite**. They get an email with a link to download Little Gerry and a one-line instruction: **Sign in with Google**.
3. The first time they sign in, their account is created automatically as a **full-access member** — no passwords, no setup steps for you.

Everyone runs their own copy of Little Gerry, so each install keeps its own local data. The invite simply gets a teammate the app and an account on their own machine.

---

## AI Configuration (First Time)

### The setup guide

The first time you sign in, Little Gerry walks you through everything it needs. You can skip any step and come back to it later in Settings. It covers:

1. **Welcome** and **How it works** — what the background pieces the installer set up are for.
2. **Restore** — if you are moving from another computer, load your `.lgbackup` file here and everything comes back before you set anything else up. See [Backup & Restore](#backup--restore).
3. **Claude** and **Voyage** — the two API keys described below.
4. **Google Workspace** — sign in so Gerry can reach your mail, calendar and Drive.
5. **You** — the name Gerry uses when it addresses you and signs drafts.
6. **Company** — the Drive folder holding your company background, which Gerry keeps in mind in every conversation.
7. **Your voice** — optionally let Gerry read your sent mail and learn how you write, so its drafts sound like you.
8. **Speech** and **Meetings** — the Google Cloud key that powers talking to Gerry out loud and live meeting transcription.
9. **Briefing** — optionally schedule a short summary of your mail, calendar and tasks to be waiting each morning.
10. **Backups** — a daily copy of your conversations into your own Google Drive.
11. **Models** — which model handles which job; the defaults are sensible and you can change them later.
12. **Using it**, **Roles** and **Done**.

If you have used Little Gerry before and an update adds new setup steps, the guide reappears once showing **only the steps that are new to you**.

### The two API keys

Before using the Knowledge Base or Semantic Search, you need two API keys:

### Step 1 — Anthropic API Key (for AI responses)

1. Go to [console.anthropic.com](https://console.anthropic.com) and create an account
2. Generate an API key
3. In Little Gerry: **Settings → AI Engine → Anthropic API Key**
4. Paste your key and click **Stage key**, then **Save**

### Step 2 — Voyage AI Key (for document search)

Anthropic does not provide an embedding service. Voyage AI is their official partner and offers a **free tier** (200 million tokens/month — more than enough for typical use).

1. Go to [dash.voyageai.com](https://dash.voyageai.com) and create a free account
2. Generate an API key (starts with `pa-`)
3. In Little Gerry: **Settings → AI Engine → Document Embeddings**
4. Select **Voyage AI (cloud — recommended for Anthropic users)**
5. Enter your key and click **Stage key**, then **Save**

> **Why two keys?** The LLM key (Anthropic) powers all AI responses. The embedding key (Voyage AI) converts your documents into searchable vectors. They are different services.

### Optional — Company Profile (shared company facts)

Little Gerry can load a small **company profile** — key people, products, partners, and regulatory context — into every conversation automatically, so she always knows the basics without searching. Because every teammate runs their own copy of Little Gerry, the profile lives in a **shared Google Drive file** (the single source of truth), not on any one machine. **PMI installs come preconfigured with the shared company file — no setup needed.** To use a different file:

1. Create a markdown file in a shared Drive location everyone can read (e.g. `Little Gerry/company-context.md`). Keep it under 6,000 characters — long documents belong in the Knowledge Base. The empty state in Settings shows a recommended structure.
2. In **Settings → Company Profile**, paste the file's Drive link or ID and click **Save & sync**.
3. Little Gerry re-loads the file on every launch; use **Refresh now** after editing it in Drive. Editing happens **only in Drive** — the app view is read-only so all machines stay consistent.

### Optional — Writing Voice (make drafts sound like you)

Gerry can learn how *you* write, so the emails she drafts read like something you'd actually send instead of generic assistant prose.

Go to **Settings → Writing Voice** and click **Analyse my sent mail**. Gerry reads up to 120 of your own sent emails from the last six months and writes a detailed profile of your voice: your cadence, the phrases you reach for, your openers and sign-offs, how direct you are with a colleague versus a customer, and the things you never do. It takes a few minutes.

When it finishes, read the profile through and click **Edit** to change anything that doesn't sound like you. From that point on, every email Gerry drafts for you follows it.

- **Already have a profile written?** Click **Upload a .md profile** and pick your markdown file.
- **Use this voice for other writing too** — tick this box and Gerry also applies your voice to summaries, chat replies and documents she writes for you. Leave it off and formal deliverables like regulatory documents keep their standard house style.
- **Remove** deletes it and drafts go back to the standard voice.

Your profile is **yours alone**. It is stored against your account, never shared with teammates on the same install, and never used for anyone else's drafts. The analysis runs against your own mailbox using the AI model you already have configured.

---

## Features at a Glance

| Module | What it does |
|--------|-------------|
| **AI Chat** | Talk to Little Gerry — she searches your KB, Drive, emails, and the web |
| **Ask Gerry** | One-click "Ask Gerry about this" button on any task, email, file, contact, or event — opens a chat already primed with that item |
| **Dashboard** | Daily briefing, open tasks, pending approvals, today's meetings |
| **Daily Assistant** | A once-a-day scan of your Gmail and Google Tasks that suggests follow-ups and to-dos for you to review |
| **Workrooms** | Persistent co-work spaces — a goal, pinned documents and a progress journal that Gerry carries into every message of the room's chat. Goal and title edits are logged with their previous wording, and Gerry warns before touching a file that belongs to another room |
| **Knowledge Base** | Upload and manage your company documents; Little Gerry can read a whole document in full when you ask her to summarize or analyze it |
| **Search** | Natural language search across all uploaded documents |
| **Research** | AI-powered web research with cited reports |
| **Tasks** | Kanban board for action tracking |
| **Projects** | Group tasks by project, with a Gantt timeline, an infinite canvas and milestone tracking |
| **The hub** | Connect once and see the projects the firm shares, live from the shared server — nothing is copied onto your computer |
| **Calendar** | Local events + Google Calendar side by side |
| **Gmail** | Full inbox — browse standard folders (Inbox, Sent, Drafts, Starred, etc.), sort your mail, read, search, filter by tag, reply/reply-all/forward, mark read or unread, move to Trash, collapse read parts of a thread behind a Gerry summary, open attachments or add them to the Knowledge Base, and compose & send your own emails |
| **Email Drafts** | Ask Little Gerry to draft an email, then approve it to send — or write your own from the Gmail composer |
| **Meeting Notes** | Auto-records and transcribes your video calls, then AI-summarizes them — or paste a transcript manually |
| **Regulatory** | Track DHF, IFU, 510(k), and ISO documents with AI drafting |
| **Slide Decks** | Ask for a presentation and Gerry builds one in the company house style, marked with the security classification you choose |
| **Investor Relations** | Company snapshot, regulatory proof-points, IR doc registry with AI drafting, and research feed |
| **Approvals** | Human-in-the-loop queue — approve/reject with automatic action execution |
| **Notifications** | Real-time alerts for tasks, approvals, and AI activity |
| **Audit Trail** | Immutable log of every AI action and document change |
| **Odoo ERP** | Connect your Odoo account (API key) so Little Gerry can read and propose ERP actions |
| **Settings** | Configure AI providers, appearance, and Google integration |

> **Finding your way around.** The home screen is a **solar system**: Little Gerry is the sun (click her to chat), **Dashboard**, the **Daily Assistant** and **Workrooms** orbit close in, and five planets group the modules — **Work**, **Knowledge**, **Communications**, **Odoo**, and **Compliance** — with each feature page as a moon. The narrow **left rail** shows the sun and the five planets from anywhere in the app: click a planet to zoom into it, or simply **hover over it** and a menu glides out listing its moons so you can jump straight to any page in one click. The **chat bubble under the sun** returns you to your last open Gerry conversation from any page. Esc zooms back out a level.

> **Going back.** The **‹ ›** arrows at the top left retrace your steps, exactly as a browser's back and forward do. Leave a project for the chat and one press of **‹** puts you back where you were. **Alt+←** and **Alt+→** do the same from the keyboard (**⌘[** and **⌘]** on a Mac).

---

## Talking to Little Gerry

Navigate to **AI Assistant** in the sidebar.

- Type your message and press **Enter** (use **Shift+Enter** for a new line without sending)
- Little Gerry streams her response in real time
- When she uses a tool (searching Drive, reading an email, querying the KB), a status indicator appears
- When Gerry **creates** something during a chat — an email draft, an approval request, a task, a budget entry, a filed invoice — a **"take me to it" chip** appears under her reply: one click jumps straight to the draft/approval/budget instead of you hunting it down. Chips work in the sidebar chat too and stay on the message in history
- **Restricted sources**: Gerry never reads or references the QMS folder (or its subfolders) or any file with "draft" in its name unless you explicitly ask — and she'll confirm first, naming the folder and file she's about to open. Allowing her to **edit** a specific file counts as asking: she can then read and change that one file without checking again, while its folder and every other draft stay restricted
- **Long conversations** open on your most recent messages. Scroll up and click **Load earlier messages** to walk back through the rest — there's no limit on how far back a conversation can go, and nothing is ever dropped
- **Stopping Gerry mid-answer:** a **Stop** button appears while she's working. Whatever she has already written is kept and marked *Stopped*, and any file or draft she'd already produced stays — stopping doesn't undo finished work, it just prevents the next step. Stop also works when the connection has dropped, which is when it's usually most wanted
- Hover over a conversation in the left panel to rename or archive it
- Click **+** to start a new conversation

### What Little Gerry can do automatically

When Google is connected, Little Gerry calls the appropriate tool immediately — she doesn't just describe what she's about to do:

- "Can you see my PMI share drive?" → lists your Drive contents instantly
- "Any emails about the 510k?" → searches Gmail immediately
- "What's on my calendar this week?" → fetches calendar events immediately
- "Add Jane Smith (jane@acme.com, Acme) to my contacts" → saves straight to the Contacts page — works for one contact or a whole pasted list
- "Help me with this document" → Gerry lists your recently edited Google Docs, confirms which one, then **follows it live** — she re-reads your latest edits on every message, so ask anything ("how's the intro now?", "tighten section 3") while you write. Paste a Docs link for a one-time review instead, and say "stop following the doc" when you're done
- "Add that Drive file to the knowledge base" → Gerry imports it on the spot (works for her generated files too), with duplicate detection — regulated imports stay manual
- "Is the company Drive backed up?" → Gerry reads the nightly backup bucket (read-only), reports the last backup time with a CURRENT/STALE verdict, and lists which files changed since
- "Write me a memo about…" → Gerry first checks the shared templates folder on Drive for that document type's required structure and follows it exactly — drop a new template doc in the folder and every teammate's formats update instantly. Add a doc named "Style Guide" and its rules are applied to **every** generated document — even types with no template — so everything looks uniform. The Regulatory page's document wizard follows the same templates folder too
- "Build me a deck on…" → Gerry asks which security classification applies, then builds a real presentation in the company house style and puts it on your Drive as Google Slides — see [Slide Decks](#slide-decks)
- "What do our VACTOR specs say about suction pressure?" → searches the Knowledge Base

### What requires your approval

Little Gerry will **never** send an email, create a calendar event, modify a document, or take any write action without asking you first. You must explicitly approve. (Emails you write yourself in the Gmail composer are your own action and send directly — see [Gmail](#gmail-inbox-compose--replies).)

You can approve wherever is most convenient — no need to change pages:

- **In the email thread** — when Gerry drafts a reply, the draft appears at the top of that thread with **Approve**, **Edit**, and **Reject** buttons.
- **In the chat** — when Gerry proposes an action mid-conversation, the approval card appears right there in the conversation.
- **From the top bar** — the clipboard icon (with a pending count) opens the **approvals drawer** on any page.
- **From a notification** — approval notifications include **Approve** and **Reject** buttons.
- The **Approvals** page still lists everything in one place.

Whichever way you approve, a **confirmation appears in the bottom-right corner** telling you the email was sent (or exactly why it couldn't be).

---

## Ask Gerry About Anything

Almost everywhere in the app you'll see an **"Ask Gerry about this"** button (a small robot icon). It appears on your tasks, projects, contacts, emails, email drafts, calendar events, Knowledge Base documents, generated files, and email attachments.

- Click it and Little Gerry opens a **fresh conversation already primed with that item's details**, so you can dive straight into questions without copying anything over.
- For real files — email attachments and generated files — Little Gerry reads the **actual contents** of the file, so you can ask about what's inside.
- Each "Ask Gerry" chat opens in the Little Gerry side panel and becomes its own conversation you can return to later.

### Sizing the side panel

The side panel starts narrow, which is fine for a quick question and cramped for a long answer. Three ways to give it more room:

- **Drag the left edge** to any width you like. Double-click the edge to snap it back to the default.
- **Expand** (the double-arrow button in the panel header) jumps straight to double width, and back again.
- **Pop out** (the picture-in-picture button) lifts the panel off the side of the window into a floating panel you can drag around by its header and resize from the bottom-right corner. Put it wherever it doesn't cover what you're reading. The dock button in its header puts it back.

Whatever you choose is remembered — width, expanded, popped out and where you left it floating — so it comes back the same way next time.

---

## Daily Assistant

The **Daily Assistant** runs a quiet, once-a-day scan of your **Gmail** and **Google Tasks** in the background and gathers suggestions — follow-ups you may owe someone, emails that look like they need a reply, and to-dos worth tracking — so nothing slips through the cracks.

- A **briefing panel** is docked on the right side of the home screen (next to the solar system). At a glance it shows **today's schedule**, **unread email**, **tasks due**, **pending approvals**, **suggestions**, and an **Odoo snapshot** (bank balances) — each section links straight to the right page. Collapse or reopen it with the panel button; Little Gerry remembers your choice.
- Open **Daily Assistant** itself from its satellite next to the sun (or the briefing panel header). The badge shows the number of pending suggestions.
- **Suggestions are grouped by what they're about** rather than listed one under another. Each workroom gets a box (*Henry Jackson Foundation · 6*), and email follow-ups group under the person you're waiting on. Every box carries a count and a one-line description; click it to open the suggestions inside.
- **Dismiss all** on a box clears that whole group in one click.
- **The boxes are ordered by what you actually use.** Little Gerry keeps score of how often you keep versus dismiss each type of suggestion. The kinds you accept sit at the top and open automatically; the kinds you always bin sink to the bottom and arrive closed, saying so. Groups of two or fewer always stay open. Opening or closing a box yourself overrides this until you reload.
- Each suggestion is something to **review** — the assistant never acts on its own. You decide what to do with it.
- **Already done** marks a suggestion as handled. Unlike Dismiss (which lets an item come back once, in case you clicked it by accident), a completed suggestion is never recommended again.
- **Select several at once** — tick the checkbox on each card (or **Select all** in the bar above the list) and use **Mark done** or **Dismiss** to clear them in one go.
- Suggestions are generated about **once per day**; the scan runs automatically in the background while the app is open.
- Requires **Google Workspace** to be connected (see [Google Workspace](#google-workspace)) for the email/schedule sections. Without it, the assistant still shows your tasks, approvals, and Odoo data.

---

## Workrooms

A **Workroom** is a persistent co-work space you share with Little Gerry — built for work that spans days or weeks, like a regulatory submission, an audit prep, or a fundraise.

- **Create a room** from the Workrooms satellite next to the sun (or the Workrooms section in the chat sidebar). Give it a title and a **goal** — what you're working toward.
- **Change the goal whenever the work turns.** Edit the Goal box and click **Save goal**; the change is written into the room's journal with the previous wording, the new wording and your name, so it travels into the room chat. Gerry always works from the goal as it stands now, knows you edit it yourself without telling her, and will read the current wording back to you rather than insisting it's still the original. Renaming a room is recorded the same way.
- **Pin artifacts** to the room: Drive docs, Knowledge Base documents, generated files, notes, **websites**, email threads, tasks, Odoo records, regulatory documents, and budgets. Pick the category, click **Browse …** and a picker opens listing everything of that kind — search it, click the item, and it's pinned with the right label and reference filled in for you (Drive opens the full Drive browser, so you can pin several files at once; **Note** just asks for the text). If you already know a raw ID, **Or pin by reference** still lets you type it in by hand. When a budget is pinned, Gerry's budget writes are journaled in the room automatically.
  - **Websites** keep a source where you can find it again — paste the address (`iqt.org/mission` is enough, no need to type `https://`) and optionally say what it is. Pinned websites are clickable in the room and open in your browser, and Gerry sees the address every turn, so she can re-read the page instead of searching for it again.
- **Gerry works the room too**: ask her to pin something ("pin that SOP to this room") or log progress ("note that we finished section 4") — and files she creates, docs she imports to the KB, and Drive docs she follows inside the room are **pinned and journaled automatically**. File cards in chat also get a **Pin to Room** button.
- **Enter the room** to chat — every room has its own conversation, and every message you send there automatically carries the room's goal, pinned items, and recent progress. No re-explaining context each session.
- **She won't wander into another room's files.** Drive results tell Gerry which room a document belongs to. If she opens one pinned to a different room she says so first, and if she's about to *edit* it she stops and asks you to confirm — so last month's deck doesn't get rewritten because the filename looked close enough.
- **You can both work in the same document.** When Gerry reads a Drive file or a deck she sees when it was last saved and by whom. If you've touched it in the last half hour she treats what she just read as the live version — she won't re-apply edits she already made, or overwrite wording you've just changed. If you've been editing while she works, tell her to re-read before she reports on progress.
- **Log progress** in the room's journal ("Sent draft to Lindsey for review"). The latest entries travel with the room chat, so Gerry always knows where things stand.
- **Gerry works between sessions**: give a room a **standing task** ("check for new FDA guidance every morning") from the Scheduled Tasks page or by asking Gerry in the room — runs happen in the room chat with full room context. Each morning a **digest** posts into active rooms (pinned docs edited, deadlines approaching, progress logged), and Gerry proposes a **next step** you can accept (creates a task, pinned to the room) or dismiss. A room waits until you've answered its current next step before proposing another, so they don't stack up while you're busy elsewhere.
  - Every scheduled run starts from a blank slate — Gerry cannot see the previous run's answer, so she has to do the work again rather than reword last week's report. Any file a run produces appears on the Scheduled Tasks page with the usual **Download**, **Open in Workspace**, **Add to KB** and **Pin** buttons. If a run ever claims a file that isn't really there, the run is marked failed instead of passing as a report.
- **Share a room with a teammate**: click **Share to Drive** and the room's definition (goal + pinned items) is published to a "Little Gerry Workrooms" folder on the shared Drive. Teammates see it under **Shared on Drive** and can **join** — they get their own mirror of the room with their own Gerry, chat, and journal. Use **Push update** to publish changes and **Pull latest** to refresh your mirror (pulling adds new pins, never deletes yours).
- **Archive** a room when the work wraps up — archived rooms stop injecting context but keep their history; restore them anytime.

---

## Knowledge Base

The Knowledge Base is Little Gerry's long-term memory about PMI and VACTOR.

### Uploading a document

1. Navigate to **Knowledge Base**
2. Click **Upload Document**
3. Select a PDF, DOCX, or TXT file
4. Assign a **category** (e.g., Regulatory, Clinical, Engineering)
5. The document is automatically split into chunks, embedded, and indexed — ready to search in seconds

### Supported formats
- PDF
- DOCX (Word)
- TXT

### Scanned pages, charts and diagrams

A document with no text layer — a scan, a photo of a page, an image — is read by looking at the pages, so it works where copying the text out returns nothing.

**Figures are read too.** Ask about a Gantt chart, timeline, plotted chart or diagram and Gerry reads the drawing itself: each row of a Gantt with the start and end its bar spans, the values behind a plotted chart, what a photograph or diagram shows — not just the labels printed around it. If an axis is too coarse to pin a value down exactly she says so rather than inventing a date.

**Ask for what you want.** Say which figure and what you need from it — "the start and end date of every bar in the three Gantt charts" — and the question is put to the model while it is looking at the pages. A vague request gets a general transcription.

**Long documents.** A long scan is read in sections and Gerry pages through the result until she reaches the end, so a 60-page solicitation is answered from all of it rather than its opening pages. This takes longer than a short document. If a section cannot be read completely she names it instead of leaving you to spot the gap.

### Importing from Google Drive

On the Documents page, use **Import from Drive** to search your Drive and pull files directly into the Knowledge Base.

### Avoiding duplicates

Little Gerry detects when you try to add a file that is byte-for-byte identical to
one already in the Knowledge Base:

- **On upload or Drive import:** if the file is a duplicate, Little Gerry pauses
  and shows which existing document it matches. Choose **Skip** to leave things
  as they are, or **Import anyway** if you intentionally want a second copy.
- **Manual scan:** click **Find duplicates** in the Knowledge Base toolbar to
  scan everything already stored. Matching files are grouped together — the
  oldest copy in each group is marked **Original**, and you can **Delete copy**
  on the extras to clean up.

> **Important:** Make sure your embedding provider (Voyage AI) is configured in Settings before uploading documents.


---

## Semantic Search

Navigate to **Search**.

- Type a natural language question or phrase
- Select a category filter (optional) to narrow results
- Results are ranked by semantic similarity — not just keywords
- Click any result to see the full chunk and which document it came from

Example queries:
```
suction pressure specifications
FDA 510(k) predicate device
ISO 14971 risk matrix VACTOR
investor communication Q2
```

---

## Research

Navigate to **Research** → **New Research Report**.

1. Enter a topic or question (e.g., "portable suction devices emergency market 2026")
2. Little Gerry searches the web (DuckDuckGo), reads the top sources, and synthesizes a report
3. The report is saved to your research archive with citations
4. All reports are searchable and can be referenced in chat

---

## Research Browser

A browser that lives inside Little Gerry, so anything you find on the web is one click away from being something Gerry can read.

Navigate to **Research Browser** and press **Open browser**. A separate browser window opens next to Little Gerry. You drive it from the app: type in the address bar, use back, forward and reload, open tabs, and star pages to bookmark them.

**You stay signed in.** Log in to a supplier portal, a standards library or a journal once and it remembers you next time you start Little Gerry.

Things you can do with the page you're on:

| Button | What it does |
|--------|--------------|
| **Ask Gerry about this page** | Reads the page as you see it and opens a new conversation with the text attached. Good for "summarise this", "what's the catch here?", "how does this compare to what we do?" |
| **Browse with Gerry** | A toggle. While it's on, whatever page you're on goes along with every message you send, and updates as you move around. Ask "what do you make of this?" without capturing anything. Turn it off when you're done. |
| **Save to Knowledge Base** | Files the page away permanently under *Web Research*, with a link back to where it came from. It turns up in search and Gerry can cite it, even if the site later changes or disappears. |
| **Pin to workroom** | Adds the page to a workroom's pinned items, so it's part of that room's context from then on. |
| **Send to canvas** | Drops the page onto a project's canvas as a card. Pick the project and the card lands on the board with the page's title, ready to be moved and linked. |
| **Fit to window** | Sizes the browser to the page area, clear of the left rail and the chat panel. |

**The buttons follow you onto the page.** As well as the rail beside the tabs, a faded dark bar sits in the bottom-left corner of every page you browse. Hover it and it comes up solid. Use it and you don't have to click back to the Little Gerry window at all. It hands the request over to Little Gerry to carry out, so give it a second.

**The browser gets out of the way.** Move to another part of the app and the browser window disappears rather than sinking behind Little Gerry. The compass at the bottom of the left-hand rail pulses to show the session is still there — click it to bring the browser back exactly as you left it.

**What Gerry can and can't see.** He only ever sees a page you have opened yourself — he can't go browsing on his own, and he can't reach anything you haven't shown him. Page text is handed to him as *material you are showing him*, never as instructions: if a page contains something like "ignore your previous instructions", he'll tell you about it rather than act on it.

**Nothing is stored by Browse with Gerry.** The page is read fresh each time you send a message and forgotten the moment you switch the toggle off. Only **Save to Knowledge Base** keeps anything.

> **Tip:** don't save website passwords anywhere in Little Gerry. Just log in once in the Research Browser — it stays logged in.

---

## Tasks & Projects

### Tasks

Navigate to **Tasks** for the Kanban board.

- **+ New Task** to create a task
- Drag cards between columns: **To Do → In Progress → In Review → Done**
- Click a task card to view details, set due dates, assign priority, and add attachments

### Every task leads back to what it's about

Tasks Gerry creates for you remember where they came from, so you never hit a dead end wondering "which document?" or "which email?".

- **Open …** jumps straight to the thing the task is about — the email thread in your Inbox, the document in the Knowledge Base, the regulatory file, the meeting, the workroom, or the chat where it came up.
- **Ask Gerry** opens a conversation about that specific task, with the context already loaded.
- **Gerry draft** appears on email follow-ups. One click and Gerry writes the reply for that thread; it lands in **Approvals** for you to read and send — nothing goes out on its own.

These buttons show on the task list, on Kanban cards, and in the task detail panel. Tasks on the Dashboard open the matching task directly.

### Projects

Navigate to **Projects** to group related tasks, track milestones, and monitor overall progress.

#### The project space

Every project card has a **layers** button that opens the project's own space. Tabs across the top:

- **Overview** — open and total tasks, pinned material, journal entries, the people on the project, the visibility control, and the archive/delete controls.
- **Canvas** — an endless whiteboard for the project.
- **Timeline** — the project's schedule as a Gantt chart.
- **Tasks** — the project's tasks, made and edited in place. See below.
- **Budget** — the money on this project. See below.
- **Material** — everything pinned to the project, its journal and its goal. See below.
- **Chat** — the project's conversation with Gerry, shared by everyone on the project. Every new project is given one the moment it is created, so this tab is ready straight away. Older projects made before this got a **Start one** button instead. A shared project on the hub opens its conversation in the app just the same; attachments and the conversation list on the left are for this computer's chats, so they are not shown there.

#### The Budget tab

A budget is a Google Sheet. This tab puts one on a project so that everyone working on the project can see where the money is — and so you can set money aside before you have spent it.

**To make one,** open the Budget tab and click **Add a budget**, then fill in the name, the allotment and any categories and click **Create**. Little Gerry builds the sheet on your Drive with its Ledger, Categories and Settings tabs already in place. This is the one to use: it is a real budget you can write to.

**Or use one you already have** — the same box lists your other budgets, and one click attaches it.

**Or paste a Drive link** to a sheet you keep yourself. Be aware that a sheet Little Gerry did not make is **read-only**: the figures show up here, but you cannot add a line or allocate anything against it from the app. Edit it in Google Sheets instead.

You must be able to edit the project to put anything on it.

**Click a budget to open its ledger.** You get every line, the category filters and the status filters — the same view as the Budget page, because it is the same ledger.

**Four statuses, on every line.** A budget is not only a record of what has gone:

| Status | What it means |
|---|---|
| **Spent** | Money that has gone. |
| **Allocated** | Money committed to something but not yet paid. |
| **Collected** | Money that has come in. |
| **Expected** | Money invoiced or forecast but not yet collected. |

**Allocated is the point of all this.** Set aside £40,000 for a contractor you have not paid yet and it comes off what is left immediately. The bar on each budget tracks **spent plus allocated**, and the line under it tells you how much is **free to allocate** — the number you need before you promise anything else.

**Money coming in is kept separate** and never inflates what you have left to spend. Collecting an invoice is not the same as being handed more budget.

**Existing lines are unaffected.** A line with no status counts as **Spent**, exactly as it always did. So does a line where somebody has typed a word the app does not know, so a typo in the sheet can never quietly take money out of a total.

**Sub-budgets.** If a budget references others, the panel lists them with what each has spent and what each has allocated, and those figures roll up into the parent as two synced lines. Add and remove references on the **Budget** page.

**What everyone on the project sees:** all of it — the totals, the allocations, the expected income and every line in the ledger. That is a view, not a handover: the sheet on Drive keeps its own sharing, so a teammate can only open the sheet itself if you have given them access there too.

**Only the person whose Drive holds the sheet can change anything** — add a line, edit one, delete one, or take the budget off the project (the **✕**). This is not a policy Little Gerry invented; a colleague's edit would be refused by Google Drive itself.

Taking a budget off a project, or deleting the project, never touches the budget or the sheet. The sheet exists whether or not a project claims it.

A shared project on the hub has a Budget tab of its own, and budgets created there are held on the hub beside the project, so everyone on the project sees the same figures. A budget you keep on this computer stays on this computer.

**How a budget on a shared project works.** The Google Sheet is always made on your own computer, under your own Google account, because the hub has no Google account of its own and never will. What travels to the hub is the finished budget — its name, its allotment and every line of its ledger — for everyone on the project to read. The rows are edited on the **Budgets** page or in Google Sheets, and **Update from Drive** on the project's Budget tab sends the new figures up. Only the person who created the budget can do that; from anyone else's computer the sheet cannot be read at all.

#### Archiving and deleting a project

Both live on the **Overview** tab, under **Archive or delete**.

**Archive** hides the project from the project list without losing anything. Anyone who can edit the project can archive it, and the same button reads **Bring it back** afterwards.

**Delete** cannot be undone. You must type the project's name to confirm. It removes the project, its tasks, its canvas, its timeline, its links, its member list, its pinned material and its conversation with Gerry — for everyone on the project, not just for you.

**Only the owner can delete a project.** A company-visible project makes everyone at the firm an editor, and destroying everyone's work is not an editing decision.

**Budgets survive a delete.** A budget is a link to a Google Sheet that exists whether or not a project claims it, so the project lets go of it and the sheet is untouched.

#### Asking Gerry about a project

Gerry can see every project you can open, on this computer and shared on the hub, and she can file a task under one — just name the project when you ask.

**Ask her to add a whole list of tasks at once.** Paste the line items from a contract, or describe the milestones, and say "add these to *SO/LIC CLIN 001*". She writes them in a single go — titles, descriptions, statuses, priorities, due dates, start and end dates, milestone flags, and sub-tasks that name their parent from the same list. If one line is wrong she tells you which and writes nothing at all, so you never end up with half a contract in the project.

**Ask her for sub-tasks under a task you already have** — "break *Site preparation* into steps" — and they go under that task. If two tasks answer to the name you used, she asks which one you meant and writes nothing until you say. If none do, she creates that parent and tells you she did.

**Ask her what is in a project** and she reads the whole task list back, sub-tasks indented under their parents, not just the tasks with your name on them.

All of that works on a shared hub project as well as a local one, and so do the timeline, scheduling a task's dates, and putting a note on the project's canvas.

**In a shared project's Chat tab, Gerry works from your machine.** She has your Knowledge Base, your Google account, your files and your budgets, exactly as she does anywhere else in the app. The hub keeps the conversation so the rest of the project can read it, and it is brought up to date each time you open the chat and after every answer.

> **What this means for what you share.** An answer Gerry gives inside a shared project can draw on your Knowledge Base and your Google account, and that answer is then stored on the hub where everyone on the project can read it. The documents themselves are never copied to the hub — only the messages. If something should not be repeated to the project, do not ask about it there.

#### The Timeline

Every task in the project draws as a bar on a time scale. Switch between **month**, **week** and **day** with the zoom buttons.

- **Move work** — drag a bar sideways.
- **Change how long something takes** — drag either end of a bar.
- **Say what waits on what** — drag from the handle on the right of one bar onto another bar. The second task now waits for the first, and the chart reschedules.
- **Mark a milestone** — a milestone has no length and draws as a diamond.

A task now has a **start** and an **end** as well as a **due date**. The due date keeps its old meaning: the date the work must be done by. The start and end are when it is actually worked on.

From those dates and links Little Gerry works out the schedule: the earliest and latest each task could run, how much **slack** it has, and which tasks are on the **critical path** — the chain where a day lost is a day lost to the whole project. Critical tasks are highlighted; anything that has run past its date turns red.

A link that would make two tasks wait on each other is refused rather than saved, with a message saying so. Viewers see the chart but cannot change it.

#### Tasks

The **Tasks** tab is where a project's work is made and kept. It works the same way whether the project lives on this computer or on the hub.

Type a title and press Enter, or open **Details** first to set the status, priority, assignee, due date, start and end dates and whether it is a milestone. Click any row to open it: everything you set on the way in can be changed, plus a description and a progress figure, and there is an **Add a sub-task** box and a **Delete**. Adding a sub-task folds the parent back up so you can see what you just made.

A field can be emptied as well as filled — clear a due date or set the assignee back to *Nobody yet* and it sticks.

**Sub-tasks sit indented under their parent**, whatever their own status, with an arrow on the parent to fold them away and a count when they are hidden. A sub-task is never listed twice.

**Every row carries its status as a coloured left edge** — grey for to do, blue for in progress, violet for in review, green for done, red for cancelled and pale grey for backlog — so you can read the state of a list without reading the words. **A task card on the canvas uses the same colours** around its border. Two things compete for that border, so schedule comes first: a card running late or nearly due keeps its amber or red ring, and a card you have coloured yourself keeps your colour.

Tasks group under the status of their top-level row, each heading carrying a count and collapsing when you click it. Sort the whole list by order, due date or priority. A task past its due date shows its date in red.

**Drag a row onto the canvas** to put it on the board.

Whoever can edit the project can add and change tasks. A viewer sees the list and nothing else. Work made in a shared project is held there: it can only be changed from that project, and only its owner can release it.

#### Material

Everything the project has been given to work with, in one tab. Like the Tasks tab, it works the same on a local project and on a hub project.

**What this project is for** sits at the top. Click the line and write; it is the same goal Gerry reads back to you in the project's conversation.

**Pinning.** Choose a kind from *Pin something…* and a browser opens on what you already have: knowledge base documents, Drive files, generated files, saved pages, notes, tasks, budgets, regulatory documents, email threads and Odoo records. Tasks and budgets are offered from this project. **Add a file** takes a file straight off your computer, stores it and pins it in one step.

Pins are grouped by kind with a count on each group. The ones that have somewhere to go carry an open link. The bin removes a pin — it unpins it from the project and does not delete the thing itself.

**Drag a pin onto the canvas** to put it on the board, the same as a task or a budget.

**The journal** is the project's running record — what happened, what was decided. Type a line and press Enter. Gerry reads these back when you work in the project's conversation.

**One thing files cannot do.** A document's contents are encrypted with a key held on the computer that added it. On a project shared with other people, everyone sees the pin and its name, but only that computer can open the file. Pins that work this way say so on the item, rather than letting you find out by clicking. **Drive files and saved pages open for everyone** — a Drive file opens for anyone the file itself is shared with, which is Google's business and not the project's. An email thread is the exception among links: it opens in the mailbox it came from and nowhere else.

A viewer sees the material and cannot change it.

#### The Canvas

An endless whiteboard for thinking a project through. Pick a tool from the bar in the top-left, then click the board to place something.

- **Sticky note**, **Text**, **Shape** and **Frame** for your own material. Pick a colour from the same bar, or change it afterwards — see below.
- **Draw** for freehand pen, pressure-sensitive if your device reports it. **Erase** removes whatever you click.
- **Images** — paste one with Ctrl+V or drop the file onto the board. Pictures are encrypted on your machine like every other document.
- **Text** — copy a passage from anywhere, press Ctrl+V on the board, and it lands as a text box in the middle of your view. Turn it into a note or a shape afterwards if you want one.
- **Right-click the empty board** to place something exactly where you clicked.

**Copying out of the chat panel.** Highlight a passage of Gerry's answer and right-click it. **Copy** puts it on the clipboard; under **Add to the canvas as** you choose **Text**, **Sticky note** or **Shape**, and it goes straight onto the open board. Right-clicking in the message box adds **Paste**. The canvas choices are only offered while a project's canvas is open; elsewhere the menu says *none open*.

**Changing how something looks.** Select anything and a panel opens under the toolbar. It changes fill, line colour, line thickness, dashed or solid, text colour, text size, bold and fade — at any time, not only at the moment you place something. Select several items and it changes all of them at once; where they disagree, the panel says so rather than flattening them.

**Shapes hold text.** Double-click a shape and type inside it. A shape can be rounded, square, an ellipse, a diamond or an arrow, and you can turn one into another from the panel. To put a shape around something already on the board, select it and choose **draw a shape around** — from the panel or from the right-click menu.

**An unfilled shape does not block what is under it.** Draw a box around a text box and the text box is still yours to click; grab the shape by its border. If you want a shape that does block — a solid block of colour — mark it **solid** in the panel.

**Boxes grow as you type.** A note or text box that runs out of room gets taller rather than giving you a scroll bar. Drag its resize handle to set a height yourself and it stays exactly where you put it.

**Real work goes on the board too.** The **pool** on the right lists everything the project holds — its tasks, its budgets, its documents, bookmarks, files and email threads — grouped by kind with a count on each group and a filter box at the top. Drag one onto the canvas, or click it to drop it in the middle. Tick **Show what is already placed** to put a second copy of something down. Those cards are live: a task card turns red when it is overdue, a budget card shows what has been spent against its allotment and turns amber as it nears the limit, and a card whose item has been deleted says so. **Double-click a card** to open the real thing behind it.

**A task card is the task.** Change the status on a task card and the task changes with it — the Tasks tab, the timeline and the project's counts all follow.

**The canvas and the timeline are one plan.** Drag a line between two task cards and it becomes a real dependency — the timeline reschedules and the critical path moves, and the board tells you it has done so. Delete the line and the dependency goes with it.

Editing:

| Action | How |
| --- | --- |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z, or the arrows in the toolbar |
| Duplicate | Ctrl+D |
| Copy / paste | Ctrl+C / Ctrl+V. Copy something outside the board and Ctrl+V pastes that instead |
| Delete | Delete or Backspace |
| Type in the selected item | Enter. Escape stops. Double-click does the same |
| Fit everything on screen | Ctrl+0 |
| Pick a tool | V select, S sticky, T text, R shape, F frame, P pen, E erase |
| Bring to front / send to back | Ctrl+] / Ctrl+[, or the panel |
| Reach something buried | Alt+click the same spot repeatedly to step down through the stack |
| Align and even out spacing | Select two or more items; a bar appears at the bottom |
| Everything else on one item | Right-click it |
| Snap | On by default: a dragged item lines up with its neighbours and a pink guide shows where. The grid button switches to an 8-pixel grid instead |

Freehand ink is decorative. It is stored and drawn and nothing more — never searched, and never read back to Gerry. A drawing is for the people in the room.

**Gerry can work on both.** Ask her for a project's timeline, to schedule a task, to make one task wait on another, or to put notes on the canvas and link them. Asking her to link two task cards sends her to the dependency tool instead, so the loop check always runs.

#### How a project fits with other work

Projects rarely stand alone. On the **Overview** tab, under *How this fits with other work*, link this project to another. Four relationships are available, and each reads as a sentence:

| Link | Meaning |
|------|---------|
| **Depends on** | This project waits for the other one |
| **Gates** | The other project waits for this one, and specifically for a milestone in it |
| **Runs alongside** | The two happen at the same time, with no order between them |
| **Is part of** | This project is contained by the other |

A link shows on both projects, worded from each one's point of view. You need editor rights on the project you are linking from, and access to the project you are linking to.

**Gates.** A gate is the only link that carries a condition. When you create one, pick a milestone in this project; the other project is waiting for it. The gate closes on its own the moment that milestone is marked done, and the owner of the waiting project is notified. Reopen the milestone and the gate reopens. Cancelling the milestone does **not** close the gate — the thing being waited for is never going to happen, so the gate stays open for you to deal with.

If the wait no longer applies, **waive** the gate. A waived gate stops flagging anything and is left alone by the automatic checks until you reinstate it.

**On the timeline,** each gate draws as a vertical line on the day it opens, labelled with the milestone. Any task scheduled to start before it is outlined in amber. Gates never move your dates: the milestone belongs to somebody else's project and may slip or be waived, so the timeline shows you the clash and leaves the decision to you.

**Loops are refused.** If a link would make a project wait, however many steps round, on itself, Little Gerry rejects it and names the projects in the loop.

**A link is not access.** It does widen what Gerry may read: working in this project's conversation, she can see a linked project's goal, its next milestone and whether its gates are clear. She cannot read its tasks, documents or conversations. If you need something from inside a linked project, open that project.

#### The Portfolio

**Projects → Portfolio**, or the Portfolio moon in the Work planet.

Every project you can see, drawn as a card and laid out left to right by what waits on what. Each card carries the project's goal, how much work is open, how much is late, how many gates are still open, and the next milestone with its date. Dependencies and gates are arrows; parallel work is a dashed line; an open gate's arrow moves. Double-click a card to open that project.

A project you cannot see is not on the graph at all. A link running into one is shown without a name, and the header counts them: the kind of relationship is not a secret, but the name of the project on the other end is.

The Portfolio is a view, not an editor. Links are made inside a project, where the person making one has the rights and the context.

#### Who can see a project

Set on the Overview tab. Only the project's owner can change it.

- **Private** — you and nobody else. Other people are not shown the project and are not told it exists.
- **Shared** — the people on the member list, each at the role you gave them: owner, editor, commenter or viewer.
- **Company** — everyone signed in to Little Gerry at your organisation, and **they can edit it**. Opening a project to the firm invites the firm to work in it: anyone can change the canvas, the tasks and the timeline, and can take custody of work. It is a standing setting, so it stays open until you change it. If you want the firm to read a project without touching it, share it with named people as viewers instead. Owner-only decisions — visibility, the member list, releasing held work — stay yours.

New projects start private. Sharing controls who can open a project; it is separate from what Gerry is allowed to read.

#### Sharing a project with someone

On the **Overview** tab, the **People** panel lists everyone on the project. If you own it, you can change that list.

**To add someone,** type their work email address, choose what they should be able to do, and click **Add**:

| Role | What it allows |
|------|----------------|
| **Can view** | Open the project and read it. Change nothing. |
| **Can comment** | Read it, and leave comments. |
| **Can edit** | Do the work: tasks, canvas, timeline, material, notes. |

Ownership is not on that list. Handing a project over is a different act from sharing it, and it is not done from a dropdown.

**A private project opens to Shared** the moment you add the first person. A project that stayed private while carrying a list of members would just be a list of people who cannot get in.

**You can add someone who has never opened Little Gerry.** Their role is written down and waiting for them the first time they sign in with their own account.

**Adding someone grants a role. It does not grant a way in.** They still sign in as themselves, and are still checked at sign-in, every time. For that reason only addresses at your firm can be added — the same list of domains that governs signing in governs sharing, so the two can never drift apart.

To change what someone can do, use the dropdown beside their name. To take them off, click the **✕**; they lose access immediately. The owner cannot be removed or demoted here: a project is never left without one.

**What a shared project carries.** Tasks, canvas, timeline, links and the workroom conversation all travel with it. **Attached documents do not.** Documents are encrypted on the computer they were added to, under a key held by that computer, and cannot be read from another install. If someone else needs a document, send it to them the way you normally would. This is a deliberate limit, not an oversight.

#### Creating a project on the hub

If this computer is connected to the hub (**Settings → The hub**), **New Project** asks where the project should live:

- **On this computer** — yours alone. Nobody else can reach it.
- **On the hub** — others at the firm can be brought in.

The same form asks who should be able to see it. A project made on the hub is the one to use for work you intend to share; a project made on this computer stays here, and adding people to it only reaches people who use this machine.

Your existing workrooms are now projects. Each one kept its title, goal, pinned items, journal and conversation — you now reach them through the project they belong to.

### Creating tasks from Meeting Notes

After summarizing a meeting, click **Extract Actions** → select action items → **Create N Tasks** to add them directly to the board.

---

## The Hub

Your Little Gerry install is yours. The **hub** is the one shared server where the firm keeps the projects it works on together. Connecting lets you see that work from your own machine.

### Connecting

Go to **Settings → The hub → Connect to the hub**. A browser window opens; sign in with your work Google account. You do this once per computer.

If the button is greyed out, this machine hasn't collected the hub sign-in details yet — connect Google first (**Settings → Google Workspace**), then reopen Settings. There is nothing to download or paste in; the app fetches what it needs from the firm's Drive by itself.

You sign in as yourself, not as the app. Everything you look at and everything you change on the hub is recorded under your name.

### Seeing shared work

Open **Projects**. Below your own projects, a **Shared on the hub** area lists the projects the firm has shared with you, with the account you're signed in as. Open one and you get the same project space as a local project — overview, canvas, timeline, tasks, budget, material and chat — marked **On the hub**.

The tabs all work there. Two things differ:

- **The conversation is held on the hub**, so it is shared by everyone on the project. It opens in the app; the attachment box and the conversation list on the left belong to this computer's own chats and are not shown.
- **Material pinned to a hub project lives with the project**, not in your Knowledge Base. Everyone on the project sees every pin. A pinned file whose contents are encrypted on the computer that added it says so — see *Material* above.

If a project you expected isn't listed, either it hasn't been shared with you or your hub connection has lapsed — reconnect from Settings.

### Nothing is copied down

Shared work is read from the hub every time it's drawn on screen. There is no local copy to fall out of date, and **Disconnect** leaves nothing from the hub on your computer.

### Work made in a shared project stays there

Anything created inside a **shared** or **company** project is held by that project from the moment it exists. While it is held:

- only someone with **editor** rights on that project can change it;
- it can't be moved into another project or pulled out into your personal list.

If you try, Little Gerry refuses and says which project is holding it. Releasing something is the project owner's decision, and the release is recorded. Private projects hold nothing — there is nobody to share custody with.

---

## Calendar

Displays your local events and Google Calendar events side by side.

- Use **Today** to jump to the current date
- Use **Sync** (top right, visible when Google is connected) to refresh Google Calendar on demand
- Click any day to see that day's events in detail

---

## Gmail (Inbox, Compose & Replies)

Open **Gmail** from the **Communications** area of the home screen. Requires [Google Workspace](#google-workspace) to be connected.

### Reading your inbox

- Pick a **folder** from the folder dropdown to browse any of Gmail's standard folders — **Inbox**, **Unread**, **Starred**, **Important**, **Sent**, **Drafts**, **Archived**, **Spam**, **Trash**, or **All Mail** — or type a search to run a Gmail search (for example `from:acme.com 510k`).
- Use the **sort** dropdown to order the list: **Newest first** (the default), **Oldest first**, **Sender A–Z**, or **Unread first**.
- **Filter by tag** to see only emails you've filed under a given tag.
- The inbox **refreshes itself every minute** (and immediately when you come back to the app); an open thread updates on its own too.
- The list shows the 30 most recent conversations — click **Load 30 more** at the bottom to reach older mail.
- Click a message to open the full thread. The **newest message is shown at the top**, and every message sits on a clean, readable card so text stays legible in dark mode.
- **Opening a thread marks it read in Gmail**, so the highlight on a new email disappears as soon as you've looked at it here. Use **Mark unread** if you'd rather deal with it later.
- **Long threads open collapsed.** Only the messages you haven't read yet are expanded; everything already read shrinks to a single clickable line showing the sender, the date, and the opening words. Click any line to expand it, or click an open message's header to collapse it again.
- **Gerry summarises the rest of the conversation** in a short paragraph above the messages whenever part of a thread is collapsed — what it's about, what was decided, and who is waiting on what.
- If Gerry has drafted a reply for the thread, it appears at the **top of the thread** under “Waiting for your approval” — approve, edit, or reject it right there.
- For each attachment you can **open it in Google Workspace**, open it with your default app, download it, or click **Add to Knowledge Base** to import it so Little Gerry can reference it later.

### Composing and sending your own email

1. Click **New email**.
2. Choose **Write it myself**, fill in **To**, **Subject**, and your message (your Gmail signature is added automatically), and attach files if needed.
3. Click **Send** — the email is sent immediately from your connected Gmail account. Emails you write yourself do **not** need approval.

### Replies and forwarding

- **Reply** or **Reply all** (Reply all pre-fills the other recipients as Cc) directly from a thread. Your own addresses are never included — including any **send-as alias** on your account, so mail sent to an alias doesn't Cc you back into your own reply.
- **Forward** sends the newest message in the thread on to someone else. Add a note of your own at the top; the original is quoted underneath and its **attachments are carried across** (untick the box if you'd rather send just the text).
- You can also ask Little Gerry to draft a reply — the draft appears **right in the thread** for you to approve, edit, or reject before anything is sent.

### Other actions

- **Mark unread** puts a thread back in the pile so it shows as new again.
- **Move to Trash** to clean up your inbox — available on the open email, and on hover in the list. Deleted mail is recoverable from Gmail for 30 days.
- **Draft selected** asks Little Gerry to draft replies for the emails you tick — each drafted reply lands in **Approvals** for your review.

---

## Email Drafts

Navigate to **Email Drafts** in the sidebar → **New Email Draft**.

1. Fill in the **topic**, **recipient context**, and any **key points**
2. Click **Generate** — Little Gerry drafts the email using Claude
3. Review and edit the draft

When you're ready, **submit the draft for approval** — the card then shows **Approve & Send** and **Reject** buttons right there, so you can send it without leaving the page (it also appears in the approvals drawer and notifications like any other approval). Approving sends the email from your connected Gmail account. If an approved email can't be sent (for example it's missing a recipient), it's returned here as an editable draft with a note explaining why, so you can fix it and resubmit.

> You can also compose and send email directly from the [Gmail composer](#gmail-inbox-compose--replies) without going through drafts.

---

## Meeting Notes

Navigate to **Meeting Notes** in the sidebar.

### Automatic meeting capture

When enabled, Little Gerry watches for video-call apps (Zoom, Teams, Google Meet, and others) and **automatically records the meeting audio while a call is active**, then transcribes and summarizes it into a meeting note — no manual steps.

- Turn auto-recording on or off in **Settings**.
- Audio capture works on **Windows** (system-audio loopback). On other platforms Little Gerry can detect the meeting but can't capture system audio without a virtual audio device.
- A recorder indicator shows when a recording is in progress; you can recover or discard pending recordings from there.

### Live meeting assist

When a call is detected, a **pop-down asks whether you'd like Gerry to follow along** — nothing happens without your OK, and your choices are remembered as next meeting's defaults:

- **Live transcript & notes** — a docked panel follows the conversation, typically 5–10 seconds behind the audio
- **Decode jargon & acronyms** — buzzwords and industry terms are defined in context as quiet cards in the panel
- **Suggest answers — under NDA** — Gerry may draw on company knowledge for suggested answers and says what she used
- **Suggest answers — NOT under NDA** — Gerry is given **no company data at all** (enforced in the code, not just instructions); answers come from public knowledge only and are badged as such
- **Thank-you email afterward** — drafted from real meeting topics to the other party, landing in Email Drafts for your review. Ticking this option lists the exact **outside attendees** it would be addressed to (from the calendar invite); colleagues on any company domain are CC'd, never addressed. If the invite has no outside attendees, the draft is created with an empty To: for you to fill in. The panel announces the drafting the moment the call ends, and the finished draft rings the notification bell with a link

The pop-down shows a best-effort NDA check ("NDA possibly on file: …") but **you** confirm the posture. Cards are whispered suggestions on your screen — Gerry never speaks or sends anything during a meeting. The full recording still becomes a normal meeting note at the end, and you're responsible for any consent-to-record requirements where you are. Names from your calendar are fed into transcription and reconciled afterward, so companies and people transcribe correctly ("In-Q-Tel", not a phonetic lookalike) — the wrap-up notes anything auto-corrected.

### Ask Gerry about a past meeting

Meetings are reachable from chat, not just from this page. Ask "what did we decide with Acme last week?" or "has anyone mentioned sterilization validation in a meeting?" and Gerry searches your meeting notes and transcripts directly — the meeting does not have to be in the Knowledge Base first. Gerry can also explain how meeting capture works, since it now knows the feature exists.

### Manual transcripts

You can also create a note by hand — click **+ New Meeting**:

1. Paste or type the raw meeting transcript
2. Click **Summarize** — Little Gerry generates key decisions, action items, and next steps
3. Click **Extract Actions** → check off the items you want to track → **Create N Tasks**

---

## Regulatory Documents

Navigate to **Regulatory** to track your regulatory document portfolio:
- Design History File (DHF)
- Instructions for Use (IFU)
- 510(k) submission documents
- ISO 13485 procedures and records

### AI Drafting

Hover over any document row → click **AI Draft**. Little Gerry pulls relevant context from the Knowledge Base and generates professional regulatory content. Always review AI-generated regulatory content before use.

---

## Slide Decks

Ask Little Gerry for a presentation in chat — there is no separate page:

```
Build a 10-slide product briefing on VACTOR for a distributor meeting
Make me a board update deck covering Q3 progress and the regulatory path
Put together a demo deck for the suction pressure work
```

She builds a real PowerPoint file in the company house style — the same black background, red accent and type as the company's own deck — and uploads it to your Drive as native **Google Slides**, so you can edit it like any other deck. It's also downloadable straight from the chat. A deck can be built even with Google disconnected; you just get the file instead of the Drive copy.

### She will ask you one question first

**How should the deck be marked?** This is required and never guessed, because getting it wrong either stamps "confidential" on a deck you're about to show outsiders, or leaves a sensitive one unmarked.

| You choose | Every slide shows |
|-----------|-------------------|
| **Open** | *nothing at all* — deliberately unmarked, for an outside audience |
| **Confidential — Internal** | CONFIDENTIAL — INTERNAL |
| **Confidential — Proprietary Information** | CONFIDENTIAL — PROPRIETARY INFORMATION |
| **Confidential — Trade Secret** | CONFIDENTIAL — TRADE SECRET, in red |

### The layouts

Fourteen slide layouts are available — a cover, section breaks, bullet slides, metric cards, profile cards, comparison grids, milestone tracks, big-number slides and more. They're named for their **shape** rather than a business purpose, so the same set works for a fundraise, a product briefing, a demo or a technical review. Gerry picks the layout that suits each slide's content.

Text is measured and flowed rather than poured into fixed boxes, so a long heading shrinks to fit instead of overlapping what's beneath it.

### Changing the look

The deck's colours, fonts, type sizes and the classification wording come from a doc named **Deck Theme** in the shared **PMI Templates** Drive folder — the same folder that holds your document templates. Edit that doc and the next deck picks it up; no update required. If a line in it is wrong (a colour that isn't a hex code, a type size of 9000), Gerry keeps the built-in value and **tells you which lines she ignored**. The layouts themselves are built in and can't be changed from the doc.

### Editing a deck she didn't build

Give Gerry permission for a presentation (see [Letting Gerry edit a Drive file](#letting-gerry-edit-a-drive-file)) and she can change it in place. She can rewrite the text in a box, **add a new text box**, remove a box, **add a whole new slide**, and delete slides.

**Adding a slide** uses the same fourteen layouts she builds decks from, so a slide added to an existing deck is indistinguishable from one she made at the start. Say where it goes ("add a milestone slide after slide 3") or let her put it at the end. She reads the deck's classification mark off the slides already there and applies the same one — she won't ask again or guess.

**Page numbers are corrected automatically** when you add or delete a slide, so the deck doesn't end up with two slide 4s. She only rewrites numbers in the page-number corner, never anything in the body of a slide.

**She styles new text from the theme, not by eye.** You ask for a footnote, a caption, a callout or a heading; the font, size and colour come from the same Deck Theme the builder uses, so an added box matches the slides around it. She is not able to pick her own fonts or colours here — that's deliberate, and it's what stops an added line looking bolted on.

**She won't cover anything up.** Before adding a box she reads where everything on the slide already sits, and a position that would overlap existing text or an image is refused rather than drawn on top. If you ask for a footnote without saying where, she puts it along the bottom margin, above anything already down there.

Rewriting a box keeps that box's own font, size, colour and spacing — see the note under [Letting Gerry edit a Drive file](#letting-gerry-edit-a-drive-file).

---

## Investor Relations

Navigate to **Investor Relations** in the sidebar.

- **Company Snapshot** — key facts about PMI and VACTOR for quick investor reference (stage, TAM, regulatory path, IP status)
- **Regulatory Document Registry** — shows your 510(k), DHF, and spec documents with one-click AI drafting to generate pitch-ready regulatory summaries
- **Recent Research** — quick access to completed research reports relevant to investors
- **Chat with IR Specialist** — opens a new conversation routed directly to the Investor Relations specialist agent, which has deep context on pitch materials, market sizing, and grant research

> AI-generated pitch content is for internal reference only. Never share AI-drafted investor materials without qualified human review.

---

## Google Workspace

Navigate to **Settings → Google Integration**.

### Connecting

1. Click **Connect Google**
2. Your browser opens Google's sign-in page
3. Sign in and grant the requested permissions
4. Return to Little Gerry — status turns green

### What's available once connected

| Service | What Little Gerry can do |
|---------|--------------------------|
| **Gmail** | Read, search, and tag emails; compose & send your own; reply/reply-all/forward; mark read or unread; move to Trash; summarise and collapse long threads; open attachments — see [Gmail](#gmail-inbox-compose--replies) |
| **Google Drive** | Browse folders, read files, import to KB; edit a specific file in place once you allow it — see [Letting Gerry edit a Drive file](#letting-gerry-edit-a-drive-file) |
| **Google Calendar** | Read events, show on Calendar page |
| **Contacts** | Look up contact information |

### Write actions (require your approval)

Sending email or creating calendar events goes through the **Approvals** queue — Little Gerry cannot do these without your explicit sign-off.

### Letting Gerry edit a Drive file

By default Gerry reads your Drive but never changes anything. If you ask her to edit a document — "fix the third bullet in the VACTOR deck", "add a row to the parts sheet" — she asks first:

1. A prompt appears in chat naming **the one file** she wants to edit and why.
2. Click **Allow** and she can edit **that file only**. Every other file in your Drive stays read-only, and the next file needs its own separate permission.
3. Click **Deny** and nothing happens.

What she can edit this way: **Google Docs** (append, find-and-replace, or rewrite), **Google Sheets** (set a cell range or append a row), **Google Slides** (replace text across a deck, rewrite one text box, add a new text box, remove a box, add a whole new slide, or delete a slide), and **plain-text files**. PDFs and images are not editable in place — she'll offer to upload a replacement instead.

**Word, Excel and PowerPoint files are converted first.** A `.docx` or `.xlsx` on Drive can't be edited directly, so Gerry makes a Google copy of it and edits that. She does this herself — you are never asked to open the file and pick *Open with Google Docs*. The copy is a **new file with a new link**, which she gives you; **your original is left exactly as it was**, so if you want the changes in the Word file you'll need to download the edited copy. Your edit permission carries over to it automatically.

**One change at a time, and she shows you it landed.** A find-and-replace changes a single place in the document. If the text she's looking for appears more than once — which it always does on a form, where every blank is the same row of underscores — the edit is refused and she lists each match with the words around it so the right one gets picked. This is deliberate: without it, filling in one blank writes the same answer into every blank. After each change she re-reads the document and reports what it now says at that spot, so a garbled edit is caught immediately rather than reported as done.

**Slide edits keep the slide's look.** When Gerry rewrites a text box, the font, size, colour and spacing that box already had are carried over to the new text, so an edited slide still matches the rest of the deck. If a box mixed styles — one word in a different colour, say — the replacement takes the style of the first run throughout.

> **Editing slides needs a reconnect.** Slides access is new in this release, so it isn't in the permissions you granted earlier. Go to **Settings → Google Integration → Connect Google** once and tick every box. *Creating* a deck needs no reconnect.

**Undo is Google's.** Edits are live the moment she makes them; open the file in Drive and use **File → Version history** to see exactly what changed and roll back.

**Reviewing and revoking.** Every file you've allowed is listed in **Settings → Drive Edit Permissions**, with how many times Gerry has edited it and when it was granted. Click **Revoke** to take the permission away — she loses write access to that file immediately.

**Drafts and the QMS folder.** Gerry normally refuses to open anything with "draft" in its name or anything inside the QMS folder. Allowing her to edit such a file lifts that block for that file alone — she can read it and work on it without asking again, because you already named it and clicked Allow. The folder around it, its neighbours and every other draft stay restricted, she still won't cite it as a source in unrelated work, and revoking the permission restores the block straight away.

**A note on which files qualify.** Google gives Little Gerry write access to files it created itself. If you allow editing on a file that came from elsewhere and Google refuses, reconnect Google Workspace in Settings and tick every permission box — that widens access to your whole Drive. Google can only widen permissions during a fresh connection, never on a refresh.

### Disconnecting

Click **Disconnect Google** in Settings. Your local token is deleted immediately.

---

## Odoo ERP

Open **Odoo ERP** from the home screen to connect your Odoo account.

- The organization URL, database, and your login are pre-filled — you only paste your **Odoo API key**, which is stored **encrypted** on your machine.
- Once connected, Little Gerry can read Odoo data and **propose** ERP actions. Like all write actions, anything that changes Odoo goes through the **Approvals** queue for your sign-off.

---

## Manage Budgets

Navigate to **Manage Budgets** (a moon on the **Enterprise** planet). A personal financial-management aid — **not** the company's official books.

- **Create a budget** with a title, optional allotment, and categories — it's created as a **Google Sheet in the company's shared budgets folder** on Drive, so every budget lives in one known place. You own your sheet and can open it anytime.
- **One ledger, two surfaces**: add, edit, or delete entries in Little Gerry OR directly in Google Sheets — changes reflect in both. The page refreshes automatically while open, and every edit re-checks the sheet first so nothing gets clobbered.
- **Allotments**: set one and watch spending against it with progress bars (amber at 80%, red at 100%).
- **Four statuses on every line** — **Spent** (money gone), **Allocated** (committed but not yet paid), **Collected** (money in), and **Expected** (invoiced but not yet collected). They live in a **Status** column on the sheet, so you can type them there too. **A blank status means Spent**, and so does a word the app does not recognise, so nothing you already have changes meaning and a typo can never quietly remove money from a total.
- **Set money aside before you spend it**: an **Allocated** line reserves money for something committed. What is left is the allotment less spent *and* allocated, so the page can tell you what is genuinely free to promise.
- **Track money owed to you**: **Collected** and **Expected** lines are kept apart from spending and are only shown when there are any, so a plain spending budget stays plain. Income never inflates what you have left to spend, and category totals cover outgoing money only.
- **Filter by status** as well as by category — the chips above the ledger show only the statuses actually in the sheet, with a count.
- **Filter and isolate**: tap the category chips above the ledger to filter it (multi-select, live subtotal), or check specific entries and "Isolate selected" to view just those rows for a reference.
- **Let Gerry help**: a per-budget toggle grants Gerry permission to add and edit entries when you ask in chat ("log $89.99 for the torque wrench against Lab Tools"). She files a line under the right status, so "set aside $5,000 for the enclosure tooling" is recorded as **Allocated**, not spent, and "we invoiced them $12,000 last week" as **Expected**. Edits and deletions also require your explicit confirmation in chat. Reading is always allowed, and you can revoke the grant anytime.
- **Create from chat** too: ask Gerry to set up a budget with an allotment and categories — her write permission still starts OFF until you enable it.
- **The budget watches itself**: crossing 80% or 100% of an allotment raises a notification (once per crossing), categories warn when they hit their caps, and the first scan of each month delivers a rollup of last month's spending. Budgets at 80%+ also appear in the home-screen briefing panel, and workroom digests report pinned budgets whose totals changed since yesterday. All read-only — nudges never touch your sheet.
- **Invoices connect**: ask Gerry to file an invoice from an email ("file the invoice from OVYL's email") — it lands in the company's invoice folder on Drive for the invoice sheet's daily pipeline. If the amount is readable and a budget matches, Gerry suggests the ledger entry on the Assistant page — accept or dismiss, never silent.
- **Linked folders**: link invoice or receipts folders from Drive to any budget. Gerry scans them read-only — reads each PDF/image/CSV (OCR when needed), extracts vendor, date, and amount, picks a category, and totals what she found. Every document becomes a suggestion you review inside the budget (accept, dismiss, or accept all). Your files are never modified or moved.
- **Per-budget automation**: turn on daily folder scans and daily Gmail invoice checks per budget. Accepting a Gmail find files the attachment into your linked invoice folder and logs the entry — nothing ever happens without your accept.
- **Master budgets**: reference any other budget to pull its numbers in — shown live, and optionally as synced "[Budget]" line items in the master's sheet so its totals include the sub-budget on both surfaces. A sub-budget contributes **two** lines, its spend and its allocations, so allocated money stays allocated all the way up the tree.
- **On a project**: attach a budget to a project and everyone on the project can read the whole ledger, allocations included. Only you can change it — see [The Budget tab](#the-budget-tab).
- **Cross-check against Odoo**: every budget has a compare panel — bounce your tracking off live ERP invoices, sales, customers, or bank balances, side by side. Advisory only.
- **Cross-check against Odoo**: ask Gerry to compare a budget's tracking with ERP actuals — an advisory side-by-side, not a reconciliation.
- **Share a budget**: share the Google Sheet with a teammate from Sheets; they paste its link on their Manage Budgets page to follow it read-only.
- **Link an existing spreadsheet** read-only. **Unlinking** a budget never deletes the sheet — it stays on your Drive.

---

## Approvals Queue

Navigate to **Approvals**.

Any action Little Gerry proposes that could have real-world consequences (sending an email, creating a calendar event) appears here first with an AI-generated summary.

- Click **Approve** to execute the action
- Click **Reject** (with an optional comment) to cancel it
- All approvals and rejections are logged in the Audit Trail

---

## Notifications

The bell icon in the sidebar shows unread notifications. Notifications appear for:
- Task assignments and due date reminders
- New approval requests
- AI-generated briefings

Click any notification to navigate to the relevant page.

---

## Settings

Every section on this page starts collapsed — click a heading to open it. A section you have never changed is outlined in amber with a **Review** badge, which clears as soon as you edit something in it. The badge comes back as **New** only when that section has something genuinely new: a new release for **Software Updates** and **What's New**, or a new model in the catalog for **AI Engine** and **Models per Task**. Opening a section to look around does not clear the badge.

### Profile
Update your display name and password.

### AI Engine
- **LLM Provider** — Anthropic (recommended), OpenAI, or Ollama (local)
- **Chat Model** — select the specific model (e.g., `claude-sonnet-4-6`)
- **API Key** — enter and save your Anthropic or OpenAI key
- **Document Embeddings** — select Voyage AI (recommended), OpenAI, or Ollama; enter the key
- **Re-index Now** — appears when the embedding provider or model changes; re-embeds all Knowledge Base documents with live progress
- **LLM ● / Embedding ●** — live API ping status indicators shown inline after saving

### Appearance
Switch between Light, Dark, or System theme. Set your local timezone.

### Writing Voice
Build, edit, upload or remove your personal writing voice profile so Gerry's drafts sound like you — see [Writing Voice](#optional--writing-voice-make-drafts-sound-like-you).

### System Health
Live status of PostgreSQL, the active LLM (with API ping), active embedding provider (with API ping), disk space, and whether a Knowledge Base re-index is needed.

### Backup & Restore
Save everything Little Gerry holds into a single file, and load it back on this or any other computer.

**Making a backup.** The section opens with a summary of what you have — conversations, tasks, documents, how much disk it all comes to. Click **Back up everything** and Little Gerry writes one `.lgbackup` file into `C:\Users\<you>\.pmi-agent\exports`. It contains your database, every document you have imported, chat attachments and generated files. On a large library this takes several minutes; leave the window open. Backups already on this computer are listed underneath, and you can delete old ones from there.

**What a backup does *not* contain.** Your API keys and your Google sign-in are deliberately left out. After restoring you sign back into Google Workspace and paste your keys into **Settings → AI Engine** again.

**Restoring.** Click **Choose a backup file…**, pick the `.lgbackup` file, and check the details Little Gerry reads back from it — when it was made, which version made it, how many documents it holds. Restoring **replaces everything currently in Little Gerry**, so read that screen before confirming. A copy of your current database is taken first, into the same exports folder, in case you picked the wrong file. When it finishes, close Little Gerry and open it again.

**Moving to a new computer.** Make a backup on the old machine, copy the file across, install Little Gerry on the new machine, and load the backup from the very first screen of the setup guide. Your documents are decrypted on the way out and re-encrypted with the new machine's own key on the way in, so they open normally — the encryption key itself never leaves the computer that made it. Little Gerry will tell you the backup came from elsewhere and remind you to reconnect Google and re-enter your keys.

**Uninstalling.** Uninstalling Little Gerry leaves all of this alone. The uninstaller asks whether you also want your data deleted, and the answer is **No** unless you change it. Reinstalling picks up exactly where you left off.

### Updates
Click **Check for Updates** to compare your build against the latest on GitHub. Click **Install Update** to pull the latest version and restart automatically.

### Google Integration
Connect or disconnect your Google account (see [Google Workspace](#google-workspace)).

### The hub
Connect this computer to the firm's shared server, or disconnect it (see [The Hub](#the-hub)).

---

## Updating Little Gerry

**Automatic (default):**
Every time you start Little Gerry it checks for a newer version and, if one is available, installs it for you and applies any database updates before the app opens — so you're always on the latest build without doing anything. The update runs as a background step, so the app will briefly close to swap files and then reopen on its own.

**In-app (on demand):**
Go to **Settings → Updates** → **Check for Updates** → **Install Update**

**Manual:**
Double-click **`Update Little Gerry.bat`** from the install folder

---

## Tips & Example Prompts

### Knowledge Base queries
```
What are the VACTOR suction pressure specifications?
Summarize the current 510(k) regulatory strategy
What ISO 14971 risk controls are documented for VACTOR?
Find all references to battery life in the engineering documents
```

### Drive & Gmail (requires Google connected)
```
Can you see my PMI share drive?
List the contents of the VACTOR regulatory folder
Search my emails for anything from the FDA in the last 30 days
Read the most recent investor update email
```

### Research
```
What portable suction devices have received FDA 510(k) clearance?
Summarize current emergency medicine suction market size
Research ISO 13485 audit requirements for small medical device companies
```

### Tasks & executive assistance
```
What are my open tasks this week?
Create a task to review the VACTOR IFU by end of month
Draft an email to the FDA regarding our 510(k) submission timeline
Generate a VACTOR risk assessment section for ISO 14971
```

### Meetings
```
[Paste a meeting transcript]
"Summarize this meeting and extract all action items"
```

---

*Little Gerry is an AI assistant. All regulatory content, emails, and official documents must be reviewed by qualified personnel before use. Little Gerry cannot take write actions without explicit human approval.*

*Built for Precisian Medical Instruments · VACTOR Program · June 2026*
