# SP-7 · INTELREPORT generator — design

**Status:** design (brainstorm complete, awaiting plan)
**Date:** 2026-07-05
**Workstream:** Autonomous OSINT Investigator (whole-vision spec: `2026-07-04-autonomous-osint-investigator-design.md` §10 SP-7)
**Boundary:** CORE (buildable in `/dcs98`). The optional LLM narrator rides subsystem-2; core ships a deterministic fallback so SP-7 is complete and testable with no LLM.

---

## 1. Purpose

Turn the evidence a run (SP-6) accumulates into the ledger (SP-2) into a court-defensible
deliverable: a **key-actors table** (who, role, confidence, evidence) plus a findings list and a
methodology/chain-of-custody appendix, exported to PDF through the existing offline `printToPDF`
path. Prose narrative is optional and boxed — the report's facts and numbers are **machine-derived
from the ledger, never asserted by a model** (charter trust keystone, mirrors SP-6).

## 2. Locked decisions (operator's calls, this brainstorm)

1. **Deterministic report core + optional injected narrator.** `assembleReport` builds the whole
   fact model deterministically from local reads and never calls an LLM. The prose narrative is an
   injected `Narrator` (subsystem-2 model narrator, or the core `TemplateNarrator` fallback) that
   writes *around* facts it cannot alter. Same box as SP-6's `Brain`, positioned downstream.
2. **Scope = case by default, optional `runId` filter.** `assembleReport(caseId, { runId? })`.
   Case scope aggregates every run plus manually-added graph entities; a `runId` narrows all ledger
   reads to that one run and flips `scope` to `'run'`.
3. **Key-actors selection = all entities, ranked by a fixed machine salience formula.** No arbitrary
   "is this an actor" type filter. Role is machine-derived from the producing edge relation. Top-N
   shown; the tail is recorded honestly, never silently dropped.

## 3. Architecture & module boundaries

Four small units, one seam each — mirroring the existing `services/export.ts` → `services/report-html.ts`
split (pure HTML builder + thin Electron PDF renderer).

| File | Responsibility | Depends on |
|------|----------------|-----------|
| `src/shared/investigation-report.ts` | `IntelReport` model types + `Narrator` interface. Pure types, shared main↔renderer. | `investigation-types`, `investigation-graph` |
| `src/main/investigation/report.ts` | `assembleReport(caseId, opts?) → IntelReport`. Deterministic assembler. **Never calls an LLM.** | entity store, SP-2 ledger, SP-4 scene |
| `src/main/investigation/report-html.ts` | pure `buildIntelReportHtml(report) → string`. Win98-styled, offline, unit-testable, no Electron. | (none) |
| `src/main/investigation/report-pdf.ts` | thin `renderIntelReportPdf(report) → Buffer` via the shared `htmlToPdf` helper. | Electron, `report-html` |
| `src/main/investigation/narrator.ts` | `TemplateNarrator` (deterministic core fallback). | `investigation-report` |

**Targeted improvement (in scope):** extract the generic `html → Buffer` render currently inline in
`services/export.ts:renderCasePdf` (OS-temp `loadFile` + `printToPDF` + `finally`-rm + sandbox +
timeout) into a shared `htmlToPdf(html): Promise<Buffer>` helper. Both `renderCasePdf` and
`renderIntelReportPdf` call it — no duplicated offscreen-window/temp-file lifecycle.

**IPC:** `investigation:report:generate(caseId, { runId?, save? })` returns the `IntelReport` model
for on-screen preview; when `save`, writes the PDF via the existing save-dialog path. The
Investigation module's "Generate INTELREPORT" button is a thin follow-on (assembler + HTML + PDF +
IPC are SP-7 core).

## 4. The report model

