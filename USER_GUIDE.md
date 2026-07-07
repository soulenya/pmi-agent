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
9. [Knowledge Base](#knowledge-base)
10. [Semantic Search](#semantic-search)
11. [Research](#research)
12. [Tasks & Projects](#tasks--projects)
13. [Calendar](#calendar)
14. [Gmail (Inbox, Compose & Replies)](#gmail-inbox-compose--replies)
15. [Email Drafts](#email-drafts)
16. [Meeting Notes](#meeting-notes)
17. [Regulatory Documents](#regulatory-documents)
18. [Investor Relations](#investor-relations)
19. [Google Workspace](#google-workspace)
20. [Odoo ERP](#odoo-erp)
21. [Approvals Queue](#approvals-queue)
22. [Notifications](#notifications)
23. [Settings](#settings)
24. [Updating Little Gerry](#updating-little-gerry)
25. [Tips & Example Prompts](#tips--example-prompts)

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

---

## Features at a Glance

| Module | What it does |
|--------|-------------|
| **AI Chat** | Talk to Little Gerry — she searches your KB, Drive, emails, and the web |
| **Ask Gerry** | One-click "Ask Gerry about this" button on any task, email, file, contact, or event — opens a chat already primed with that item |
| **Dashboard** | Daily briefing, open tasks, pending approvals, today's meetings |
| **Daily Assistant** | A once-a-day scan of your Gmail and Google Tasks that suggests follow-ups and to-dos for you to review |
| **Knowledge Base** | Upload and manage your company documents; Little Gerry can read a whole document in full when you ask her to summarize or analyze it |
| **Search** | Natural language search across all uploaded documents |
| **Research** | AI-powered web research with cited reports |
| **Tasks** | Kanban board for action tracking |
| **Projects** | Group tasks by project with milestone tracking |
| **Calendar** | Local events + Google Calendar side by side |
| **Gmail** | Full inbox — browse standard folders (Inbox, Sent, Drafts, Starred, etc.), sort your mail, read, search, filter by tag, reply/reply-all, move to Trash, open attachments or add them to the Knowledge Base, and compose & send your own emails |
| **Email Drafts** | Ask Little Gerry to draft an email, then approve it to send — or write your own from the Gmail composer |
| **Meeting Notes** | Auto-records and transcribes your video calls, then AI-summarizes them — or paste a transcript manually |
| **Regulatory** | Track DHF, IFU, 510(k), and ISO documents with AI drafting |
| **Investor Relations** | Company snapshot, regulatory proof-points, IR doc registry with AI drafting, and research feed |
| **Approvals** | Human-in-the-loop queue — approve/reject with automatic action execution |
| **Notifications** | Real-time alerts for tasks, approvals, and AI activity |
| **Audit Trail** | Immutable log of every AI action and document change |
| **Odoo ERP** | Connect your Odoo account (API key) so Little Gerry can read and propose ERP actions |
| **Settings** | Configure AI providers, appearance, and Google integration |

> **Finding your way around.** The left sidebar groups these modules into collapsible sections — **Work**, **Knowledge**, **Communications**, **Compliance**, and **Administration** — with **Dashboard**, **Little Gerry**, and **Daily Assistant** pinned at the top. Click a section heading to collapse or expand it; the section you're currently in stays open, a collapsed section shows a small badge if it contains anything pending, and your choices are remembered next time. If you have more items than fit on screen, the list scrolls.

---

## Talking to Little Gerry

Navigate to **AI Assistant** in the sidebar.

- Type your message and press **Enter** (use **Shift+Enter** for a new line without sending)
- Little Gerry streams her response in real time
- When she uses a tool (searching Drive, reading an email, querying the KB), a status indicator appears
- Hover over a conversation in the left panel to rename or archive it
- Click **+** to start a new conversation

### What Little Gerry can do automatically

When Google is connected, Little Gerry calls the appropriate tool immediately — she doesn't just describe what she's about to do:

- "Can you see my PMI share drive?" → lists your Drive contents instantly
- "Any emails about the 510k?" → searches Gmail immediately
- "What's on my calendar this week?" → fetches calendar events immediately
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

---

## Daily Assistant

The **Daily Assistant** runs a quiet, once-a-day scan of your **Gmail** and **Google Tasks** in the background and gathers suggestions — follow-ups you may owe someone, emails that look like they need a reply, and to-dos worth tracking — so nothing slips through the cracks.

- A **briefing panel** is docked on the right side of the home screen (next to the solar system). At a glance it shows **today's schedule**, **unread email**, **tasks due**, **pending approvals**, **suggestions**, and an **Odoo snapshot** (bank balances) — each section links straight to the right page. Collapse or reopen it with the panel button; Little Gerry remembers your choice.
- Open **Daily Assistant** itself from its satellite next to the sun (or the briefing panel header). The badge shows the number of pending suggestions.
- Each suggestion is something to **review** — the assistant never acts on its own. You decide what to do with it.
- Suggestions are generated about **once per day**; the scan runs automatically in the background while the app is open.
- Requires **Google Workspace** to be connected (see [Google Workspace](#google-workspace)) for the email/schedule sections. Without it, the assistant still shows your tasks, approvals, and Odoo data.

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

## Tasks & Projects

### Tasks

Navigate to **Tasks** for the Kanban board.

- **+ New Task** to create a task
- Drag cards between columns: **To Do → In Progress → In Review → Done**
- Click a task card to view details, set due dates, assign priority, and add attachments

### Projects

Navigate to **Projects** to group related tasks, track milestones, and monitor overall progress.

### Creating tasks from Meeting Notes

After summarizing a meeting, click **Extract Actions** → select action items → **Create N Tasks** to add them directly to the board.

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
- Click a message to open the full thread. The **newest message is shown at the top**, and every message sits on a clean, readable card so text stays legible in dark mode.
- If Gerry has drafted a reply for the thread, it appears at the **top of the thread** under “Waiting for your approval” — approve, edit, or reject it right there.
- For each attachment you can **open it in Google Workspace**, open it with your default app, download it, or click **Add to Knowledge Base** to import it so Little Gerry can reference it later.

### Composing and sending your own email

1. Click **New email**.
2. Choose **Write it myself**, fill in **To**, **Subject**, and your message (your Gmail signature is added automatically), and attach files if needed.
3. Click **Send** — the email is sent immediately from your connected Gmail account. Emails you write yourself do **not** need approval.

### Replies

- **Reply** or **Reply all** (Reply all pre-fills the other recipients as Cc) directly from a thread.
- You can also ask Little Gerry to draft a reply — the draft appears **right in the thread** for you to approve, edit, or reject before anything is sent.

### Other actions

- **Move to Trash** to clean up your inbox.
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
| **Gmail** | Read, search, and tag emails; compose & send your own; reply/reply-all; move to Trash; open attachments — see [Gmail](#gmail-inbox-compose--replies) |
| **Google Drive** | Browse folders, read files, import to KB |
| **Google Calendar** | Read events, show on Calendar page |
| **Contacts** | Look up contact information |

### Write actions (require your approval)

Sending email or creating calendar events goes through the **Approvals** queue — Little Gerry cannot do these without your explicit sign-off.

### Disconnecting

Click **Disconnect Google** in Settings. Your local token is deleted immediately.

---

## Odoo ERP

Open **Odoo ERP** from the home screen to connect your Odoo account.

- The organization URL, database, and your login are pre-filled — you only paste your **Odoo API key**, which is stored **encrypted** on your machine.
- Once connected, Little Gerry can read Odoo data and **propose** ERP actions. Like all write actions, anything that changes Odoo goes through the **Approvals** queue for your sign-off.

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

### System Health
Live status of PostgreSQL, the active LLM (with API ping), active embedding provider (with API ping), disk space, and whether a Knowledge Base re-index is needed.

### Updates
Click **Check for Updates** to compare your build against the latest on GitHub. Click **Install Update** to pull the latest version and restart automatically.

### Google Integration
Connect or disconnect your Google account (see [Google Workspace](#google-workspace)).

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
