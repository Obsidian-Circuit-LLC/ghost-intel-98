# Adaptive Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the three gaps in the AI assistant's memory — make retrieval **live** (auto-reindex on save), make it **adapt** (a self-updating, inspectable long-term profile), and make it **transparent** (a panel showing/allowing edit of what was learned and recalled).

**Architecture:** Extends the existing `src/main/services/memory/` vector-RAG (loopback Ollama embeddings, encrypted JSON shards, cosine). Adds a new `memory/profile/` layer (durable `MemoryItem`s with confidence/decay/pin), a debounced live-reindex scheduler, injection into `ai.ts`, governance IPC, and a renderer Memory panel. All load-bearing logic lives in pure, node-tested helpers; `.tsx` and LLM/IPC glue stay thin.

**Tech Stack:** Electron main + React renderer, Zustand, Vitest (node env, `test/`), TypeScript strict, secure-fs (encrypted at rest), loopback Ollama.

## Global Constraints

- **Local-only, encrypted at rest, zero egress beyond loopback Ollama (`127.0.0.1`).** No telemetry. The profile never leaves the machine. Extraction/summarization use the bundled Ollama endpoint ONLY.
- **Everything learned is inspectable, editable, and erasable** by the user (governance UI). Nothing is silent.
- **Deterministic store/reconcile/ranking ops** (unit-tested). LLM extraction/summarization are explicitly **best-effort, non-deterministic**, and must never break a chat (try/catch, like the existing recall at `ai.ts:63-71`).
- **Off unless enabled:** gated on `settings.ai.useMemory` (existing) + a new `settings.ai.adaptiveMemory` (default false) for the profile layer; `settings.ai.autoReindex` (default true) for live-ness. Adaptive/live are no-ops for non-Ollama providers.
- **Commits:** persona `Dezirae-Stark <213370007+Dezirae-Stark@users.noreply.github.com>`. NEVER emit `Co-Authored-By:` / `Signed-off-by:` / `Claude-Session:` trailers. Stage only files you changed (never `git add -A`). Do not touch pre-existing dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`).
- **No release in this plan.** No version bump, no installer, no publish. The branch is built + reviewed + left green for the v3.26.0 package.
- Renderer `.tsx` is not headlessly testable → put logic in pure helpers and test those.

## Existing seams (read before implementing)

- `src/main/services/memory/indexer.ts` — `reindexCase(caseId)`, `reindexConversations()`, `reindexAll(onProgress)`.
- `src/main/services/memory/retriever.ts` — `recall(query, {k,caseId,minScore}): RecallHit[]`, `formatRecall(hits): string`; `RecallHit = {caseId,caseTitle,kind,ref,text,snippet,score}`.
- `src/main/services/memory/embeddings.ts` — `embed(texts): Promise<number[][]>` (loopback Ollama, `nomic-embed-text`).
- `src/main/services/memory/store.ts` — secure-fs shard read/write helpers; `<dataRoot>/memory/` is the memory root.
- `src/main/services/ai.ts:63-71` — the recall-inject block (extend here).
- `src/main/storage/ai-conversations.ts` — `list()/get(id)/save(convo)/delete(id)`; source of truth for chats.
- `src/shared/ipc-contracts.ts:396-400` (`memory:` channels), `src/preload/index.ts:395-403` (`memory` preload), `src/shared/types.ts:385` (`ai.useMemory`).
- Save paths to hook for live-reindex: note save, case save, and `ai-conversations.save` (find via `grep -rn "noteStore.write\|caseStore.write\|conversations.save" src/main`).

---

## Task 1: Live reindex scheduler (debounced) + settings flag

**Files:** Create `src/main/services/memory/live-reindex.ts`; Modify `src/shared/types.ts` (add `ai.autoReindex`); Test `test/memory-live-reindex.test.ts`.

**Interfaces — Produces:**
```ts
export interface LiveReindexDeps {
  reindexCase(caseId: string): Promise<unknown>;
  reindexConversations(): Promise<unknown>;
  now(): number;                 // injected clock (determinism)
  schedule(fn: () => void, ms: number): unknown; // injected timer
  cancel(handle: unknown): void;
}
export interface LiveReindexer {
  caseChanged(caseId: string): void;   // debounced → reindexCase
  conversationsChanged(): void;         // debounced → reindexConversations
  flush(): Promise<void>;               // run pending now (tests + shutdown)
}
export function createLiveReindexer(deps: LiveReindexDeps, debounceMs?: number): LiveReindexer;
```
Coalesces repeated `caseChanged(id)` within the window into ONE `reindexCase(id)`; distinct case ids tracked separately; `conversationsChanged` coalesces to one. Best-effort (swallow reindex errors). Default `debounceMs = 1500`.

- [ ] **Step 1: Failing test** — `test/memory-live-reindex.test.ts`: with a fake timer + fake reindex deps, assert (a) three rapid `caseChanged('c1')` → exactly one `reindexCase('c1')` after flush; (b) `caseChanged('c1')`+`caseChanged('c2')` → both reindexed once; (c) a throwing `reindexCase` does not reject `flush()`.
- [ ] **Step 2:** Run → FAIL (module missing). `pnpm vitest run test/memory-live-reindex.test.ts`
- [ ] **Step 3:** Implement `createLiveReindexer` per the interface; add `autoReindex: boolean` to the `ai` settings interface in `src/shared/types.ts` and default it `true` in the settings default object (mirror the `useMemory` field at `:385`/`:610`).
- [ ] **Step 4:** Run → PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(memory): debounced live-reindex scheduler + ai.autoReindex flag`.

