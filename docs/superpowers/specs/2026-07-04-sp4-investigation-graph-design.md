# SP-4 — Investigation Graph Canvas — Design

**Date:** 2026-07-04
**Status:** Design (brainstorm complete, all sections approved). Feeds a `writing-plans` implementation plan.
**Belongs to:** the Autonomous OSINT Investigator workstream — sub-project **SP-4** of the decomposition in `2026-07-04-autonomous-osint-investigator-design.md`. **Core** (renderer + main), buildable in `/dcs98`; it stands on the SP-1/SP-2 substrate already merged to main (`fd54fb4`).
**Goal:** Evolve Mind's Eye into a per-case **investigation graph** — a live, streaming, filterable, provenance-inspectable projection of a case's entities + provenance ledger — giving a usable **manual** Maltego-like graph *before* the free-form agent (SP-6) exists.

---

## 1. Scope &amp; boundary

SP-4 renders and streams the investigation graph from the cross-case **entity store** (`src/main/storage/entities.ts`) and the **provenance ledger** (`src/main/investigation/ledger.ts`, SP-2). It adds a minimal **manual** populate surface (add node / draw edge) so the graph is self-contained-valuable in this repo without the subsystem-2 transforms (SP-3). It does **not** implement transforms, the rails guard, or the orchestrator (SP-3/5/6).

The design keeps the **projection logic in one place (main)** and the renderer a dumb applier, so the graph is deterministic and testable, and the streaming channel is exactly what SP-6's agent will later feed.

## 2. Module structure

**Guiding split:** a **separate** Investigation Graph module reusing a **shared render core** extracted from Mind's Eye (the two graphs — memory pool vs case investigation — are genuinely different, but share the no-`<canvas>` SVG rendering).

