# Implementation Prompt: Solar System Infinite-Canvas Navigation for Little Gerry

## Context

You are modifying the GUI of **Little Gerry**, an AI executive assistant desktop application for PMI. The stack:

**Frontend**
- React 18 + TypeScript, built with Vite
- Tailwind CSS with shadcn-style components; lucide-react icons
- Zustand for UI state; TanStack React Query for server state
- React Router for navigation
- WebSocket for streaming chat; MediaRecorder for voice capture
- The built frontend runs inside a **pywebview desktop shell** — test animation performance in that embedded WebView, not just a dev browser

**Backend**
- Python 3.14, FastAPI + Uvicorn (REST + WebSockets), SQLAlchemy 2 (async) + Alembic, Pydantic
- Dependency management via **uv** (never pip)

**Database**
- PostgreSQL 16 (Docker, `pmi_postgres`) with pgvector; append-only hash-chained `audit_events` table

**AI / Agents**
- LLM routing across Anthropic (default) / OpenAI / Ollama via `system_settings`; embeddings via Voyage / OpenAI / Ollama
- v1 legacy `AgentExecutor` (typed chat) and v2 LangGraph supervisor with **8 specialists**: executive assistant, research, regulatory, QMS, IR, engineering, operations, House Manager (voice sessions)
- ~36 tools (web search via ddgs, Google Workspace, file generation, custodian tools, etc.)

**Voice**
- Google Cloud Speech-to-Text + Text-to-Speech (MP3, Neural2 voices)

The current UI uses a conventional layout: a top menu bar, a bottom bar, and category tabs with sub-items. The category structure is:

| Category | Sub-items (example: Knowledge) |
|---|---|
| **Little Gerry** (text chat) + **Talk with Little Gerry** (voice) | — |
| Work | (existing sub-items) |
| Knowledge | Knowledge Base, Search, Research, Generated Files |
| Communications | (existing sub-items) |
| Compliance | (existing sub-items) |
| Administration | (existing sub-items) + new **Agents** view (see below) |

Read the existing code (routes, nav components, Zustand stores) to discover the full, exact menu tree. **Do not drop, rename, or reorganize any feature.** Every screen, panel, and function reachable today must remain reachable in the new design.

## Goal

Replace the tab/dropdown navigation with an **infinite-canvas, solar-system metaphor**, while keeping:

1. **All existing functionality** — every current view and feature, wired to the same React Query hooks, WebSocket connections, and API calls.
2. **The top menu bar and bottom bar exactly as they are.** The solar system canvas occupies only the region between them.

## The Solar System Model

### Level 0 — System View (home)

- The **Sun** sits at the center of the canvas. The Sun *is* Little Gerry: it represents both **text chat** and **Talk with Little Gerry** (voice).
- Orbiting the Sun are five **planets**: **Work, Knowledge, Communications, Compliance, Administration** — one planet per current top-level category.
- Planets may idle with a slow, subtle orbital drift (optional; keep it calm and performant). Each planet is clearly labeled.

### Level 1a — Clicking the Sun (Gerry mode)

- Clicking the Sun triggers an **animated zoom** into it.
- This tree exists for one purpose only: **interacting with Little Gerry**. The zoomed view presents the existing text chat (WebSocket streaming) and voice (MediaRecorder → STT/TTS) interfaces — the same components that exist today, hosted in this zoomed state.
- No planets/moons are shown in this mode beyond whatever affordance returns the user to the System View (see Back Navigation).

### Level 1b — Clicking a Planet (category view)

Example: the user clicks the **Knowledge** planet.

1. An **animated zoom** flies toward the planet.
2. Simultaneously, the **Sun slides off to the left edge** so that only a portion of it remains visible (a partial disc/crescent peeking in from the left).
3. The clicked planet settles at the **center** of the canvas.
4. The planet's sub-items become **moons orbiting it** — for Knowledge: **Knowledge Base, Search, Research, Generated Files**. Each moon is labeled.

### Level 2 — Clicking a Moon (sub-tree / content view)

Example: the user clicks the **Research** moon.

1. The same zoom animation plays.
2. The **moon slides to the left** (joining the navigation rail — see below), and the **content of that sub-item opens** in the main area: the actual working UI for that feature (the same React component/route that exists in the current app).
3. If that sub-item has its own children (a deeper sub-tree), those render as the next ring of orbiting objects; otherwise the feature's working interface fills the content area.

### Back Navigation — the Left Rail of Celestial Objects

At every depth, the **left edge of the canvas shows the ancestors** of the current location as partially visible celestial objects, stacked in order:

- In a category view: the **Sun** peeks in from the left. Clicking it zooms back out to the System View (Level 0).
- In a sub-item view: the **Sun** and the **parent planet** are both on the left (Sun outermost/topmost, planet nearest). Clicking the planet returns to that category's view; clicking the Sun returns home.
- This must feel **instinctive** — the left-edge objects ARE the back buttons. No separate back arrow is required (though `Esc` stepping up one level is a nice addition). Hover states should make their clickability obvious (e.g., the object brightens or slides slightly inward).

The reverse animation mirrors the forward one: zooming out, the centered object shrinks back to its orbit while the left-rail ancestor glides back to center.

## New Addition: "Agents" under Administration