## Task 2: Wire live-reindex into save paths

**Files:** Modify the note/case/conversation save handlers (locate via grep above) to notify a singleton live-reindexer; Create `src/main/services/memory/live-reindex.singleton.ts` (wires `createLiveReindexer` to the real `indexer` + `setTimeout`/`Date.now`, gated on `settings.ai.useMemory && settings.ai.autoReindex`). Test: extend `test/memory-live-reindex.test.ts` only (singleton wiring is glue — no new test file).

**Interfaces — Consumes:** Task 1's `createLiveReindexer`. **Produces:** `liveReindex.caseChanged(id)` / `.conversationsChanged()` called from save handlers.

- [ ] **Step 1:** Add the singleton (reads settings each call; if gate off, no-op). 
- [ ] **Step 2:** Call `liveReindex.caseChanged(caseId)` after a successful note save and case save; `liveReindex.conversationsChanged()` after `ai-conversations.save`. Fire-and-forget, never awaited in the handler's response path.
- [ ] **Step 3:** `pnpm typecheck`; `pnpm vitest run test/memory-live-reindex.test.ts` still green.
- [ ] **Step 4:** Commit `feat(memory): auto-reindex on note/case/conversation save (live recall)`.

## Task 3: Profile item model + encrypted store

**Files:** Create `src/main/services/memory/profile/types.ts`, `src/main/services/memory/profile/profile-store.ts`; Test `test/memory-profile-store.test.ts`.

**Interfaces — Produces:**
```ts
// types.ts
export type MemoryScope = string; // 'global' | 'case:<caseId>' | 'subject:<handle>'
export interface MemoryItem {
  id: string; scope: MemoryScope; text: string; normalized: string;
  provenance: string[]; confidence: number; // 0..1
  createdAt: number; lastSeenAt: number; pinned: boolean;
  source: 'extractor' | 'user';
}
export function normalizeItemText(text: string): string; // lowercased, collapsed ws, trimmed
// profile-store.ts (all persisted via secure-fs to <dataRoot>/memory/profile.json)
export interface ProfileStore {
  all(): Promise<MemoryItem[]>;
  byScope(scopes: MemoryScope[]): Promise<MemoryItem[]>;
  put(items: MemoryItem[]): Promise<void>;   // full upsert-by-id replace-set semantics
  remove(ids: string[]): Promise<void>;
  wipe(scope?: MemoryScope): Promise<void>;   // scope omitted → wipe all
}
export function createProfileStore(io?: { read; write }): ProfileStore; // io injectable for tests
```

