# Little Gerry — User Guide
**AI Executive Assistant for Precisian Medical Instruments**

Build 33 · June 2026

---

## What is Little Gerry?

Little Gerry is your AI Executive Assistant, Chief of Staff, and Knowledge Manager for the VACTOR program. She can:

- Answer questions about your documents and company knowledge
- Search Gmail, Google Drive, and Calendar on your behalf
- Research topics on the web and produce cited reports
- Draft emails, summaries, and regulatory content
- Manage and track tasks and projects
- Keep a full audit trail of all AI actions

**All your data stays on your machine.** Conversations, documents, and tasks are stored locally. API keys are kept in your operating system's secure keychain — not on disk.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Logging In](#logging-in)
3. [AI Configuration (First Time)](#ai-configuration-first-time)
4. [Features at a Glance](#features-at-a-glance)
5. [Talking to Little Gerry](#talking-to-little-gerry)
6. [Knowledge Base](#knowledge-base)
7. [Semantic Search](#semantic-search)
8. [Research](#research)
9. [Tasks & Projects](#tasks--projects)
10. [Calendar](#calendar)
11. [Email Drafts](#email-drafts)
12. [Meeting Notes](#meeting-notes)
13. [Regulatory Documents](#regulatory-documents)
14. [Investor Relations](#investor-relations)
15. [Google Workspace](#google-workspace)
16. [Approvals Queue](#approvals-queue)
17. [Notifications](#notifications)
18. [Settings](#settings)
19. [Updating Little Gerry](#updating-little-gerry)
20. [Tips & Example Prompts](#tips--example-prompts)

---

## Getting Started

### Installation

1. Run **`LittleGerry_Setup.exe`** (or double-click **`Install Little Gerry.bat`** if you have a clean clone)
2. The installer sets up Docker, PostgreSQL, and all required services automatically
3. Launch using the **Little Gerry desktop shortcut** or **`Start Little Gerry.bat`**

### Starting and Stopping

| Action | How |
|--------|-----|
| Start | Double-click the desktop shortcut or `Start Little Gerry.bat` |
| Stop | Close the window (a confirmation dialog appears) or use the system tray → Stop All Services |
| Restart services | Click `···` in the sidebar → Restart Services |

---

## Logging In

Sign in with the email and password you set up during first-run configuration. If you've forgotten your password, contact your system administrator.

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

---

## Features at a Glance

| Module | What it does |
|--------|-------------|
| **AI Chat** | Talk to Little Gerry — she searches your KB, Drive, emails, and the web |
| **Dashboard** | Daily briefing, open tasks, pending approvals, today's meetings |
| **Knowledge Base** | Upload and manage your company documents |
| **Search** | Natural language search across all uploaded documents |
| **Research** | AI-powered web research with cited reports |
| **Tasks** | Kanban board for action tracking |
| **Projects** | Group tasks by project with milestone tracking |
| **Calendar** | Local events + Google Calendar side by side |
| **Email Drafts** | AI-drafted emails for regulatory, investor, and operational use |
| **Meeting Notes** | Paste transcripts → AI generates summaries and action items |
| **Regulatory** | Track DHF, IFU, 510(k), and ISO documents with AI drafting |
| **Investor Relations** | Company snapshot, regulatory proof-points, IR doc registry with AI drafting, and research feed |
| **Approvals** | Human-in-the-loop queue — approve/reject with automatic action execution |
| **Notifications** | Real-time alerts for tasks, approvals, and AI activity |
| **Audit Trail** | Immutable log of every AI action and document change |
| **Settings** | Configure AI providers, appearance, and Google integration |

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

Little Gerry will **never** send an email, create a calendar event, modify a document, or take any write action without putting it in the **Approvals** queue first. You must explicitly approve.

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

## Email Drafts

Navigate to **Emails** → **New Draft**.

1. Fill in the **topic**, **recipient context**, and any **key points**
2. Click **Generate** — Little Gerry drafts the email using Claude
3. Review, edit, and copy the draft before sending from your own email client

> Little Gerry cannot send emails directly. All email sending requires your manual action outside the app.

---

## Meeting Notes

Navigate to **Meeting Notes** → **+ New Meeting**.

1. Paste or type the raw meeting transcript
2. Click **Summarize** — Little Gerry generates:
   - Key decisions
   - Action items
   - Next steps
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
| **Gmail** | Search emails, read message content |
| **Google Drive** | Browse folders, read files, import to KB |
| **Google Calendar** | Read events, show on Calendar page |
| **Contacts** | Look up contact information |

### Write actions (require your approval)

Sending email or creating calendar events goes through the **Approvals** queue — Little Gerry cannot do these without your explicit sign-off.

### Disconnecting

Click **Disconnect Google** in Settings. Your local token is deleted immediately.

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

**In-app (recommended):**
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
