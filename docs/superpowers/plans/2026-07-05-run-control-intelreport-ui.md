# Run-control + INTELREPORT UI panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Build the per-case investigation cockpit — a docked Run/Report side panel on the SP-4 graph shell that drives the SP-6 run harness and renders/exports the SP-7 INTELREPORT.

**Architecture:** Renderer-side React (shell + two panels + a pure ReportView + a per-case store + a mount-independent onEvent singleton) plus two small main-side additions (`run:available`, `report:save`). Full spec — **read it, it carries the exact component list, the 5-state Run machine, the data-flow rules, and the per-section test list:** `docs/superpowers/specs/2026-07-05-run-control-intelreport-ui-design.md`.

**Tech Stack:** TypeScript, React 18, Electron main/preload, Vitest (+ jsdom `createRoot` harness). No new deps.

## Global Constraints

- **Commit identity:** author/committer `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`. NEVER emit `Co-Authored-By`, `Signed-off-by`, `Claude-Session`, or any AI-identity trailer.
- **Never stage pre-existing dirty files:** `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, anything under `docs/superpowers/ideation/` or `resources/local-ai/`. Stage only your task's files.
- **Security:** `caseId` passes `ensureUuid` at the `report:save` IPC boundary (path-segment critical); `runId` is a bounded non-UUID filter string (mirror `report-ipc.ts`'s `ensureRunId`). Report evidence `rawRef` renders as text, never a link. No new egress (all IPC loopback), no telemetry.
- **Charter:** the renderer CSP/`frame-src` is a security boundary — render the report as React, NEVER an embedded HTML doc/iframe.
- **Determinism:** no `Date.now`/`Math.random` in pure units (`run-feed.ts`, store reducers). Stable ordering.
- Branch `feat/investigation-cockpit-ui`. TDD: failing test → run (fails) → minimal impl → run (passes) → full `pnpm test` → commit. jsdom component tests mirror `test/x-ghostscrape-cases-sidebar.test.tsx` (createRoot in act(), mocked `window.api`).

---

### Task 1: `investigation:run:available` channel + handler + preload

**Files:** `src/shared/ipc-contracts.ts` (add `investigation.run.available`), `src/main/investigation/ipc.ts` (handle it in `registerInvestigationRunIpc` — `RegisterRunIpcDeps` already has `getBrain`), `src/preload/index.ts` + `src/preload/api.d.ts` (add `run.available()`). Test: `test/investigation-run-available-ipc.test.ts` (reuse `makeHandle` from `test/investigation-run-ipc.test.ts`).

**Produces:** channel `investigation:run:available`; handler returns `getBrain() != null` (Promise<boolean>); preload `run.available: () => Promise<boolean>`.

- [ ] Test: with `getBrain: () => new ScriptedBrain([...])` the handler resolves `true`; with `getBrain: () => null` it resolves `false`. TDD, run suite, commit.

### Task 2: `investigation:report:save` channel + handler + preload

**Files:** `src/shared/ipc-contracts.ts` (add `investigation.report.save`), `src/main/investigation/report-ipc.ts` (second handler; extend `RegisterReportIpcDeps` with `renderPdf: (r: IntelReport) => Promise<Buffer>` and `saveBuffer: (name: string, buf: Buffer) => Promise<string | null>`), `src/main/ipc/register.ts` (wire real deps: `renderPdf = renderIntelReportPdf`, `saveBuffer = (name, buf) => saveBufferWithDialog(getWindow(), name, buf)`), `src/preload/index.ts` + `api.d.ts` (add `report.save`). Test: `test/investigation-report-save-ipc.test.ts`.

**Produces:** channel `investigation:report:save`; handler `save(caseId, opts?: {runId?})` → `ensureUuid(caseId)` (+ `ensureRunId(runId)` when present) → `assembleReport` → `applyNarrative(report, getNarrator())` → `renderPdf(report)` → `saveBuffer('INTELREPORT-<caseId8>.pdf', buf)`; preload `report.save: (caseId, opts?) => Promise<string | null>`.

- [ ] Tests: non-UUID caseId throws `/UUID/i`; a valid caseId calls injected `renderPdf` with the assembled report and `saveBuffer` with its buffer, returns the save path; getNarrator null → template narrative still renders (report save still succeeds). TDD, run suite, commit.

### Task 3: `run-feed.ts` — plain-language feed formatting (pure)

**Files:** Create `src/renderer/modules/investigation-graph/run-feed.ts`. Test: `test/investigation-run-feed.test.ts`.

**Consumes:** `RunEvent` from `@shared/investigation-agent`.
**Produces:** `FeedLine { text: string; severity: 'info'|'action'|'warn'|'done' }`; `formatRunEvent(e: RunEvent): FeedLine`; `appendCapped(feed: FeedLine[], line: FeedLine, cap = 200): FeedLine[]`.

- [ ] Tests: each `RunEvent` kind maps to the documented plain-language line + severity (`action`→"Running <transformId> on <entityValue>" action; `observed`→"Found N new entities" info; `blocked`→"Held back: <reason>" warn; `ask`→the question info; `paused`/`resumed`/`thinking` info; `stopped`/`done` done with reason); `appendCapped` keeps only the last `cap`. Pure, deterministic. TDD, run suite, commit.

### Task 4: per-case run store + mount-independent onEvent singleton

**Files:** Create `src/renderer/state/investigation-run-store.ts` and `src/renderer/state/investigation-run-stream.singleton.ts`. Test: `test/investigation-run-store.test.ts`.

**Consumes:** Task 3 (`formatRunEvent`/`appendCapped`), `RunEvent`.
**Produces:**
- store (zustand, matching the repo's `state/store.ts` pattern) keyed by caseId: state `Record<caseId, { runId: string | null; status: 'idle'|'running'|'paused'|'stopped'|'done'; feed: FeedLine[]; pendingAsk: string | null; available: boolean | null }>`; actions `setAvailable(caseId, b)`, `beginRun(caseId, runId)`, `applyEvent(caseId, e: RunEvent)`, `reset(caseId)`.
- singleton: `startRunStream()` (idempotent) subscribes once to `window.api.investigation.run.onEvent` and, for each `{runId, event}`, routes to the store entry whose `runId === runId` via `applyEvent`; `__resetRunStreamForTest()`.

- [ ] Tests: `applyEvent` folds `action`/`observed` into `feed` (via formatRunEvent), `ask` sets `pendingAsk` + status stays running, `resumed` clears nothing but sets running, `paused`→paused, `stopped`/`done`→terminal status + reason line; **two different caseIds never cross-contaminate** (apply to caseA leaves caseB untouched); the singleton routes an onEvent payload to the right caseId by runId. TDD, run suite, commit.

### Task 5: RunPanel — the 5-state machine

**Files:** Create `src/renderer/modules/investigation-graph/RunPanel.tsx`. Test: `test/investigation-run-panel.test.tsx`.

**Consumes:** the store (Task 4), `run-feed` (Task 3), `window.api.investigation.run.*` (+ `run.available` Task 1), scene nodes for seeds (passed as a prop `nodes: {id,value,type}[]`).
**Produces:** `<RunPanel caseId nodes onOpenReport={(runId?) => void} />` implementing spec §4: unavailable / idle (seed multi-select + objective + budget preset `Quick|Standard|Deep` → RunBudget + Start) / running (feed + Pause/Stop + Authorized-targets) / ask (question + Send) / terminal (status + "Open report").

- [ ] Tests (mock `window.api`; seed the store): `available:false` → renders the calm "reasoning pack" copy, NO Start button; `available:true` idle → Start disabled until a seed is picked AND objective typed, then Start calls `run.start(caseId, [seedId], objective, budget)`; running (store has feed) → feed lines render, Pause calls `run.pause(runId)`, Stop calls `run.stop(runId, reason)`; `pendingAsk` set → prompt renders, Send calls `run.answer(runId, text)`; terminal → "Open report" calls `onOpenReport(runId)`. TDD, run suite, commit.

### Task 6: ReportView + ReportPanel

**Files:** Create `src/renderer/modules/investigation-graph/ReportView.tsx` (pure) and `ReportPanel.tsx`. Test: `test/investigation-report-panel.test.tsx`.

**Consumes:** `IntelReport` from `@shared/investigation-report`, `window.api.investigation.report.{generate,save}`.
**Produces:**
- `<ReportView report={IntelReport} />` — Win98 React: key-actors table (`Actor|Role|Confidence|Attribution|Evidence`, badges not raw scores, `findingBacked:false` shown honestly, truncation footer when `actorTail.shown < total`), findings (claim + confidence badge + evidence text, no links), methodology appendix, quarantined source-stamped narrative (`model` → non-reproducible marker).
- `<ReportPanel caseId runId? />` — scope toggle (This case / This run when runId), Generate → `report.generate(caseId, {runId?})` → ReportView; Export PDF → `report.save(caseId, {runId?})`; empty model → empty state.

- [ ] Tests (mock `window.api.report`): Generate calls `report.generate` with/without runId per the scope toggle and renders a mocked `IntelReport`'s actors/findings/methodology; a `findingBacked:false` actor renders its honest label; truncation footer present when capped; `narrative.source==='model'` shows the non-reproducible marker; `rawRef` renders as text (no `<a href`); Export calls `report.save`; empty `IntelReport` → empty-state copy. TDD, run suite, commit.

### Task 7: Shell — extract GraphPane + InvestigationSidePanel, reshape the module

**Files:** Create `src/renderer/modules/investigation-graph/GraphPane.tsx` (move the current graph body out of `InvestigationGraphModule.tsx`, **behavior-preserving**) and `InvestigationSidePanel.tsx` (Run/Report segmented switch + collapse toggle, composing `RunPanel`/`ReportPanel`); reshape `InvestigationGraphModule.tsx` into the shell `<div flex><GraphPane/><InvestigationSidePanel/></div>`. Test: `test/investigation-graph-render.pw.test.ts` MUST stay green (the extraction is behavior-preserving); add `test/investigation-side-panel.test.tsx`.

**Consumes:** GraphPane keeps the existing `InvestigationGraphModuleProps { caseId }` behavior; SidePanel takes `caseId`, `nodes`, and passes `onOpenReport` from RunPanel to switch to the Report section pre-scoped to the runId.
**Produces:** `<InvestigationSidePanel caseId nodes />` rendering a Run/Report switch (default Run), collapse toggle; the shell composes it beside GraphPane.

- [ ] Run `test/investigation-graph-render.pw.test.ts` → still green after extraction (behavior-preserving). Add a test: the shell renders both the graph SVG and the side panel; the Run/Report switch toggles which panel shows; "Open report" from Run flips to Report. TDD, run suite, commit.

### Task 8: Wire it live — singleton subscription, availability probe, graph→run focus/ignore

**Files:** Modify `InvestigationGraphModule.tsx` (mount: `startRunStream()` once + probe `run.available(caseId)` into the store) and `GraphPane.tsx` (during an active run, the node inspector offers Focus/Ignore → `run.focus`/`run.ignore`). Test: `test/investigation-cockpit-live.test.tsx`.

**Consumes:** store + singleton (Task 4), `run.available` (Task 1), `run.focus`/`run.ignore`.
**Produces:** on shell mount the run stream is subscribed and availability probed; a node's Focus/Ignore (when a run is active) calls the control fns; **unmount persistence** — the store retains feed + runId across a panel unmount/remount.

- [ ] Tests: mounting the shell calls `run.available` and `startRunStream`; feeding an onEvent (via the mocked channel) updates the RunPanel feed; **unmount the panel → remount → the feed + runId survived** (store-backed, proving §6); Focus on a node during an active run calls `run.focus(runId, entityId)`. TDD, run suite, commit.

## Self-review checklist (controller, before adversarial pass)

- Every spec §3–§7 component/behavior maps to a task. ✓
- `report:save` UUID-gates caseId; runId bounded non-UUID; rawRef as text; no iframe (React render).
- `investigation-graph-render.pw.test.ts` still green after the GraphPane extraction.
- Store keyed by caseId (no cross-case bleed); singleton subscribes once; feed survives unmount.
- Full `pnpm test` green; one commit per task, charter author, no trailers.