- [ ] **Step 1: Failing test** — round-trip put/all; `byScope(['global','case:c1'])` filters; `remove` by id; `wipe('case:c1')` leaves other scopes; `wipe()` clears; `normalizeItemText` collapses case/whitespace. Use an in-memory `io` fake (no real secure-fs).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement types + store (real store uses `secureWriteFile`/`secureReadText` like `store.ts`; JSON at `<dataRoot>/memory/profile.json`; tolerate missing file → `[]`).
- [ ] **Step 4:** Run → PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(memory): encrypted profile-item store + scope model`.

## Task 4: Reconcile (pure: dedupe / reinforce / decay / expire / pin)

**Files:** Create `src/main/services/memory/profile/reconcile.ts`; Test `test/memory-reconcile.test.ts`.

**Interfaces — Consumes:** `MemoryItem`, `normalizeItemText`. **Produces:**
```ts
export interface ReconcileParams {
  existing: MemoryItem[];
  candidates: { scope: string; text: string; provenance: string[] }[];
  now: number;
  confidenceGain?: number;   // default 0.25
  decayPerDay?: number;      // default 0.02 (linear) applied to (now - lastSeenAt)
  expireFloor?: number;      // default 0.1
  newId(): string;           // injected id factory (determinism)
}
export function reconcile(p: ReconcileParams): MemoryItem[]; // the new full item set
```
Rules (deterministic): for each candidate, match an existing item by `(scope, normalized)`. **Match →** reinforce: `confidence = min(1, confidence + gain)`, `lastSeenAt = now`, union provenance. **No match →** new item `{confidence: gain, createdAt/lastSeenAt: now, pinned:false, source:'extractor'}`. Then apply decay to every non-pinned item: `confidence -= decayPerDay * daysSince(lastSeenAt)`; drop non-pinned items with `confidence < expireFloor`. Pinned items: exempt from decay/expiry; a candidate matching a pinned item still bumps `lastSeenAt` + provenance but not its (user-authoritative) `confidence=1`. Output sorted deterministically (pinned desc, confidence desc, `id` asc).

- [ ] **Step 1: Failing test** — new candidate creates an item; repeat candidate reinforces (higher confidence, merged provenance, one item); a stale non-pinned item below floor is expired; a pinned item survives decay and keeps confidence 1; output ordering stable.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS + typecheck. **Step 5:** Commit `feat(memory): deterministic profile reconcile (dedupe/reinforce/decay/pin)`.

## Task 5: Rolling summary merge (pure) + summarizer glue

**Files:** Create `src/main/services/memory/profile/summarizer.ts`; Test `test/memory-summarizer.test.ts`.

**Interfaces — Produces:**
```ts
export interface RollingSummary { scope: string; text: string; updatedAt: number }
// Pure merge: cap length, keep newest emphasis; deterministic.
export function mergeSummary(prev: string, addition: string, now: number, maxChars?: number): RollingSummary; // maxChars default 1200
// Glue: distill via injected LLM client (loopback Ollama), best-effort.
export interface SummarizerClient { complete(prompt: string): Promise<string>; }
export async function summarizeTurns(client: SummarizerClient, prevSummary: string, turns: string): Promise<string>;
```
`mergeSummary` is pure/tested (cap + dedupe-ish concatenation, never exceeds `maxChars`, trims mid-sentence safely). `summarizeTurns` is best-effort glue (fake client in tests).

- [ ] **Step 1: Failing test** — `mergeSummary` never exceeds maxChars; appends addition; deterministic; `summarizeTurns` with a fake client returns its text and swallows a throwing client (returns prevSummary).
- [ ] **Step 2–5:** FAIL → implement → PASS + typecheck → commit `feat(memory): rolling summary merge + best-effort summarizer`.

## Task 6: Extractor (LLM distill → candidates) + profile retriever (deterministic)

**Files:** Create `src/main/services/memory/profile/extractor.ts`, `src/main/services/memory/profile/profile-retriever.ts`; Test `test/memory-extractor.test.ts`, `test/memory-profile-retriever.test.ts`.

**Interfaces — Produces:**
```ts
// extractor.ts — best-effort, Ollama-only glue with a pure parser.
export interface ExtractorClient { complete(prompt: string): Promise<string>; }
export function parseCandidates(raw: string, scope: string, provenance: string[]): { scope: string; text: string; provenance: string[] }[]; // tolerant JSON-lines/array parse; [] on garbage
export async function extractItems(client: ExtractorClient, turns: string, scope: string, provenance: string[]): Promise<{scope:string;text:string;provenance:string[]}[]>;
// profile-retriever.ts — deterministic selection (NO embedding; recency/confidence ranked).
export function selectProfileItems(items: MemoryItem[], scopes: string[], limit?: number): MemoryItem[]; // in-scope, sorted (pinned desc, confidence desc, lastSeenAt desc, id asc), capped (default 8)
export function formatProfileBlock(items: MemoryItem[], summary: string): string; // '' when nothing; provenance-labelled system-context text
```

- [ ] **Step 1: Failing tests** — `parseCandidates` handles a JSON array, JSON-lines, and returns `[]` for non-JSON; `extractItems` swallows a throwing client → `[]`. `selectProfileItems` filters scope, orders deterministically, caps; `formatProfileBlock` returns '' for empty and includes provenance labels otherwise.
- [ ] **Step 2–5:** FAIL → implement → PASS + typecheck → commit `feat(memory): profile extractor (parse) + deterministic profile retriever`.

## Task 7: Inject profile + summary into generation; learn after a conversation settles; emit recall provenance

**Files:** Modify `src/main/services/ai.ts` (extend the block at `:63-71`); Create `src/main/services/memory/profile/index.ts` (facade wiring store+reconcile+extractor+summarizer+retriever to the real Ollama client + `Date.now`); Test `test/memory-profile-facade.test.ts` (facade orchestration with fakes).

**Interfaces — Produces (facade):**
```ts
export async function recallProfile(query: string, scopes: string[]): Promise<{ items: MemoryItem[]; summary: string; block: string }>;
export async function learnFromConversation(convoId: string, turns: string, scopes: string[]): Promise<void>; // extract → reconcile → store.put → summary update; best-effort
```

- [ ] **Step 1: Failing test** — `learnFromConversation` with fake extractor+store: candidates get reconciled and persisted; a throwing extractor leaves the store unchanged and does not reject. `recallProfile` returns `block===''` when the store is empty.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the facade. In `ai.ts`, inside the existing `if (s.ai.useMemory && provider === 'ollama')` block: when `s.ai.adaptiveMemory`, also `recallProfile(lastUser.content, scopesFor(req))` and push its `block` as a system message (best-effort, own try/catch). Compute `scopesFor` = `['global', ...(req.caseId ? ['case:'+req.caseId] : [])]`. Collect the `RecallHit[]` + selected `MemoryItem[]` actually injected and emit them to the renderer via the existing stream `emit(...)` as a `recall` field on the first/last event (add `recall?: {rag: RecallHit[]; profile: MemoryItem[]}` to the stream payload type). Trigger `learnFromConversation` after a conversation is saved (call from the `ai-conversations.save` path or a dedicated IPC the renderer fires on stream-done), debounced/best-effort — never in the response hot path.
- [ ] **Step 4:** Run → PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(memory): inject adaptive profile into chat + learn after conversations + emit recall provenance`.

