# Run-control + INTELREPORT UI panel — design

**Status:** design (brainstorm complete, awaiting plan)
**Date:** 2026-07-05
**Workstream:** Autonomous OSINT Investigator (whole-vision spec: `2026-07-04-autonomous-osint-investigator-design.md`)
**Boundary:** CORE (buildable in `/dcs98`). The renderer surface for SP-6 (run harness) + SP-7 (INTELREPORT). Consumes only IPC that already exists, plus two small main-side additions.

---

## 1. Purpose

Give the per-case investigation a **cockpit**: start and steer an autonomous run (SP-6), watch the graph grow live (SP-4), answer the agent when it asks, and generate/export the deterministic INTELREPORT (SP-7). The report half is fully functional in core today; the run half is a complete, ready UI that lights up when the subsystem-2 reasoning `Brain` is installed and shows a calm, honest state until then.

## 2. Locked decisions (operator's calls, this brainstorm)

1. **One per-case workspace, docked side panel.** The existing `InvestigationGraphModule` becomes a shell: the graph stays center; a docked, collapsible side panel holds two sections — **Run** and **Report**. Graph + run + report stay in view together (the one-clear-surface ADHD-UI constraint — `[[ghostexodus-adhd-ui]]`).
2. **Brain-absent UX = up-front probe + calm state.** A new `investigation:run:available` channel (`getBrain() != null`) is probed on mount; the Run section shows a calm, non-nagging "needs the reasoning pack" card instead of a dead Start button. The Report section works regardless.
3. **Report = plain request/response, React-rendered.** `report.generate` returns a deterministic `IntelReport`; the preview renders it as React components (NOT an embedded HTML doc — the renderer CSP/`frame-src` is a security boundary, `[[dcs98-csp-framesrc-plugin-invariant]]`). PDF export goes through a new `investigation:report:save` channel.

## 3. Architecture & components

Mostly renderer work; two small main-side additions expose capability + PDF export.

**Renderer (new + one refactor):**

| File | Responsibility |
|------|----------------|
| `src/renderer/modules/investigation-graph/InvestigationGraphModule.tsx` | → thin shell: `<GraphPane>` (center) + `<InvestigationSidePanel>` (docked, collapsible). |
| `.../GraphPane.tsx` | The current graph body, extracted **behavior-preserving** (its render test stays green) so the module file doesn't become a god-component. |
| `.../InvestigationSidePanel.tsx` | The dock: a Run/Report segmented switch + collapse toggle. |
| `.../RunPanel.tsx` | Availability probe → start form → live controls + event feed + ask prompt. |
| `.../ReportPanel.tsx` | Scope toggle → Generate → `ReportView` preview → Export PDF. |
| `.../ReportView.tsx` | Pure: renders an `IntelReport` as Win98 React (key-actors table, findings, methodology, narrative). |
| `.../run-feed.ts` | Pure: `formatRunEvent(event) → FeedLine` + capped-feed reducer. |
| `src/renderer/state/investigation-run-store.ts` | Per-`caseId` run UI state (`runId`, status, feed, pendingAsk, available). |
| `src/renderer/state/investigation-run-stream.singleton.ts` | Mount-independent single subscriber to `run.onEvent`, folding events into the store. |

**Main-side (two small additions):**
- `investigation:run:available` → handler returns `getBrain() != null`. Wired in `investigation/ipc.ts` (`registerInvestigationRunIpc`) + preload `run.available()`.
- `investigation:report:save` → in `investigation/report-ipc.ts`, a second handler: `ensureUuid` caseId → `assembleReport` → `applyNarrative` → injected `renderPdf(report)` → injected `saveBuffer(name, buf)` (mirrors case-export `saveBufferWithDialog` at `register.ts:713`; injected deps keep it unit-testable). Preload `report.save(caseId, opts?)`.

All other IPC (`run.{start,pause,resume,stop,addScope,removeScope,focus,ignore,answer,onEvent}`, `report.generate`, `graph`/`onGraphDelta`) already exists and is bound in preload.

## 4. The Run section (state machine)

Five states, each with exactly one clear next action (`[[ghostexodus-adhd-ui]]`):

1. **Unavailable** (`run.available()` false — core today). A calm, one-time card: *"Autonomous runs need the reasoning pack. Once installed, Ghost Intel 98 investigates a seed on its own — fanning out across transforms and growing the graph live. For now you can explore the graph and open the report."* No dead Start button.
2. **Idle** (brain present, no active run). Start form: **seeds** (click-to-add from the graph, or a compact multi-select of scene nodes), an **objective** line, and a **budget preset** (`Quick / Standard / Deep` → concrete `RunBudget`, raw numbers behind a "custom" disclosure). One primary **Start investigation** button, disabled until ≥1 seed + non-empty objective; calls `run.start(caseId, seedIds, objective, budget)`.
3. **Running.** The **live feed** is the center of gravity — each `RunEvent` rendered plain-language via `formatRunEvent` (`action`→"Running WHOIS on evil.tld", never `run-transform whois e1`), auto-scrolling, capped to ~200 lines, pausing auto-scroll when you scroll up. A status line shows a derived action count (honest — counted from events, not fabricated budget numbers). Controls: **Pause/Resume**, **Stop** (with reason), each with optimistic "Pausing…" until the confirming event. A compact **Authorized targets** control (`addScope`/`removeScope`) for `blocked`-on-unauthorized-target; blocked events surface in the feed. From a graph node's inspector during a run: **Focus** / **Ignore** (`run.focus`/`run.ignore`).
4. **Ask** (`{kind:'ask', question}`). The run parks main-side (SP-6); the panel surfaces the question as **the** one prominent action: text input + **Send** (`run.answer`). Nothing else competes while an ask is pending.
5. **Terminal** (`stopped`/`done`). Final status line + one next action: **Open the report**, jumping to the Report section pre-scoped to this `runId`.

