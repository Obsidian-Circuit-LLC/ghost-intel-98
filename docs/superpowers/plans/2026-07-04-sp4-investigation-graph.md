# SP-4: Investigation Graph Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve Mind's Eye into a per-case, live-streaming, filterable, provenance-inspectable **investigation graph** projected from the SP-2 entity store + provenance ledger — a usable manual Maltego-like graph before the agent (SP-6) exists.

**Architecture:** Extract a domain-neutral graph-canvas render core from Mind's Eye; add a main-side pure projection (`buildInvestigationScene`) + deterministic layout + `diffScenes`; stream diffs on ledger append over a new IPC push channel; a per-case renderer module fetches + subscribes + renders via the shared core, with client-side filters and a manual add-node/draw-edge surface.

**Tech Stack:** TypeScript, Electron main + React renderer, Vitest, Playwright (render guard). Builds on SP-1/SP-2 (merged `fd54fb4`): `src/main/investigation/{ledger,registry,runner,confidence}.ts`, `src/shared/investigation-types.ts`, `src/main/storage/entities.ts`.

## Global Constraints

- **Charter:** loopback IPC only — **no network egress, no telemetry**. All persisted writes go through SP-2's `secure-fs` ledger (encrypted at rest).
- **Determinism:** the reducer, layout, diff, and filters are pure — **no `Math.random`, no `Date.now()`/`new Date()`** in them; timestamps are caller-supplied (`now: string`), the debounce uses an **injected timer**, and all node/edge ordering is a stable sort by id.
- **No `<canvas>`:** the render core draws plain SVG only (mobile-black regression, guarded by `test/minds-eye-render.pw.test.ts` and a new investigation render test). Empty graph → an inviting message, never a blank/black rect.
- **Behavior-preserving refactor:** extracting the shared core must keep Mind's Eye's existing render test green.
- **Reuse:** IPC follows the `channels.memory.graph` (invoke) + `channels.memory.onProgress` (push) patterns; module registration follows the `registerModule({...})` 5-point pattern; the draw-edge gesture reuses Mind's Eye's existing bond-drag.
- **Commit identity:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; NEVER emit AI-identity trailers. Stage only each task's files; never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/`, or `resources/local-ai/ollama*` (gitignored).
- **TDD:** failing test → verify fail → minimal impl → verify pass → commit. `pnpm test <file>`; `pnpm typecheck` stays clean (both configs).

## File Structure

- `src/shared/investigation-graph.ts` *(NEW)* — scene types crossing IPC: `InvNode`, `InvEdge`, `InvestigationScene`, `SceneDelta`, `GraphFilters`.
- `src/main/investigation/scene.ts` *(NEW)* — `buildInvestigationScene`, connected-components clustering, deterministic `layoutScene`.
- `src/main/investigation/scene-diff.ts` *(NEW)* — `diffScenes`.
- `src/main/investigation/graph.ts` *(NEW)* — case scene assembler (reads entities + ledger), debounced append-driven emitter, per-window watcher registry.
- `src/main/investigation/ledger.ts` *(MODIFY)* — add an append-notifier.
- `src/renderer/components/graph-canvas/svg-scene.ts` *(NEW, from `minds-eye/svg-graph.ts`)* — generalized `toSvgScene(RenderGraph, view)`.
- `src/renderer/components/graph-canvas/GraphCanvas.tsx` *(NEW, extracted from `MindsEyeModule.tsx`)* — SVG render + inspector + pan/zoom + draw-bond gesture, over a `RenderGraph`.
- `src/renderer/modules/minds-eye/MindsEyeModule.tsx` *(MODIFY)* — consume `GraphCanvas`; map `MemoryGraphShape`→`RenderGraph`.
- `src/renderer/modules/investigation-graph/InvestigationGraphModule.tsx` *(NEW)* — per-case module; fetch + subscribe + render + filters + manual add.
- `src/renderer/modules/investigation-graph/filters.ts` *(NEW)* — pure `applyFilters`.
- `src/main/ipc/register.ts`, `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/renderer/modules/register-builtins.tsx` *(MODIFY)* — IPC + preload + registration.
- Tests: `test/investigation-scene.test.ts`, `test/investigation-scene-diff.test.ts`, `test/investigation-graph-emitter.test.ts`, `test/investigation-filters.test.ts`, `test/investigation-manual-add.test.ts` *(NEW)*, `test/investigation-graph-render.pw.test.ts` *(NEW)*.

---

### Task 1: Generalize the render core into a shared graph-canvas

**Files:**
- Create: `src/renderer/components/graph-canvas/svg-scene.ts` (from `src/renderer/modules/minds-eye/svg-graph.ts`)
- Modify: `src/renderer/modules/minds-eye/MindsEyeModule.tsx` (map `MemoryGraphShape`→`RenderGraph`, import from the new location)
- Test: `test/graph-canvas-svg-scene.test.ts` (NEW)

**Interfaces:**
- Produces: `RenderGraphNode { id: string; x: number; y: number; strength: number; cls: string; label: string }`, `RenderGraphEdge { source: string; target: string; cls: string }`, `RenderGraph { nodes: RenderGraphNode[]; edges: RenderGraphEdge[] }`, and `toSvgScene(graph: RenderGraph, view: { w: number; h: number }): SvgScene` (unchanged `SvgScene`/`SvgSceneNode`/`SvgSceneEdge`/`SvgSceneLabel` shapes, re-exported).

**Why:** `svg-graph.ts`'s `toSvgScene` currently takes a memory-specific `MemoryGraphShape` and derives `cls` from `kind`/`pinned`/`conflict`. Generalizing to a `RenderGraph` where each node/edge carries a precomputed `cls` decouples the render math from any one domain, so both Mind's Eye and the investigation graph reuse it. Mind's Eye maps its shape to `RenderGraph` producing the identical `cls` strings — behavior-preserving.