This redesign also adds **one new sub-item** (the only change to the menu tree itself):

- Add a new moon called **Agents** orbiting the **Administration** planet, alongside Administration's existing sub-items.
- Opening it (same moon-slides-left interaction as any other sub-item) displays a **directory of all agents in the system**, listing each agent's **name** and a clear description of its **function/role**.
- The known v2 LangGraph roster is the **supervisor plus 8 specialists**: executive assistant, research, regulatory, QMS, IR, engineering, operations, and House Manager (voice sessions). Verify this against the codebase and include the v1 legacy `AgentExecutor` path if it is still user-facing. Derive each description from the agent's actual implementation; flag any you're unsure about rather than inventing capabilities.
- Optionally show which tools each agent can use (from the ~36-tool registry) and its routed model from `system_settings`, if that metadata is cleanly accessible.
- Presentation: a clean card or list layout using the existing Tailwind/shadcn styling. Read-only is acceptable for this iteration — no agent configuration controls are required unless they already exist elsewhere in the app.
- Prefer fetching the roster dynamically from a backend endpoint (add a small FastAPI route + React Query hook if one doesn't exist) so the list stays current; a static list generated from code is an acceptable fallback, clearly marked in comments for future maintenance.

## Technical Approach (React-specific)

- **Navigation state:** model the current location as a path in a Zustand store (e.g., `['knowledge', 'research']`) and mirror it in React Router URLs (e.g., `/knowledge/research`). Both the camera transform and the left rail derive from this single source of truth. This keeps back/forward, deep-linking, and state restore on app restart trivial.
- **Canvas layer:** the solar system can be a React component tree using absolutely positioned elements animated with CSS transforms, or **Framer Motion** (recommended for the choreographed zoom + slide-to-rail transitions via layout animations / `AnimatePresence`). SVG is also viable for orbits. Avoid pulling in a heavy canvas/WebGL engine unless profiling shows it's needed.
- **Feature panels:** existing feature screens remain ordinary React routes/components. When a moon opens, mount the existing component in the content area — do not rewrite feature internals. React Query hooks and WebSocket connections continue to work unchanged.
- **Animations:** ~400–700 ms, eased (cubic-bezier ease-in-out). Animate only `transform` and `opacity` (GPU-composited). Pause idle orbital motion while a content panel is open. Respect `prefers-reduced-motion` by swapping zooms for quick fades.
- **pywebview performance:** the embedded WebView may lag behind a modern dev browser — test transitions inside the actual shell, not just `vite dev` in Chrome.
- **Responsiveness:** the layout adapts to window resizing; orbital radii scale with the viewport between the fixed top and bottom bars.

## Hard Constraints

1. **Zero functionality loss.** Every existing menu item maps to a planet, moon, or deeper object. All existing hooks, WebSocket flows, and API calls keep working.
2. **Top and bottom menus untouched.** Same markup, same behavior, same position. The solar system lives strictly in the region between them.
3. **The Sun's tree is Gerry-only.** Text chat and voice interaction live there and nowhere else.
4. **Deterministic navigation state** — the path-based Zustand + Router model above is required, not optional.
5. **Tooling discipline:** TypeScript throughout, `uv` for any Python dependency changes (never pip), Alembic for any schema changes (none are expected for this work unless the Agents endpoint warrants it — it shouldn't).

## Suggested Implementation Order

1. Inventory the existing menu tree, routes, and feature components; produce a typed map of categories → sub-items → component/route identifiers.
2. Build the canvas layer with camera pan/zoom and a static Sun + 5 planets (no content yet).
3. Implement Level 0 → Level 1 zoom with the sun-to-left-rail animation.
4. Implement moons and Level 1 → Level 2 transitions, mounting the real existing feature components in the content area.
5. Wire the left-rail back navigation, Router sync, and `Esc` handling.
6. Implement the Sun/Gerry zoom mode with the existing chat + voice components.
7. Build the Agents view (backend roster endpoint + React Query hook + card layout).
8. Polish: labels, hover states, idle orbits, reduced-motion, resize handling, and performance testing inside the pywebview shell.

## Acceptance Criteria

- [ ] From launch, the System View shows the Sun centered with 5 labeled planets orbiting.
- [ ] Clicking the Sun zooms into a Gerry-only interaction view (streaming text chat + voice), fully functional.
- [ ] Clicking any planet zooms in, slides the Sun to a partial view on the left, and shows that category's sub-items as orbiting moons.
- [ ] Clicking any moon slides it to the left rail and opens the real, working feature UI for that sub-item.
- [ ] Clicking any left-rail object navigates back to that level with the reverse animation.
- [ ] The Administration planet includes a new **Agents** moon that opens a directory listing every agent with its name and function (supervisor + 8 specialists verified against the code).
- [ ] Navigation state is path-based, synced to React Router URLs, and survives app restart.
- [ ] Top and bottom menus are pixel-identical to the current build and fully functional.
- [ ] No existing feature is missing or broken; all hooks, WebSocket flows, and API calls function as before.
- [ ] Animations are smooth inside the pywebview shell on the target machine; reduced-motion is respected.

Before writing code, read the relevant existing frontend files (router config, nav components, Zustand stores) and confirm the full menu tree and component structure. If any sub-item's children are ambiguous, list what you found and ask before restructuring.
