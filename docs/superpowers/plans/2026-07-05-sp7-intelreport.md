# SP-7 INTELREPORT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Build the SP-7 INTELREPORT generator — a deterministic, ledger-sourced investigation report (key-actors table + findings + methodology/chain-of-custody appendix) with a boxed optional narrator, exported via the existing offline `printToPDF` path.

**Architecture:** Four small units mirroring `services/export.ts` → `services/report-html.ts`: shared model types, a deterministic assembler (`report.ts`, never calls an LLM), a pure Win98 HTML builder, and a thin Electron PDF renderer over a shared `htmlToPdf` helper. Narrator injected downstream of facts. Full spec: `docs/superpowers/specs/2026-07-05-sp7-intelreport-design.md` — **read it; it carries the exact type definitions, salience formula, relation/type maps, and per-section test lists.**

**Tech Stack:** TypeScript, Electron main, Vitest. No new deps.

## Global Constraints

- **Commit identity:** author/committer `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`. NEVER emit `Co-Authored-By`, `Signed-off-by`, `Claude-Session`, or any AI-identity trailer in author, committer, or message body.
- **Never stage pre-existing dirty files:** `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, anything under `docs/superpowers/ideation/`, anything under `resources/local-ai/`. Stage only the files your task creates/modifies.
- **Determinism (critical path):** no `Date.now()`/`Math.random()`/argless `new Date()` in `report.ts` or `report-html.ts`. Time enters via an injected `now: () => number`; `new Date(now()).toISOString()` is the only allowed conversion (storage boundary). Stable sorts everywhere with explicit tie-breaks.
- **Security:** HTML-escape every untrusted value in `report-html.ts` (entity values, finding claims, objectives, roles, **and model-narrative prose**). `rawRef` renders as text, never a link. `caseId`/`runId` pass `ensureUuid` at the IPC boundary.
- **No egress, no telemetry.** Local reads → offline render only.
- Branch `feat/sp7-intelreport`. TDD: failing test → run (fails) → minimal impl → run (passes) → commit. Run the suite (`pnpm test`) before each task's final commit.

---

### Task 1: Report model types + Narrator interface

**Files:** Create `src/shared/investigation-report.ts`. Test: `test/investigation-report-types.test.ts` (a compile/shape guard — construct a literal `IntelReport` and assert required fields).

**Produces (later tasks consume verbatim):** `ProvenanceRef`, `KeyActor`, `ReportFinding`, `MethodologyEntry`, `NarrativeSections`, `IntelReport`, `Narrator` — exactly the interfaces in spec §4. Import `EntityType, ConfidenceBand, AttributionStatus, ConfidenceResult, RunBudget` from `./investigation-types`.

- [ ] Copy the §4 type block verbatim into the new file.
- [ ] Write a test constructing a minimal `IntelReport` literal + a `NarrativeSections` with `source:'template'`; assert `scope`, `keyActors`, `actorTail`, `narrative?.source` present. Run → passes (types compile). Commit.

### Task 2: Deterministic assembler `assembleReport`

**Files:** Create `src/main/investigation/report.ts`. Test: `test/investigation-report.test.ts`.

**Consumes:** Task 1 types; `listAll` from `../storage/entities`; `listEvidence`/`listFindings`/`getRun` from `./ledger`; `sceneForCase` from `./graph`.
**Produces:** `assembleReport(caseId: string, opts?: { runId?: string; now?: () => number }): Promise<IntelReport>`. Exported named constants `KEY_ACTOR_LIMIT`, `W_FINDING`, `W_DEGREE`, `W_THREAT`, the `relation→label` map, relation-priority list, and `type→label` map (so tests + the reviewer can pin them).

Implement spec §5 exactly: salience `2·bestFindingScore + degree + threatWeight`, tie-break `entityId` asc; role from producing-edge relation (priority list) with type fallback; confidence/attribution from the best referencing finding (`low`/`unattributed`/`findingBacked=false` when none); evidence chain sorted `createdAt` asc then `evidenceId` asc; run-scope filters findings by `Finding.runId===runId`; methodology runs derived from distinct evidence `runId` via `getRun`; `generatedAt = new Date((opts?.now ?? (()=>0))()).toISOString()`.

- [ ] Tests (mock `electron`, `secure-fs`, `entities`, `ledger`, `graph` as the existing investigation tests do — see `test/investigation-run-control.test.ts` for the mock pattern): salience ordering + tie-break; role from `registrant-of`→"Registrant", multi-producer priority, type fallback for a seed; confidence/attribution from best finding; `findingBacked=false`+`low`/`unattributed` when no finding; evidence chain fields + sort; actor↔finding set membership; `runId` filter narrows vs case aggregate; `actorTail.shown<total` past `KEY_ACTOR_LIMIT`; **assemble-twice `toEqual`** (determinism); `generatedAt` from injected `now`.
- [ ] TDD each, run suite, commit.

### Task 3: TemplateNarrator + narrator seam

**Files:** Create `src/main/investigation/narrator.ts`. Test: `test/investigation-narrator.test.ts`.

**Produces:** `class TemplateNarrator implements Narrator` (deterministic; `narrate(report)` returns `{ summary, source:'template' }` restating the model's own counts/top-actors/highest-confidence finding — NO invented entities/numbers). Also `applyNarrative(report, narrator?): Promise<IntelReport>` that resolves to a report with `narrative` set, falling back to `TemplateNarrator` when `narrator` is null OR throws (spec §6 guardrail 4).

- [ ] Tests: `TemplateNarrator` twice → `toEqual`; `source:'template'`; summary contains the entity/finding counts (fact restatement only). `applyNarrative(report, null)` → template. `applyNarrative(report, throwingNarrator)` → template fallback (no throw). TDD, run suite, commit.

### Task 4: Pure HTML builder `buildIntelReportHtml`

**Files:** Create `src/main/investigation/report-html.ts`. Test: `test/investigation-report-html.test.ts`.

**Consumes:** Task 1 types; reuse the existing escape helper used by `services/report-html.ts` (grep it — do NOT hand-roll a second escaper if one exists).
**Produces:** `buildIntelReportHtml(report: IntelReport): string` — self-contained Win98 HTML per spec §7 (header, quarantined source-stamped narrative block, Key Actors table `Actor|Role|Confidence|Attribution|Evidence`, findings, methodology appendix, truncation footer when `actorTail.shown<total`). No external URLs.

- [ ] Tests (pure): a malicious `value`/`claim`/narrative `summary` (`<img src=x onerror=alert(1)>`) appears ESCAPED, not raw; narrative block shows its `source` label + a "non-reproducible" marker when `source==='model'`; a `rawRef` string renders as text (no `<a href`); truncation footer present when capped; output contains no `http://`/`https://`/`file://` resource URLs. TDD, run suite, commit.