- [ ] **Step 1: Write the failing test.** `test/graph-canvas-svg-scene.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toSvgScene, type RenderGraph } from '../src/renderer/components/graph-canvas/svg-scene';

const g: RenderGraph = {
  nodes: [
    { id: 'a', x: 0, y: 0, strength: 0, cls: 'inv-node cluster-0', label: 'A' },
    { id: 'b', x: 10, y: 10, strength: 1, cls: 'inv-node cluster-1', label: 'B' },
  ],
  edges: [{ source: 'a', target: 'b', cls: 'edge-relation' }],
};

describe('toSvgScene (generic RenderGraph)', () => {
  it('carries node cls through and produces finite coordinates', () => {
    const s = toSvgScene(g, { w: 400, h: 300 });
    expect(s.nodes.map((n) => n.cls)).toEqual(['inv-node cluster-0', 'inv-node cluster-1']);
    expect(s.nodes.every((n) => Number.isFinite(n.cx) && Number.isFinite(n.cy) && Number.isFinite(n.r))).toBe(true);
    expect(s.edges[0].cls).toBe('edge-relation');
    expect(s.edges[0]).toMatchObject({ source: 'a', target: 'b' });
  });
  it('a single node collapses to center (no NaN)', () => {
    const s = toSvgScene({ nodes: [{ id: 'x', x: 5, y: 5, strength: 0.5, cls: 'c', label: 'X' }], edges: [] }, { w: 400, h: 300 });
    expect(s.nodes[0].cx).toBe(200);
    expect(s.nodes[0].cy).toBe(150);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test graph-canvas-svg-scene` → FAIL (module not found).

- [ ] **Step 3: Implement.** Copy `src/renderer/modules/minds-eye/svg-graph.ts` to `src/renderer/components/graph-canvas/svg-scene.ts` and change ONLY the input type: remove the `MemoryGraphShape`/`GraphNodeShape` import and the `nodeClass()` helper; add the `RenderGraphNode`/`RenderGraphEdge`/`RenderGraph` interfaces above; change `toSvgScene(graph: RenderGraph, view)` to read `n.cls` directly (instead of `nodeClass(n)`) and `e.cls` directly (instead of `` `edge-${e.kind}` ``). Keep `scaleAxis`, `clamp01`, `PAD/MIN_R/MAX_R`, and the label/edge geometry byte-for-byte. Delete the old `minds-eye/svg-graph.ts`.

- [ ] **Step 4: Update Mind's Eye to map + import.** In `MindsEyeModule.tsx`, replace `import { toSvgScene } from './svg-graph'` with `import { toSvgScene, type RenderGraph } from '../../components/graph-canvas/svg-scene'`. Where it currently passes `graph` (a `MemoryGraphShape`) to `toSvgScene`, first map it:

```ts
const render: RenderGraph = {
  nodes: graph.nodes.map((n) => ({
    id: n.id, x: n.x, y: n.y, strength: n.strength, label: n.label,
    cls: ['node-' + n.kind, n.pinned ? 'pinned' : '', n.conflict ? 'conflict' : ''].filter(Boolean).join(' '),
  })),
  edges: graph.edges.map((e) => ({ source: e.source, target: e.target, cls: 'edge-' + e.kind })),
};
// ...toSvgScene(render, VIEW)
```

(The `cls` strings match the old `nodeClass`/`edge-${kind}` output exactly — behavior-preserving.)