```ts
// src/shared/investigation-report.ts
import type { EntityType, ConfidenceBand, AttributionStatus, ConfidenceResult, RunBudget } from './investigation-types';

export interface ProvenanceRef {
  evidenceId: string;
  transformId: string;
  transformVersion: string;
  createdAt: string;      // ISO, verbatim from EvidenceRecord.createdAt
  rawRef: string;         // encrypted-blob pointer — chain of custody
  relation?: string;      // the producing edge relation, when this record produced the actor
}

export interface KeyActor {
  entityId: string;
  type: EntityType;
  value: string;
  role: string;                    // machine-derived: producing-edge relation → label, else type label
  cluster: number;                 // from the scene
  salience: number;                // deterministic rank score (§5)
  degree: number;                  // graph centrality
  confidence: ConfidenceBand;      // best band among findings referencing this actor, else 'low'
  attribution: AttributionStatus;  // attribution of that best finding, else 'unattributed'
  findingBacked: boolean;          // false ⇒ graph-present but no finding references it (stated honestly)
  evidence: ProvenanceRef[];       // every evidence record that produced/touched this actor, createdAt asc
  findingIds: string[];
}

export interface ReportFinding {
  id: string;
  claim: string;
  confidence: ConfidenceResult;    // verbatim from Finding
  evidence: ProvenanceRef[];       // resolved from Finding.evidenceIds
  createdAt: string;
}

export interface MethodologyEntry {  // one per in-scope run
  runId: string;
  objective: string;
  budget: RunBudget;
  status: string;
  stopReason?: string;
  actionCount: number;             // actionLog.length
  transformsUsed: string[];        // distinct transformId across the run's evidence, sorted
  createdAt: string;
}

export interface NarrativeSections {
  summary?: string;
  perActor?: Record<string, string>;   // entityId → prose
  source: 'template' | 'model';        // ALWAYS labeled
  model?: string;                       // model id when source === 'model'
}

export interface IntelReport {
  caseId: string;
  runId?: string;                  // set when run-scoped
  scope: 'case' | 'run';
  generatedAt: string;             // new Date(now()).toISOString() — injected now, storage-boundary conversion
  entityCount: number;
  findingCount: number;
  keyActors: KeyActor[];           // salience desc, top-N
  actorTail: { shown: number; total: number };   // honest truncation
  findings: ReportFinding[];       // confidence.score desc, id asc
  methodology: MethodologyEntry[];
  narrative?: NarrativeSections;   // filled by the Narrator, if any
}

export interface Narrator { narrate(report: IntelReport): Promise<NarrativeSections>; }
```

## 5. Deterministic derivations

All four derive from three reads only — entity store, ledger, scene (`sceneForCase`). No LLM, no
clock, no RNG. Scope filtering uses the existing ledger API: `listEvidence(caseId, runId?)` filters
evidence natively; `listFindings(caseId)` returns all case findings, so a run-scoped assemble filters
them in-assembler by `Finding.runId === runId`.

**Salience (key-actor ranking).** Fixed formula over machine signals, weights as named constants:

```
salience(entity) = W_FINDING · bestFindingScore + W_DEGREE · degree + W_THREAT · threatWeight
  bestFindingScore = max Finding.confidence.score over findings referencing the entity, else 0
  degree           = count of scene edges incident to the entity            (centrality)
  threatWeight     = Σ EvidenceSignal.weight over the entity's evidence records
constants: W_FINDING = 2, W_DEGREE = 1, W_THREAT = 1   (documented in report.ts)
tie-break: entityId ascending
```

Top-N shown (`KEY_ACTOR_LIMIT`, e.g. 25); `actorTail = { shown, total }` records the remainder.
**No silent cap** (charter): the HTML renders a truncation footer whenever `shown < total`.

**Role.** Machine-derived, not model-asserted:
1. Find the `EvidenceRecord`(s) that produced this entity (`producedEntityIds ∋ entity`) and the
   `producedEdges` whose `toValue == entity.value` → take the edge `relation`.
2. Map `relation → label` via a fixed table (`registrant-of`→"Registrant", `resolves-to`→"Resolves to",
   `mx-of`→"Mail server", `co-occurs-with`→"Associate", …). Unknown relation → the relation string title-cased.