- **`src/renderer/components/graph-canvas/` (NEW, extracted from Mind's Eye)** — the reusable rendering: SVG scene render (circles/lines/text, **never `<canvas>`** — preserves the mobile-black regression guard), node inspector, pan/zoom, and the existing **draw-a-bond drag gesture**. Mind's Eye is refactored to consume this core (behavior-preserving).
- **`src/renderer/modules/investigation-graph/InvestigationGraphModule.tsx` (NEW)** — per-case module (takes the active `caseId`), registered via the 5-point built-in pattern. Fetches the scene, subscribes to deltas, renders via the shared core, owns the filter panel + manual-add surface.
- **`src/main/investigation/graph.ts` (NEW)** — main-side read model: `buildInvestigationScene`, `diffScenes`, the debounced ledger-append listener, and the per-window watcher registry.
- **IPC:** `investigation:graph(caseId)` (fetch full scene) + `investigation:onGraphDelta` (main→renderer push). Mirrors the chat-stream `emit`/listener pattern.

## 3. Data → scene mapping (pure projection)

`buildInvestigationScene(entities, evidence, findings) → { nodes, edges }` — a **pure, deterministic** projection (no new persistence in SP-4; annotations are *computed each build*, not stored).

**Nodes** = the case's entities, each with three computed annotations:
- **Cluster** — connected-component grouping over the edge set → node **fill color** (distinct per cluster).
- **Role** — from the entity's incident edge relations (registrant / operator / infra / victim…) or a `role` set on a transform's `TransformEntityOut` → node **shape**.
- **Threat/relevance score** — aggregated from the confidence of findings referencing the entity (band → number) → node **size + border weight**; also feeds the threat-score filter.

**Edges** = two sources:
- Ledger `producedEdges` (typed relations like `registrant-of`, `resolves-to`), resolved from `{value,type}` to entity ids.
- **Co-occurrence** edges — entities sharing an evidence record — styled **dashed/thin** so "seen together" reads differently from an asserted relation.

**Determinism (charter):** nodes/edges sorted by stable keys; fixed clustering pass; confidence/score come straight from the ledger (machine-derived, never the model). Same ledger → identical scene → identical layout.

## 4. Streaming plumbing (diff-based, main = source of truth)

1. **Source event:** `ledger.ts` gains a tiny append-notifier firing `{ caseId }` after `appendEvidence` (minimal core addition). SP-6's agent drives the same appends later — no rework.
2. **Recompute + diff (main):** `graph.ts` listens → rebuilds the full scene (cheap for one user's graph) → `diffScenes(lastSent, next) → { added, updated, removed }` (**pure, testable**). `updated` carries nodes whose cluster/score shifted from a new edge, so the renderer never re-derives anything.
3. **Coalesce:** a burst of appends is **debounced (~150 ms, injected timer)** into one rebuild+diff — mirrors the memory live-reindex debounce.
4. **Push (IPC):** `investigation:onGraphDelta` sends the diff via `webContents.send`; main tracks which windows watch which `caseId` and pushes only that case's diffs.
5. **Renderer lifecycle:** mount → `investigation:graph(caseId)` full fetch → render → subscribe → apply deltas (`added`→draw, `updated`→replace, `removed`→drop); unmount → unsubscribe (no leaks), mirroring the Searchlight sweep-stream singleton + chat-stream teardown.

All loopback IPC — **no network, no new egress.**

## 5. Interactions &amp; filters

**Reading (the chain-of-custody payoff):**
- **Click a node → provenance inspector** (shared-core inspector): the entity (type, value, role, cluster, score) + the **findings** referencing it + the **evidence records** that produced it (transform, confidence band, timestamp, raw-output reference). Every node traces to the tool output that created it.
- **Click an edge → its provenance** (which evidence/transform asserted the relation, at what confidence).

**Manual populate (makes SP-4 self-contained here):**
- **Add node** — pick type + value → creates an entity + a `manual` evidence record → streams in as a node (exercises §4 end-to-end).
- **Draw edge** — drag node→node via the reused **draw-a-bond gesture** → a manual edge with a user-set relation.

**Filters — client-side, instant:** the reducer builds the *full* scene (filter-free, so the stream stays deterministic); a separate **pure `applyFilters(scene, filters)`** is a render-time view applied with no IPC per slider tick. Set: **min threat-score** slider, **search** by value, **role / type / cluster** dropdowns, **hide-unconnected**, **co-occurrence-edges** toggle.

Manual writes go to the encrypted ledger (SP-2 `secure-fs`); filters are pure client state — both off the network.

## 6. Testing

**Unit (Vitest, node):**
- `buildInvestigationScene` — entities + evidence(`producedEdges`) → correct nodes/edges; cluster = connected components; role from incident relations; score from findings' confidence; co-occurrence from shared-evidence entities; **determinism** (same ledger → identical scene, stable sort).
- `diffScenes` — added/updated/removed; a new edge shifting a node's cluster/score puts it in `updated`; unchanged → empty diff.
- `applyFilters` — min-threat drops low nodes; role/type/cluster; hide-unconnected drops isolated; co-occurrence toggle; search.
- Debounced append-notifier — a burst of appends coalesces into **one** emit (injected timer — deterministic, no real clock).
- Manual add-node / draw-edge write path — creates the entity + a `manual` evidence record; the next scene includes them (mock `secure-fs` + `entities`, SP-2 ledger-test idiom).

**Playwright render guard** (`test/investigation-graph-render.pw.test.ts`, mirroring `test/minds-eye-render.pw.test.ts`): a fixture scene renders as **plain SVG with no `<canvas>`**; cluster fills + role shapes present in computed styles; click node → provenance inspector opens; **empty graph → inviting message, not a blank/black rect** (the Mind's Eye invariant the shared core must preserve).

**Regression:** the shared-canvas extraction must keep Mind's Eye's existing render test green — the refactor is behavior-preserving.

## 7. Charter alignment

Loopback IPC only (no egress, no telemetry); deterministic projection/diff/filters (stable sort, injected timer — no `Date.now()`/RNG in the reducer); encrypted-at-rest via SP-2's `secure-fs` ledger; the render core keeps the no-`<canvas>` + non-empty-state invariants.

## 8. Decomposition into build units (for the plan)

1. **Extract the shared graph-canvas core** from Mind's Eye (behavior-preserving; Mind's Eye test stays green).
2. **`buildInvestigationScene`** (pure reducer + annotations) + tests.
3. **`diffScenes`** (pure) + tests.
4. **Ledger append-notifier + debounced `graph.ts` recompute** + watcher registry + tests (injected timer).
5. **IPC** (`investigation:graph`, `investigation:onGraphDelta`) + preload wiring.
6. **`InvestigationGraphModule`** — fetch + subscribe + render via shared core; module registration.
7. **`applyFilters`** (pure) + the filter panel UI + tests.
8. **Manual add-node / draw-edge** write path + tests.
9. **Playwright render guard** for the investigation graph.

## 9. Open decisions (resolve in the plan)
- Exact clustering pass (plain connected-components vs a light community split) — start with connected-components; revisit only if it under-clusters.
- Debounce interval (start ~150 ms) and whether very large scenes need server-side pruning (defer; single-user graphs are small).
- Whether the module is surfaced in the OSINT Toolkit launcher or opens only from the case context (lean: case context for now).