## Task 8: Governance IPC + preload (list/edit/pin/delete/wipe, recall preview)

**Files:** Modify `src/shared/ipc-contracts.ts` (add `memory.profile*` channels), `src/preload/index.ts` (+ `src/preload/api.d.ts`), and the memory IPC registration (find via `grep -rn "channels.memory" src/main`). Test: none new (IPC glue) — covered by facade tests.

**Interfaces — Produces (preload `window.api.memory`):**
```ts
profileList(scope?: string): Promise<MemoryItem[]>;
profileUpsert(item: Pick<MemoryItem,'id'|'scope'|'text'|'pinned'>): Promise<MemoryItem[]>; // user edits/pins; source:'user'
profileDelete(ids: string[]): Promise<void>;
profileWipe(scope?: string): Promise<void>;
onRecall(cb: (r: {rag: RecallHit[]; profile: MemoryItem[]}) => void): () => void; // fired per generation
```
Handlers delegate to `profile-store` + facade. A user upsert sets `source:'user'`, `pinned` as given, `confidence:1` (user-authoritative). `profileUpsert` normalizes text and returns the new full set.

- [ ] **Step 1:** Add channels + preload + `api.d.ts` types + main handlers. **Step 2:** `pnpm typecheck`. **Step 3:** Commit `feat(memory): profile governance IPC + recall-preview event`.