3. Multiple producing relations → highest-priority per a fixed priority list
   (`registrant-of > owner-of > operates > resolves-to > mx-of > co-occurs-with`), tie-break lexical.
4. No producing edge (seed or manual entity) → `type → label` map (`person`→"Person",
   `domain`→"Domain", `email`→"Email address", `username`→"Username", …).

**Confidence / attribution.** From the highest-`score` `Finding` referencing the actor (verbatim
`band` + `attribution`). No finding references it → `band='low'`, `attribution='unattributed'`,
`findingBacked=false` — surfaced honestly in the table (graph-present, not finding-backed).

*Actor↔finding membership* is pure set logic: actor `E` is referenced by finding `F` iff `E.entityId`
appears in `inputEntityId` or `producedEntityIds` of any `EvidenceRecord` in `F.evidenceIds`.

**Evidence chain (`ProvenanceRef[]`).** Every `EvidenceRecord` with `inputEntityId == actor` or
`producedEntityIds ∋ actor` → `{ evidenceId, transformId, transformVersion, createdAt, rawRef, relation? }`,
sorted `createdAt` asc then `evidenceId` asc. This is the chain of custody: transform + version +
timestamp + encrypted-blob pointer.

**Methodology.** No `listRuns` exists in the ledger, so derive the in-scope run set from distinct
`runId` across the in-scope evidence (or just the filter `runId` when run-scoped), then `getRun(caseId,
runId)` each. One `MethodologyEntry` per run; `transformsUsed` = distinct `transformId` over that
run's evidence, sorted. (The plan may instead add a `listRuns(caseId)` ledger read; deriving from
evidence needs no new API and is the default.)

**`generatedAt`** = `new Date(now()).toISOString()` from the caller-supplied `now: () => number`
(storage-boundary conversion, charter-allowed). No `Date.now()` in the assembler.

## 6. The Narrator seam

Injected and boxed like SP-6's `Brain`, positioned **downstream** of the facts — by the time
`narrate()` runs, every claim/confidence/evidence ref is already fixed in the model.

1. **Prose is structurally quarantined.** The HTML puts every narrative block under an explicit
   "Analyst narrative — interpretation, not evidence" heading, visually distinct from the tables.
2. **Source is always stamped.** `source: 'template' | 'model'` (+ `model` id) renders inline.
3. **Facts stay reproducible even when prose isn't.** `TemplateNarrator` (core) is deterministic —
   pure restatement of the model's own numbers. A `model` narrator is *not* reproducible; when
   `source === 'model'` the HTML marks **only that section** non-deterministic; tables stay
   bit-reproducible.
4. **Narrative failure never fails the report.** `getNarrator()` (injected, mirrors SP-6
   `getBrain()`) returns the subsystem-2 model narrator if installed, else `TemplateNarrator`. If the
   model narrator throws/times out, the generate flow catches and falls back to `TemplateNarrator`.
   The facts report always renders offline with zero dependencies.

`TemplateNarrator` output is a restatement only — e.g. summary = "Investigation of case <id>:
{entityCount} entities, {findingCount} findings. Top actors: {actor.value} ({role},
{confidence}/{attribution}), … Highest-confidence finding: {claim} ({band})." — no invented entities
or numbers.

## 7. Export & rendering

`buildIntelReportHtml(report)` — self-contained, offline, Win98-styled:
Header (case, objective, `generatedAt`, scope badge, counts) → Analyst-narrative block (quarantined,
source-stamped) → **Key Actors table** (`Actor | Role | Confidence | Attribution | Evidence`, salience
order; Evidence cell lists each `ProvenanceRef` as `transformId@version · createdAt`; truncation
footer when `actorTail.shown < actorTail.total`) → **Findings** (claim, band+score, evidence) →
**Methodology / provenance appendix** (per-run objective, budget, status/stopReason, action count,
transforms used).