- [ ] **Step 5: Run tests, verify pass.** `pnpm test graph-canvas-svg-scene minds-eye-render` → PASS (the existing Mind's Eye render test MUST stay green); `pnpm typecheck` clean.

- [ ] **Step 6: Commit.** `git add src/renderer/components/graph-canvas/svg-scene.ts src/renderer/modules/minds-eye/MindsEyeModule.tsx test/graph-canvas-svg-scene.test.ts && git rm src/renderer/modules/minds-eye/svg-graph.ts && git commit -m "refactor(graph): generalize svg scene to a domain-neutral RenderGraph (shared canvas core)"`

---

### Task 2: Investigation scene types + reducer + layout

**Files:**
- Create: `src/shared/investigation-graph.ts`
- Create: `src/main/investigation/scene.ts`
- Test: `test/investigation-scene.test.ts`

**Interfaces:**
- Consumes: `EvidenceRecord`, `Finding`, `TransformEdgeOut` (`@shared/investigation-types`); `EntityRecord`, `EntityType` (`@shared/types`).
- Produces (types, in `investigation-graph.ts`): `InvNode { id: string; type: EntityType; value: string; cluster: number; score: number; x: number; y: number }`; `InvEdge { source: string; target: string; relation: string; kind: 'relation' | 'cooccurrence' }`; `InvestigationScene { nodes: InvNode[]; edges: InvEdge[] }`.
- Produces (fn): `buildInvestigationScene(input: { entities: EntityRecord[]; evidence: EvidenceRecord[]; findings: Finding[] }): InvestigationScene` — pure, deterministic.

**Design notes:** nodes = entities referenced by the case's ledger (evidence `inputEntityId` + `producedEntityIds`). Edges: each `producedEdges` `TransformEdgeOut` is resolved from `{value,type}` to entity ids (match `entities` by `type`+`value`), `kind:'relation'`; plus **co-occurrence** edges between entities sharing one evidence record, `kind:'cooccurrence'`, `relation:'co-occurs'`. Cluster = connected components over ALL edges. Score = max finding-confidence band touching the node (`high→1, medium→0.6, low→0.3`, default `0.3`). Layout = deterministic (clusters on a big ring, nodes on a small ring by id hash). Shape/color are derived in the renderer from `type`/`cluster` — the reducer stays pure data.

- [ ] **Step 1: Write the failing test.** `test/investigation-scene.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildInvestigationScene } from '../src/main/investigation/scene';
import type { EntityRecord } from '../src/shared/types';
import type { EvidenceRecord, Finding } from '../src/shared/investigation-types';

const ent = (id: string, type: string, value: string): EntityRecord =>
  ({ id, type: type as never, value, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' });
const ev = (id: string, input: string, produced: string[], edges: EvidenceRecord['producedEdges']): EvidenceRecord =>
  ({ id, runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: input, producedEntityIds: produced, producedEdges: edges, signals: [], rawRef: '', createdAt: 'T' });

describe('buildInvestigationScene (pure projection)', () => {
  const entities = [ent('e1', 'domain', 'evil.tld'), ent('e2', 'email', 'reg@evil.tld'), ent('e3', 'ip', '1.2.3.4')];
  const evidence = [
    ev('ev1', 'e1', ['e2'], [{ fromValue: 'evil.tld', fromType: 'domain', toValue: 'reg@evil.tld', toType: 'email', relation: 'registrant-of' }]),
    ev('ev2', 'e1', ['e3'], [{ fromValue: 'evil.tld', fromType: 'domain', toValue: '1.2.3.4', toType: 'ip', relation: 'resolves-to' }]),
  ];
  const findings: Finding[] = [{ id: 'f1', runId: 'r', claim: 'x', evidenceIds: ['ev1'], confidence: { band: 'high', attribution: 'attributed', score: 4 }, createdAt: 'T' }];

  it('nodes are the entities referenced by the ledger', () => {
    const s = buildInvestigationScene({ entities, evidence, findings });
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['e1', 'e2', 'e3']);
  });
  it('resolves producedEdges (value/type → id) as relation edges', () => {
    const s = buildInvestigationScene({ entities, evidence, findings });
    const rel = s.edges.filter((e) => e.kind === 'relation');
    expect(rel).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'e1', target: 'e2', relation: 'registrant-of' }),
      expect.objectContaining({ source: 'e1', target: 'e3', relation: 'resolves-to' }),
    ]));
  });
  it('everything reachable ends up in one cluster; a finding lifts its node score', () => {
    const s = buildInvestigationScene({ entities, evidence, findings });
    expect(new Set(s.nodes.map((n) => n.cluster)).size).toBe(1);
    expect(s.nodes.find((n) => n.id === 'e2')!.score).toBe(1); // high-band finding via ev1
  });
  it('is deterministic and finite', () => {
    const a = buildInvestigationScene({ entities, evidence, findings });
    const b = buildInvestigationScene({ entities, evidence, findings });
    expect(a).toEqual(b);
    expect(a.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-scene` → FAIL.

- [ ] **Step 3a: Create `src/shared/investigation-graph.ts`:**

```ts
import type { EntityType } from './types';

export interface InvNode { id: string; type: EntityType; value: string; cluster: number; score: number; x: number; y: number }
export interface InvEdge { source: string; target: string; relation: string; kind: 'relation' | 'cooccurrence' }
export interface InvestigationScene { nodes: InvNode[]; edges: InvEdge[] }

/** A streamed diff of a scene (Task 3). */
export interface SceneDelta { added: InvNode[]; updated: InvNode[]; removed: string[]; addedEdges: InvEdge[]; removedEdges: string[] }

/** Client-side view filters (Task 7). `edgeKey(e)` = `${source}->${target}:${relation}`. */
export interface GraphFilters { minScore: number; search: string; type: EntityType | 'all'; cluster: number | 'all'; hideUnconnected: boolean; showCooccurrence: boolean }
```

- [ ] **Step 3b: Implement `src/main/investigation/scene.ts`:**

```ts
import type { EntityRecord, EntityType } from '@shared/types';
import type { EvidenceRecord, Finding } from '@shared/investigation-types';
import type { InvNode, InvEdge, InvestigationScene } from '@shared/investigation-graph';

const BAND_SCORE = { high: 1, medium: 0.6, low: 0.3 } as const;

function hash(s: string): number { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h >>> 0; }

/** Connected-components over an adjacency map; returns id→component index, components numbered by
 *  their lowest-sorted member so the numbering is deterministic. */
function components(ids: string[], adj: Map<string, Set<string>>): Map<string, number> {
  const sorted = [...ids].sort();
  const comp = new Map<string, number>();
  let next = 0;
  for (const start of sorted) {
    if (comp.has(start)) continue;
    const idx = next++;
    const stack = [start];
    comp.set(start, idx);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of [...(adj.get(cur) ?? [])].sort()) if (!comp.has(nb)) { comp.set(nb, idx); stack.push(nb); }
    }
  }
  return comp;
}

/** Deterministic layout: each cluster on a big ring by index; each node on a small ring around its
 *  cluster center, angle from its id hash. Pure — no RNG/clock. */
function layoutScene(nodes: Omit<InvNode, 'x' | 'y'>[]): InvNode[] {
  const clusters = [...new Set(nodes.map((n) => n.cluster))].sort((a, b) => a - b);
  const cx = 500, cy = 500, R = 350, r = 120;
  return nodes.map((n) => {
    const ci = clusters.indexOf(n.cluster);
    const ca = (2 * Math.PI * ci) / Math.max(clusters.length, 1);
    const na = (2 * Math.PI * (hash(n.id) % 360)) / 360;
    return { ...n, x: cx + R * Math.cos(ca) + r * Math.cos(na), y: cy + R * Math.sin(ca) + r * Math.sin(na) };
  });
}

export function buildInvestigationScene(input: { entities: EntityRecord[]; evidence: EvidenceRecord[]; findings: Finding[] }): InvestigationScene {
  const byId = new Map(input.entities.map((e) => [e.id, e]));
  const byKey = new Map(input.entities.map((e) => [`${e.type} ${e.value}`, e.id]));

  // Node set = entities referenced by the ledger.
  const ids = new Set<string>();
  for (const ev of input.evidence) { if (byId.has(ev.inputEntityId)) ids.add(ev.inputEntityId); for (const p of ev.producedEntityIds) if (byId.has(p)) ids.add(p); }

  // Edges: resolved relations + co-occurrence, both deduped by a stable key.
  const edgeMap = new Map<string, InvEdge>();
  const add = (source: string, target: string, relation: string, kind: InvEdge['kind']): void => {
    if (source === target || !ids.has(source) || !ids.has(target)) return;
    const [a, b] = [source, target].sort();
    edgeMap.set(`${a} ${b} ${relation} ${kind}`, { source, target, relation, kind });
  };
  for (const ev of input.evidence) {
    for (const e of ev.producedEdges) {
      const s = byKey.get(`${e.fromType} ${e.fromValue}`); const t = byKey.get(`${e.toType} ${e.toValue}`);
      if (s && t) add(s, t, e.relation, 'relation');
    }
    const present = ev.producedEntityIds.filter((p) => ids.has(p)).sort();
    for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) add(present[i], present[j], 'co-occurs', 'cooccurrence');
  }
  const edges = [...edgeMap.values()].sort((x, y) => (x.source + x.target + x.relation).localeCompare(y.source + y.target + y.relation));

  // Clusters over all edges.
  const adj = new Map<string, Set<string>>();
  for (const id of ids) adj.set(id, new Set());
  for (const e of edges) { adj.get(e.source)!.add(e.target); adj.get(e.target)!.add(e.source); }
  const comp = components([...ids], adj);

  // Score = max band of findings whose evidence touches the node.
  const evTouch = new Map<string, string[]>(); // entityId → evidenceIds
  for (const ev of input.evidence) for (const p of [ev.inputEntityId, ...ev.producedEntityIds]) if (ids.has(p)) (evTouch.get(p) ?? evTouch.set(p, []).get(p)!).push(ev.id);
  const findingByEv = new Map<string, number>(); // evidenceId → best band score
  for (const f of input.findings) { const v = BAND_SCORE[f.confidence.band]; for (const eid of f.evidenceIds) findingByEv.set(eid, Math.max(findingByEv.get(eid) ?? 0, v)); }
  const scoreOf = (id: string): number => { let best = 0.3; for (const eid of evTouch.get(id) ?? []) best = Math.max(best, findingByEv.get(eid) ?? 0); return best; };

  const bare = [...ids].sort().map((id) => ({ id, type: byId.get(id)!.type as EntityType, value: byId.get(id)!.value, cluster: comp.get(id) ?? 0, score: scoreOf(id) }));
  return { nodes: layoutScene(bare), edges };
}
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm test investigation-scene` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/shared/investigation-graph.ts src/main/investigation/scene.ts test/investigation-scene.test.ts && git commit -m "feat(investigation): pure scene reducer (entities+ledger → clustered, laid-out graph)"`

---

### Task 3: `diffScenes`

**Files:**
- Create: `src/main/investigation/scene-diff.ts`
- Test: `test/investigation-scene-diff.test.ts`

**Interfaces:**
- Consumes: `InvestigationScene`, `InvNode`, `InvEdge`, `SceneDelta` (`@shared/investigation-graph`).
- Produces: `diffScenes(prev: InvestigationScene, next: InvestigationScene): SceneDelta` — pure. Node identity = `id`; a node is `updated` if any field (cluster/score/type/value/x/y) changed. Edge identity = `${source} ${target} ${relation} ${kind}`.

- [ ] **Step 1: Write the failing test.** `test/investigation-scene-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffScenes } from '../src/main/investigation/scene-diff';
import type { InvestigationScene } from '../src/shared/investigation-graph';