### Task 5: Shared `htmlToPdf` helper + `renderIntelReportPdf`

**Files:** Modify `src/main/services/export.ts` (extract the offscreen-window render). Create `src/main/investigation/report-pdf.ts`. Test: `test/investigation-report-pdf.test.ts` (mirror the existing `export.ts` PDF test approach — grep `test/` for how `renderCasePdf` is tested; mock `electron`'s `BrowserWindow`/`app`).

**Produces:** in `export.ts`, `export async function htmlToPdf(html: string): Promise<Buffer>` = the current inline temp-file `loadFile`+`printToPDF`+`finally`-rm+sandbox+30s-timeout body; `renderCasePdf` now calls it (behavior-preserving — its existing test must stay green). In `report-pdf.ts`, `renderIntelReportPdf(report: IntelReport): Promise<Buffer>` = `htmlToPdf(buildIntelReportHtml(report))`.

- [ ] Refactor `renderCasePdf` to call `htmlToPdf`; run its existing test → still green. Write a test asserting `renderIntelReportPdf` calls `htmlToPdf` with the built HTML (spy/mock). TDD, run suite, commit.

### Task 6: IPC `investigation:report:generate` + wiring

**Files:** Modify `src/shared/ipc-contracts.ts` (add `investigation.report.generate: 'investigation:report:generate'`). Create `src/main/investigation/report-ipc.ts` (`registerInvestigationReportIpc({ handle, validateCaseId, now, getNarrator })`). Modify `src/main/ipc/register.ts` (wire it, mirroring `registerInvestigationRunIpc`). Modify `src/preload/api.d.ts` + the preload bridge if run IPC has a preload entry (grep for `investigation.run` in preload). Test: `test/investigation-report-ipc.test.ts` (reuse the `makeHandle` double from `test/investigation-run-ipc.test.ts`).

**Produces:** a `generate(caseId, opts?)` handler that `ensureUuid`s `caseId` (+ `runId` when present), calls `assembleReport` then `applyNarrative(report, getNarrator())`, and returns the `IntelReport`. `getNarrator` injected (returns subsystem-2 narrator if installed, else `TemplateNarrator`).

- [ ] Tests: non-UUID `caseId` throws `/UUID/i`; returns a model with `narrative` set; `getNarrator` returning null → template fallback; a throwing narrator → still returns a report (template). TDD, run suite, commit.

## Self-review checklist (controller, before adversarial pass)

- Every spec §4–§10 requirement maps to a task above. ✓
- No `Date.now`/`Math.random`/argless `new Date()` in `report.ts`/`report-html.ts`.
- Escaper reused (not re-rolled); `rawRef` never a link; UUID-gated IPC.
- `renderCasePdf`'s existing test still green after the `htmlToPdf` extraction.
- Full `pnpm test` green; commit count = one per task, charter author, no trailers.