`renderIntelReportPdf(report)` = `htmlToPdf(buildIntelReportHtml(report))`. `htmlToPdf(html)` is the
shared helper extracted from `export.ts`: OS-temp file (**not** the vault — a crash before
`finally`-rm must not strand plaintext), `loadFile`, `printToPDF({ printBackground: true })`,
`javascript:false` sandbox, 30s destroy timeout. Save reuses the case-export save-dialog path.

## 8. Security & charter

- **HTML-escape every untrusted value** — entity values, finding claims, objectives, derived roles,
  **and the model narrative prose especially** (a compromised model narrator could emit markup).
  (Ref: renderer-XSS memory — a green task review is not XSS clearance; escape at the trust boundary.)
- `rawRef` renders as opaque text, never a clickable `file://` link (traversal/deanon).
- `caseId` passes `ensureUuid` at the IPC boundary (mirrors SP-4/SP-6 handlers) — it is a path
  segment on the ledger read side (`caseDir(join(...))`), so it is traversal-critical. `runId` is
  **not** a UUID (SP-6 mints `run-<n>` / `manual` ids) and never becomes a path segment — it is only
  a ledger filter value (`evidence.runId === runId`, `run.id === runId`); it is validated as a
  bounded (1..128), control-char-stripped string, matching the SP-6 run-control channels. UUID-gating
  `runId` would reject every real runId and break run-scoped reports (§2/§5).
- No external resources in the HTML → CSP-safe, fully offline. No network egress: local reads →
  offline render. Consistent with the no-egress charter invariant.
- v1 does **not** persist the report — generate on demand; the exported PDF (user-chosen path) is the
  deliverable, same trust surface as case export today.

## 9. Determinism

No `Date.now`/`Math.random` in assembler or HTML; `now` injected; fixed weight constants; stable
sorts throughout (salience tie-break `entityId` asc; findings `score` desc/`id` asc; evidence
`createdAt` asc/`id` asc; `transformsUsed` sorted). Same case + ledger → byte-identical model and
HTML, **except** a `model`-source narrative section (flagged non-reproducible; tables remain
reproducible).

## 10. Testing

- **`report.test.ts`** (assembler, mocked storage) — salience ordering + tie-break; role from
  producing-edge relation, multi-producer priority, type fallback; confidence/attribution from best
  finding, `low/unattributed`+`findingBacked=false` when none; evidence chain assembled+sorted with
  correct provenance fields; actor↔finding set membership; `runId` filter narrows vs case aggregate;
  honest `actorTail` truncation past the limit; **assemble-twice deep-equal** (determinism);
  `generatedAt` from injected `now`.
- **`report-html.test.ts`** (pure) — escapes a malicious entity value / finding claim / model-narrative
  string; narrative block carries its source label + non-reproducible marker for `model`; `rawRef` is
  text not anchor; truncation footer present when capped; no external URLs.
- **`narrator.test.ts`** — `TemplateNarrator` deterministic (twice → deep-equal), `source:'template'`,
  restates facts only (no invented entities/numbers).
- **`report-ipc.test.ts`** — `generate` rejects non-UUID `caseId` (`ensureUuid`); returns the model;
  `getNarrator()` returns model-narrator if installed else `TemplateNarrator`; a narrator throw falls
  back to `TemplateNarrator` (report still renders).
- **`report-pdf`** — mirror the existing `export.ts` PDF test approach (mocked `BrowserWindow`, or a
  `describe.skip` live-Electron integration), asserting `htmlToPdf` is invoked with the built HTML.

## 11. Out of scope (SP-7)

- The subsystem-2 **model narrator** (prompt design, reasoning-model driver). SP-7 defines the
  `Narrator` interface + the `TemplateNarrator` fallback only.
- Real Tor transforms (SP-3) that produce the evidence — private repo.
- The full Investigation run-control UI; SP-7 ships the "Generate INTELREPORT" IPC + a thin button.
- Persisting generated reports into the vault (deferred; v1 generates on demand).