## Task 9: Renderer memory view helpers (pure)

**Files:** Create `src/renderer/modules/ai-assistant/memory-view.ts`; Test `test/memory-view.test.ts`.

**Interfaces — Produces:**
```ts
export interface ScopeGroup { scope: string; label: string; items: MemoryItem[] }
export function groupItemsByScope(items: MemoryItem[]): ScopeGroup[]; // 'global'→'General', 'case:x'→'Case x', 'subject:h'→'@h'; sorted (General first, then alpha); items pinned-first then confidence desc
export function formatRecallProvenance(rag: RecallHit[], profile: MemoryItem[]): string[]; // human labels: 'Case “X” › note:Y', 'Memory: <text truncated>'
```

- [ ] **Step 1: Failing test** — grouping/labelling + ordering; empty → `[]`; provenance formatting truncates long memory text and labels rag hits by case+kind+ref.
- [ ] **Step 2–5:** FAIL → implement → PASS + typecheck → commit `feat(memory): pure renderer helpers for the memory panel`.

## Task 10: Memory panel UI (transparency + governance) + settings toggles

**Files:** Modify `src/renderer/modules/ai-assistant/AiAssistantModule.tsx` (add a Memory panel: "Recalled" section from `onRecall`, and a "Learned" browser from `profileList` with edit/pin/delete/wipe using Task 9 helpers); Modify `src/renderer/modules/settings/SettingsModule.tsx` (add `ai.adaptiveMemory` + `ai.autoReindex` toggles beside the existing Case Memory fieldset at `:392-409`). Test: none (thin `.tsx` over tested helpers) — manual smoke.

- [ ] **Step 1:** Add the Settings toggles (adaptive memory on/off; auto-reindex on/off; wording: local, offline, inspectable). 
- [ ] **Step 2:** Add the assistant Memory panel: subscribe to `window.api.memory.onRecall` → show "Recalled from…" (via `formatRecallProvenance`) for the last answer; a "Learned" list (via `groupItemsByScope`) with per-item pin/edit/delete and a per-scope + global Wipe. All text rendered as React text children (XSS-safe — case titles/handles/learned text are untrusted). 
- [ ] **Step 3:** `pnpm typecheck`. **Step 4:** Commit `feat(memory): assistant Memory panel (recall transparency + learned-item governance) + settings toggles`.

---

## Verification (whole-branch, before proposing anything)

- `pnpm typecheck` clean; `pnpm test` fully green (record the real total).
- Run the commit security-review gate on the branch diff. XSS focus: learned text / case titles / handles rendered in the Memory panel; the injected profile block. Egress focus: confirm extractor/summarizer/embeddings talk ONLY to loopback Ollama — `git diff main...HEAD` must add **no** new outbound host, no new `connect-src`, no telemetry. Confirm the profile file is written via secure-fs (encrypted).
- Determinism: `reconcile`, `selectProfileItems`, `mergeSummary`, `groupItemsByScope` are pure + tested; LLM extraction/summarization are best-effort and cannot break a chat (try/catch).
- Governance: every learned item is visible, editable, pinnable, and deletable; wipe-scope and wipe-all work; adaptive memory is off by default.
- No release: version unchanged; branch left green for the v3.26.0 package (GhostScrape + OSINT Toolkit still to come).

## Self-Review (author)

- **Coverage:** live (T1–T2), adapt (T3–T7), transparency (T8–T10). All three ❌ addressed.
- **Type consistency:** `MemoryItem` defined in T3 and used identically in T4/T6/T8/T9; `RecallHit` reused from `retriever.ts`; facade signatures in T7 match their consumers in T8.
- **Determinism/charter:** store ops deterministic + tested; LLM best-effort; local+encrypted+erasable; no egress beyond loopback; off by default.