## 5. The Report section

- **Scope toggle** — segmented **This case** (default → `report.generate(caseId)`) / **This run** (enabled only when arriving from a terminal run → `report.generate(caseId, {runId})`). Switching re-generates.
- **Generate → preview** — one primary **Generate report** button → `report.generate` → `ReportView` renders the model as Win98 React:
  - **Key Actors table** — `Actor | Role | Confidence | Attribution | Evidence`, salience-ranked; confidence/attribution as plain badges (not raw scores); `findingBacked:false` shown honestly ("graph-present, no finding"); truncation footer whenever `actorTail.shown < total` (no silent cap).
  - **Findings** — claim + confidence badge + evidence refs (`transformId@version · time`, as text, never a link).
  - **Methodology / provenance appendix** — per-run objective, budget, stop reason, transforms used.
  - **Analyst narrative** — quarantined, source-stamped block; `model` source shows the non-reproducible marker.
- **Export PDF** — secondary **Export PDF** action → `report.save(caseId, {runId?})` → main `renderIntelReportPdf` → OS save dialog. Optimistic "Exporting…" feedback.
- **Empty state** — no entities/findings → "Nothing to report yet — run an investigation or add entities to the graph."

## 6. Data flow & state

- **Per-case store, not panel `useState`.** `investigationRunStore` keyed by `caseId`: `{ runId, status, feed[], pendingAsk, available }`. The run executes main-side, so an unmount (tab switch) must not lose the feed/`runId`; the run keeps going and the store greets you on return. Keying by `caseId` is mandatory — a store-level "last run" pointer not scoped to the active case goes stale and blanks the panel (`[[searchlight-panel-unmount-state]]`).
- **Mount-independent singleton subscriber.** `run.onEvent` fans every run's events through one channel as `{runId, event}`. `investigation-run-stream.singleton.ts` subscribes **once** and folds events into the store by `runId` — the same mount-independent pattern Searchlight's sweep-stream singleton uses so a run's feed accrues even while the panel is on another module.
- **One run → two decoupled live streams.** The run appends to the SP-2 ledger, which drives (a) run events → the feed, and (b) `onGraphDelta` (existing SP-4) → the graph re-rendering live in GraphPane. The feed narrates; the graph shows structure; neither depends on the other, and the graph comes alive during a run with zero new wiring.
- **Control is request→event, not optimistic-only.** A button calls the control fn → main mutates the run-controller → it emits the confirming event → singleton → store → panel reflects the confirmed state (a transient hint bridges the gap).
- **Report is request/response.** `ReportPanel` holds `{ report, loading, scope }` locally; a deterministic snapshot of the ledger, regenerated on scope change, not persisted (v1). It reads the same ledger the run populated, so "Open report" after a run just works.
- **Availability** is probed once on shell mount into the store.

## 7. Testing

**Pure units:** `run-feed` (`formatRunEvent` for every `RunEvent` kind + capped reducer); `investigationRunStore` reducers (`applyEvent` folds action/observed → feed, `ask` → pendingAsk, `done`/`stopped` → terminal; two `caseId`s never cross-contaminate).

**Component (jsdom + `createRoot` + mocked `window.api`, mirroring the sidebar tests):**
- RunPanel per state — unavailable renders the calm state with no Start button; idle disables Start until seed+objective then calls `run.start` with the right budget; running renders fed events and Pause/Stop call the control fns; `ask` renders the prompt and Send calls `run.answer`; terminal shows final status and "Open report" scopes Report to `runId`.
- ReportPanel — Generate calls `report.generate(caseId, {runId?})` and `ReportView` renders key-actors/findings/methodology/narrative from a mocked `IntelReport`; scope toggle passes `runId`; `findingBacked:false` rendered honestly; truncation footer when capped; `model`-source non-reproducible marker; Export calls `report.save`; empty model → empty state.
- Unmount persistence — mount → feed events → unmount panel → remount → feed and `runId` survived (proves the store+singleton design).

**Main-side (dependency-light, like the SP-6/SP-7 IPC tests):** `run.available` returns `getBrain() != null`; `report.save` `ensureUuid`s caseId then assemble→narrate→injected `renderPdf`→injected `saveBuffer` (spies asserted), non-UUID caseId throws.

**Charter:** no new egress (all IPC loopback), no telemetry; report stays deterministic (SP-7 guards it). The docked-panel layout is the one genuinely visual piece — flagged for the Windows-VM UI QA gate (`[[preship-windows-ui-qa]]`).

## 8. Out of scope

- The subsystem-2 **LLM `Brain`** (`Brain.decide`) — without it, runs show the unavailable state; the whole UI is otherwise complete and testable via `ScriptedBrain`-style event mocks.
- Real Tor transforms (SP-3) — private repo.
- Persisting generated reports into the vault (deferred; v1 generates on demand, exports to a user path).
- A run **history** browser (past runs list) — v1 shows the current/last run per case; a run picker is a follow-on.