const N = (id: string, cluster = 0, score = 0.3) => ({ id, type: 'domain' as const, value: id, cluster, score, x: 0, y: 0 });
const scene = (nodes: ReturnType<typeof N>[], edges: InvestigationScene['edges'] = []): InvestigationScene => ({ nodes, edges });

describe('diffScenes', () => {
  it('detects an added node + edge', () => {
    const d = diffScenes(scene([N('a')]), scene([N('a'), N('b')], [{ source: 'a', target: 'b', relation: 'r', kind: 'relation' }]));
    expect(d.added.map((n) => n.id)).toEqual(['b']);
    expect(d.addedEdges).toHaveLength(1);
  });
  it('a changed score/cluster puts the node in updated', () => {
    const d = diffScenes(scene([N('a', 0, 0.3)]), scene([N('a', 1, 1)]));
    expect(d.updated.map((n) => n.id)).toEqual(['a']);
    expect(d.added).toHaveLength(0);
  });
  it('detects removals', () => {
    const d = diffScenes(scene([N('a'), N('b')], [{ source: 'a', target: 'b', relation: 'r', kind: 'relation' }]), scene([N('a')]));
    expect(d.removed).toEqual(['b']);
    expect(d.removedEdges).toHaveLength(1);
  });
  it('identical scenes → empty diff', () => {
    const d = diffScenes(scene([N('a')]), scene([N('a')]));
    expect(d).toEqual({ added: [], updated: [], removed: [], addedEdges: [], removedEdges: [] });
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-scene-diff` → FAIL.

- [ ] **Step 3: Implement `src/main/investigation/scene-diff.ts`:**

```ts
import type { InvestigationScene, InvNode, InvEdge, SceneDelta } from '@shared/investigation-graph';

const edgeKey = (e: InvEdge): string => `${e.source} ${e.target} ${e.relation} ${e.kind}`;
const nodeEq = (a: InvNode, b: InvNode): boolean =>
  a.type === b.type && a.value === b.value && a.cluster === b.cluster && a.score === b.score && a.x === b.x && a.y === b.y;

export function diffScenes(prev: InvestigationScene, next: InvestigationScene): SceneDelta {
  const prevN = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextN = new Map(next.nodes.map((n) => [n.id, n]));
  const added: InvNode[] = [], updated: InvNode[] = [], removed: string[] = [];
  for (const n of next.nodes) { const p = prevN.get(n.id); if (!p) added.push(n); else if (!nodeEq(p, n)) updated.push(n); }
  for (const id of prevN.keys()) if (!nextN.has(id)) removed.push(id);

  const prevE = new Map(prev.edges.map((e) => [edgeKey(e), e]));
  const nextE = new Map(next.edges.map((e) => [edgeKey(e), e]));
  const addedEdges: InvEdge[] = [], removedEdges: string[] = [];
  for (const [k, e] of nextE) if (!prevE.has(k)) addedEdges.push(e);
  for (const k of prevE.keys()) if (!nextE.has(k)) removedEdges.push(k);
  return { added, updated, removed, addedEdges, removedEdges };
}
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm test investigation-scene-diff` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/scene-diff.ts test/investigation-scene-diff.test.ts && git commit -m "feat(investigation): pure scene diff for the graph delta stream"`

---

### Task 4: Ledger append-notifier + debounced graph emitter

**Files:**
- Modify: `src/main/investigation/ledger.ts` (add a notifier fired after `appendEvidence`)
- Create: `src/main/investigation/graph.ts`
- Test: `test/investigation-graph-emitter.test.ts`

**Interfaces:**
- Consumes: `buildInvestigationScene` (Task 2), `diffScenes` (Task 3), `listEvidence` (ledger), `entities.listAll`.
- Produces (ledger.ts): `onLedgerAppend(cb: (caseId: string) => void): () => void` (subscribe, returns unsubscribe).
- Produces (graph.ts): `sceneForCase(caseId: string): Promise<InvestigationScene>`; `startGraphEmitter(deps?: { setTimeoutFn?; clearTimeoutFn? }): void` and `onSceneDelta(caseId: string, cb: (d: SceneDelta) => void): () => void`; `__resetGraphForTest()`.

**Design:** the ledger keeps a tiny in-module listener list; `appendEvidence` fires it with `caseId`. `graph.ts` subscribes; on a fire it **debounces** (150 ms, via injected `setTimeoutFn`) then rebuilds `sceneForCase` (entities + `listEvidence`), diffs against the last-sent scene for that case, and calls each `onSceneDelta` subscriber. Timers are injected so tests are deterministic.

- [ ] **Step 1: Write the failing test.** `test/investigation-graph-emitter.test.ts` (mock `secure-fs` + `entities` as in the SP-2 ledger tests; drive an injected timer):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-invemit-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });
const entities = [{ id: 'e1', type: 'domain', value: 'evil.tld', notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' }];
vi.mock('../src/main/storage/entities', () => ({ async listAll() { return entities; } }));

import { appendEvidence } from '../src/main/investigation/ledger';
import { startGraphEmitter, onSceneDelta, __resetGraphForTest } from '../src/main/investigation/graph';

beforeEach(() => __resetGraphForTest());

describe('graph emitter', () => {
  it('debounces ledger appends into one delta with the new node', async () => {
    let fire: (() => void) | null = null;
    startGraphEmitter({ setTimeoutFn: ((cb: () => void) => { fire = cb; return 1 as never; }) as never, clearTimeoutFn: (() => {}) as never });
    const deltas: unknown[] = [];
    onSceneDelta('caseA', (d) => deltas.push(d));
    await appendEvidence('caseA', { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e1', producedEntityIds: ['e1'], producedEdges: [], signals: [] }, 'raw', 'T');
    await appendEvidence('caseA', { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e1', producedEntityIds: ['e1'], producedEdges: [], signals: [] }, 'raw2', 'T');
    expect(deltas).toHaveLength(0);   // still debounced
    fire!();                           // fire the debounce timer
    await new Promise((r) => setImmediate(r));
    expect(deltas).toHaveLength(1);   // ONE coalesced delta
    expect((deltas[0] as { added: { id: string }[] }).added.map((n) => n.id)).toContain('e1');
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-graph-emitter` → FAIL.

- [ ] **Step 3a: Add the notifier to `ledger.ts`.** At top-level: `const appendListeners = new Set<(caseId: string) => void>(); export function onLedgerAppend(cb: (caseId: string) => void): () => void { appendListeners.add(cb); return () => appendListeners.delete(cb); }`. At the END of `appendEvidence` (after `await write(...)`, before `return full`): `for (const cb of appendListeners) cb(caseId);`.

- [ ] **Step 3b: Implement `src/main/investigation/graph.ts`:**

```ts
import { onLedgerAppend, listEvidence } from './ledger';
import { buildInvestigationScene } from './scene';
import { diffScenes } from './scene-diff';
import * as entities from '../storage/entities';
import type { InvestigationScene, SceneDelta } from '@shared/investigation-graph';

const EMPTY: InvestigationScene = { nodes: [], edges: [] };
type TimerId = ReturnType<typeof setTimeout>;
let setTimeoutFn: (cb: () => void, ms: number) => TimerId = setTimeout;
let clearTimeoutFn: (id: TimerId) => void = clearTimeout;

const subs = new Map<string, Set<(d: SceneDelta) => void>>();
const lastScene = new Map<string, InvestigationScene>();
const pending = new Map<string, TimerId>();
let unsub: (() => void) | null = null;

export function __resetGraphForTest(): void {
  subs.clear(); lastScene.clear(); pending.clear();
  setTimeoutFn = setTimeout; clearTimeoutFn = clearTimeout;
  if (unsub) { unsub(); unsub = null; }
}

export async function sceneForCase(caseId: string): Promise<InvestigationScene> {
  const [all, evidence] = await Promise.all([entities.listAll(), listEvidence(caseId)]);
  return buildInvestigationScene({ entities: all, evidence, findings: [] });
}

async function flush(caseId: string): Promise<void> {
  pending.delete(caseId);
  const next = await sceneForCase(caseId);
  const prev = lastScene.get(caseId) ?? EMPTY;
  lastScene.set(caseId, next);
  const delta = diffScenes(prev, next);
  for (const cb of subs.get(caseId) ?? []) cb(delta);
}

export function startGraphEmitter(deps?: { setTimeoutFn?: typeof setTimeoutFn; clearTimeoutFn?: typeof clearTimeoutFn }): void {
  if (deps?.setTimeoutFn) setTimeoutFn = deps.setTimeoutFn;
  if (deps?.clearTimeoutFn) clearTimeoutFn = deps.clearTimeoutFn;
  if (unsub) return;
  unsub = onLedgerAppend((caseId) => {
    const existing = pending.get(caseId); if (existing) clearTimeoutFn(existing);
    pending.set(caseId, setTimeoutFn(() => { void flush(caseId); }, 150));
  });
}

export function onSceneDelta(caseId: string, cb: (d: SceneDelta) => void): () => void {
  const set = subs.get(caseId) ?? new Set(); set.add(cb); subs.set(caseId, set);
  return () => set.delete(cb);
}
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm test investigation-graph-emitter investigation-ledger` → PASS (existing ledger tests stay green); `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/ledger.ts src/main/investigation/graph.ts test/investigation-graph-emitter.test.ts && git commit -m "feat(investigation): debounced ledger-driven scene emitter + delta subscriptions"`

---

### Task 5: IPC — fetch + delta push

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (add `channels.investigation.{graph,onGraphDelta}` + typed contracts), `src/main/ipc/register.ts` (handle + push), `src/preload/index.ts` + `src/preload/api.d.ts` (renderer api).
- Test: `test/investigation-ipc.test.ts` (contract-level: the handler returns a scene; a delta subscriber receives pushes).

**Interfaces:**
- Consumes: `sceneForCase`, `onSceneDelta`, `startGraphEmitter` (Task 4).
- Produces: `window.api.investigation.graph(caseId): Promise<InvestigationScene>` and `window.api.investigation.onGraphDelta(caseId, cb): () => void`.

- [ ] **Step 1: Write the failing test.** `test/investigation-ipc.test.ts` — unit-test the wiring seam: a `registerInvestigationGraphIpc({ handle, sendToWatchers })` helper (extract the wiring into a testable function) returns the scene from `sceneForCase` and forwards deltas. Assert `handle('investigation:graph','caseA')` resolves to a scene object with `nodes`/`edges`, and that a simulated ledger append (via the emitter) calls `sendToWatchers` with `{ caseId:'caseA', delta }`.

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-ipc` → FAIL.

- [ ] **Step 3: Implement.** In `ipc-contracts.ts` add `investigation: { graph: 'investigation:graph', onGraphDelta: 'investigation:onGraphDelta' }` to `channels`, and contract entries `[channels.investigation.graph]: { args: [string]; returns: InvestigationScene }`. In `register.ts`: `startGraphEmitter()` at init; `safeHandle(channels.investigation.graph, (_e, caseId: string) => sceneForCase(caseId))`; and register `onSceneDelta(caseId, ...)` per watcher window, sending `win.webContents.send(channels.investigation.onGraphDelta, { caseId, delta })` (mirror the `channels.memory.onProgress` push at register.ts:1378). Manage watcher lifecycle by `caseId` (subscribe when the renderer calls a `investigation:watch` — or simplest: the preload subscribes on first `onGraphDelta` and the main sends all deltas, renderer filters by caseId). In `preload/index.ts`: `investigation: { graph: (caseId) => ipcRenderer.invoke(channels.investigation.graph, caseId), onGraphDelta: (caseId, cb) => { const l = (_e, p) => { if (p.caseId === caseId) cb(p.delta); }; ipcRenderer.on(channels.investigation.onGraphDelta, l); return () => ipcRenderer.removeListener(channels.investigation.onGraphDelta, l); } }` (mirror the `memory.onProgress` preload at index.ts:399). Add the `investigation` block to `api.d.ts`.

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-ipc` → PASS; `pnpm typecheck` clean (both configs).

- [ ] **Step 5: Commit.** `git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts test/investigation-ipc.test.ts && git commit -m "feat(investigation): IPC — scene fetch + delta push channel"`

---

### Task 6: `applyFilters` + InvestigationGraphModule (render via shared canvas)

**Files:**
- Create: `src/renderer/modules/investigation-graph/filters.ts`, `src/renderer/modules/investigation-graph/InvestigationGraphModule.tsx`
- Create: `src/renderer/components/graph-canvas/GraphCanvas.tsx` (extracted from `MindsEyeModule.tsx`)
- Modify: `src/renderer/modules/minds-eye/MindsEyeModule.tsx` (consume `GraphCanvas`), `src/renderer/modules/register-builtins.tsx` (register), `src/renderer/modules/icons/Icon.tsx` (glyph if needed)
- Test: `test/investigation-filters.test.ts`

**Interfaces:**
- Consumes: `toSvgScene`/`RenderGraph` (Task 1), `InvestigationScene`/`GraphFilters` (Task 2), `window.api.investigation.*` (Task 5).
- Produces: `applyFilters(scene: InvestigationScene, f: GraphFilters): InvestigationScene` (pure); `<GraphCanvas graph={RenderGraph} onNodeClick onDrawEdge emptyMessage>`; the registered `investigation-graph` module.

- [ ] **Step 1: Write the failing test (filters, pure).** `test/investigation-filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyFilters } from '../src/renderer/modules/investigation-graph/filters';
import type { InvestigationScene, GraphFilters } from '../src/shared/investigation-graph';

const base: GraphFilters = { minScore: 0, search: '', type: 'all', cluster: 'all', hideUnconnected: false, showCooccurrence: true };
const scene: InvestigationScene = {
  nodes: [
    { id: 'a', type: 'domain', value: 'evil.tld', cluster: 0, score: 1, x: 0, y: 0 },
    { id: 'b', type: 'email', value: 'x@evil.tld', cluster: 0, score: 0.3, x: 0, y: 0 },
    { id: 'c', type: 'ip', value: '1.2.3.4', cluster: 1, score: 0.6, x: 0, y: 0 },
  ],
  edges: [{ source: 'a', target: 'b', relation: 'registrant-of', kind: 'relation' }],
};

describe('applyFilters', () => {
  it('minScore drops low nodes (and their now-dangling edges)', () => {
    const r = applyFilters(scene, { ...base, minScore: 0.5 });
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(r.edges).toHaveLength(0); // b filtered → its edge drops
  });
  it('type filter keeps only that type', () => {
    expect(applyFilters(scene, { ...base, type: 'ip' }).nodes.map((n) => n.id)).toEqual(['c']);
  });
  it('hideUnconnected drops isolated nodes', () => {
    expect(applyFilters(scene, { ...base, hideUnconnected: true }).nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
  it('showCooccurrence:false hides co-occurrence edges only', () => {
    const s2: InvestigationScene = { ...scene, edges: [...scene.edges, { source: 'a', target: 'c', relation: 'co-occurs', kind: 'cooccurrence' }] };
    expect(applyFilters(s2, { ...base, showCooccurrence: false }).edges.every((e) => e.kind === 'relation')).toBe(true);
  });
  it('search matches value substring (case-insensitive)', () => {
    expect(applyFilters(scene, { ...base, search: 'EVIL' }).nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-filters` → FAIL.

- [ ] **Step 3a: Implement `filters.ts`:**

```ts
import type { InvestigationScene, GraphFilters } from '@shared/investigation-graph';

export function applyFilters(scene: InvestigationScene, f: GraphFilters): InvestigationScene {
  let nodes = scene.nodes.filter((n) =>
    n.score >= f.minScore &&
    (f.type === 'all' || n.type === f.type) &&
    (f.cluster === 'all' || n.cluster === f.cluster) &&
    (!f.search || n.value.toLowerCase().includes(f.search.toLowerCase())));
  const keep = new Set(nodes.map((n) => n.id));
  let edges = scene.edges.filter((e) => keep.has(e.source) && keep.has(e.target) && (f.showCooccurrence || e.kind !== 'cooccurrence'));
  if (f.hideUnconnected) {
    const connected = new Set<string>(); for (const e of edges) { connected.add(e.source); connected.add(e.target); }
    nodes = nodes.filter((n) => connected.has(n.id));
  }
  return { nodes, edges };
}
```

- [ ] **Step 3b: Extract `GraphCanvas.tsx`** from `MindsEyeModule.tsx`: move the SVG-rendering JSX (`<svg>` with `scene.edges`/`scene.nodes`/`scene.labels`, the click-select inspector, pan/zoom, and the bond-drag `dragFrom`/mousedown/mouseup gesture) into a `GraphCanvas` component taking props `{ graph: RenderGraph; view?: {w,h}; onNodeClick(id): void; onDrawEdge(from: string, to: string): void; renderInspector(id): ReactNode; emptyMessage: string }`. It calls `toSvgScene(graph, view)` internally. `MindsEyeModule` now renders `<GraphCanvas graph={render} onNodeClick=… onDrawEdge={drawBond} renderInspector=… emptyMessage="Nothing remembered yet…" />`, keeping its existing behavior (its render test MUST stay green).

- [ ] **Step 3c: Implement `InvestigationGraphModule.tsx`** — props `{ caseId: string }`. On mount: `const [scene,setScene]=useState<InvestigationScene>({nodes:[],edges:[]})`; `window.api.investigation.graph(caseId).then(setScene)`; subscribe `const off = window.api.investigation.onGraphDelta(caseId, (d)=> setScene((s)=> applyDelta(s,d)))`; `return off` in the effect cleanup. `applyDelta` merges added/updated/removed nodes + addedEdges/removedEdges (a small pure local helper — add `applyDelta(scene, delta)` to `filters.ts` and unit-test it alongside applyFilters). Hold `filters` in state; compute `const visible = applyFilters(scene, filters)`; map `visible`→`RenderGraph` (`cls = 'inv-node cluster-' + (n.cluster % 8) + ' type-' + n.type`, `strength = n.score`; edge `cls = 'edge-' + e.kind`); render `<GraphCanvas graph={render} onNodeClick=(id)=>setSelected(id) onDrawEdge={manualEdge} renderInspector={renderProvenance} emptyMessage="No entities yet — add a node or run a transform." />`. Render the filter panel (bound to `filters`) + an "Add node" control (Task 8). `renderProvenance(id)` shows the entity + (fetched) evidence/findings.

- [ ] **Step 3d: Register the module.** In `register-builtins.tsx`: `registerModule({ key: 'investigation-graph', title: 'Investigation Graph', glyph: '🕸', component: InvestigationGraphAdapter, builtin: true, category: 'osint', subcategory: 'Identity' })` (adapter passes the active `caseId`). Add the glyph to `Icon.tsx` if the emoji-glyph path needs it.

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-filters minds-eye-render` → PASS (Mind's Eye render test green after the `GraphCanvas` extraction); `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/renderer/modules/investigation-graph/ src/renderer/components/graph-canvas/GraphCanvas.tsx src/renderer/modules/minds-eye/MindsEyeModule.tsx src/renderer/modules/register-builtins.tsx test/investigation-filters.test.ts && git commit -m "feat(investigation): graph module + shared GraphCanvas + client-side filters"`

---

### Task 7: Manual add-node / draw-edge write path

**Files:**
- Modify: `src/main/investigation/graph.ts` (add `addManualNode`, `addManualEdge` writing a `manual` evidence record), `src/main/ipc/register.ts` + `src/shared/ipc-contracts.ts` + preload (expose them), `InvestigationGraphModule.tsx` (Add-node form + wire `onDrawEdge`)
- Test: `test/investigation-manual-add.test.ts`

**Interfaces:**
- Consumes: `entities.create` (`../storage/entities`), `appendEvidence` (ledger), `EntityType`.
- Produces: `addManualNode(caseId, type: EntityType, value: string, now: string): Promise<void>` (creates the entity if absent + a `manual` evidence record referencing it); `addManualEdge(caseId, fromId, toId, relation, now): Promise<void>` (a `manual` evidence record whose `producedEdges` carries the from/to entity `{type,value}` + relation). Both fire the ledger notifier → the graph streams the change.

- [ ] **Step 1: Write the failing test.** `test/investigation-manual-add.test.ts` (mock secure-fs + a mutable `entities` as in Task 4): `addManualNode('caseA','domain','evil.tld',NOW)` then `sceneForCase('caseA')` includes a `domain` node `evil.tld`; `addManualEdge` between two ids yields a `relation` edge in the scene.

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-manual-add` → FAIL.

- [ ] **Step 3: Implement.** In `graph.ts`:

```ts
import * as ent from '../storage/entities';
import { appendEvidence } from './ledger';
import type { EntityType } from '@shared/types';

export async function addManualNode(caseId: string, type: EntityType, value: string, now: string): Promise<void> {
  const all = await ent.listAll();
  const existing = all.find((e) => e.type === type && e.value === value);
  const rec = existing ?? await ent.create({ type, value });
  await appendEvidence(caseId, { runId: 'manual', transformId: 'manual', transformVersion: '1', inputEntityId: rec.id, producedEntityIds: [rec.id], producedEdges: [], signals: [] }, '', now);
}

export async function addManualEdge(caseId: string, fromId: string, toId: string, relation: string, now: string): Promise<void> {
  const all = await ent.listAll();
  const a = all.find((e) => e.id === fromId); const b = all.find((e) => e.id === toId);
  if (!a || !b) throw new Error('both entities must exist');
  await appendEvidence(caseId, { runId: 'manual', transformId: 'manual', transformVersion: '1', inputEntityId: fromId, producedEntityIds: [fromId, toId],
    producedEdges: [{ fromValue: a.value, fromType: a.type, toValue: b.value, toType: b.type, relation }], signals: [] }, '', now);
}
```

Expose via IPC (`investigation:addNode`, `investigation:addEdge`) mirroring Task 5, and wire the Add-node form + `onDrawEdge={(from,to)=>window.api.investigation.addEdge(caseId,from,to,'related')}` in the module. `now` is supplied main-side at the IPC boundary (the ONE place a real timestamp enters — keep the pure modules clock-free).

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-manual-add` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/graph.ts src/main/ipc/register.ts src/shared/ipc-contracts.ts src/preload/index.ts src/preload/api.d.ts src/renderer/modules/investigation-graph/InvestigationGraphModule.tsx test/investigation-manual-add.test.ts && git commit -m "feat(investigation): manual add-node / draw-edge (usable graph before transforms)"`

---

### Task 8: Playwright render guard

**Files:**
- Create: `test/investigation-graph-render.pw.test.ts` (mirror `test/minds-eye-render.pw.test.ts`)

**Interfaces:**
- Consumes: `InvestigationGraphModule` with a fixture scene (stub `window.api.investigation.graph` to return a small scene; `onGraphDelta` a no-op unsubscribe).

- [ ] **Step 1: Write the test** (mirror the Mind's Eye render harness): mount `InvestigationGraphModule` with a stubbed `window.api.investigation.graph` returning a 3-node/1-edge scene. Assert: (a) an `<svg>` renders with ≥3 node circles and ≥1 edge line; (b) **no `<canvas>` element exists** anywhere in the module; (c) cluster fills + type-based classes are present on nodes (computed style / class attribute); (d) clicking a node opens the provenance inspector (a panel with the entity value); (e) with an **empty** scene the module shows the "No entities yet…" message, not a blank/black rect.

- [ ] **Step 2: Run it, verify it fails** (module/selectors not present if any step is wrong): `pnpm test investigation-graph-render.pw` → observe failures, then confirm PASS once the module renders per Task 6.

- [ ] **Step 3: Run + confirm PASS.** `pnpm test investigation-graph-render.pw minds-eye-render` → both PASS (the shared core preserves both graphs' render invariants).

- [ ] **Step 4: Commit.** `git add test/investigation-graph-render.pw.test.ts && git commit -m "test(investigation): Playwright render guard — SVG only, no canvas, inspector, empty-state"`

---

## Self-Review

**Spec coverage:** §2 module structure → Tasks 1 (shared core), 6 (module + registration), 5 (IPC). §3 data→scene → Task 2 (reducer + layout + clustering). §4 streaming → Tasks 3 (diff), 4 (notifier + debounced emitter), 5 (push). §5 interactions/filters → Task 6 (filters + inspector), Task 7 (manual add/edge). §6 testing → each task's unit tests + Task 8 (Playwright). §7 charter (loopback, determinism, no-canvas, encrypted) → Global Constraints + enforced per task (injected timer in Task 4, `secure-fs` via SP-2 ledger, no-`<canvas>` guard in Tasks 1/8). §8 decomposition maps 1:1 to Tasks 1–8 (co-occurrence + layout folded into Task 2; `applyDelta` folded into Task 6).

**Placeholder scan:** none — every code step carries full code except the two deliberately-descriptive extraction/UI steps (Task 1 Step 4, Task 6 Steps 3b–3d), which give exact signatures, the exact `cls`-mapping strings, and the behavior-preserving regression guard.

**Type consistency:** `InvNode`/`InvEdge`/`InvestigationScene`/`SceneDelta`/`GraphFilters` (defined Task 2/`investigation-graph.ts`) are used identically in Tasks 3, 4, 6, 7. `RenderGraph`/`toSvgScene` (Task 1) used in Task 6. `buildInvestigationScene`/`diffScenes`/`sceneForCase`/`onSceneDelta`/`onLedgerAppend`/`addManualNode`/`addManualEdge` signatures match across tasks. `now: string` timestamp-injection is consistent (only the IPC boundary supplies a real clock).

**Open decisions (from the spec):** clustering = connected-components (Task 2, `components()`); debounce = 150 ms injected (Task 4); module surfaced in the OSINT Toolkit under `category:'osint'` (Task 6, Step 3d). Layout constants (R/r/centers) are fixed in Task 2 and can be tuned later without interface change.
