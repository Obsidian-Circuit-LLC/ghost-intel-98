# Minds Eye Forget-Conversation-Memory Implementation Plan (v3.50.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user forget a conversation's *memory* from Minds Eye (a tombstone: the chat stays in AI Assistant, but it stops being indexed/recalled and its graph node disappears), reversibly; leave entity Forget disabled by design.

**Architecture:** A `memoryExcluded` flag on the conversation record; `reindexConversations()` skips excluded conversations so their vector chunks (and thus their graph node) vanish while the chat record survives. Two IPC channels mirror `forgetDoc` (remove-source-equivalent + awaited reindex).

**Tech Stack:** TypeScript, Electron main/preload/renderer, secure-fs vector shards, Vitest. No new dependencies.

## Global Constraints

- Commit identity `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `--no-verify`, no AI trailers. Explicit-path `git add`; never stage `pnpm-lock.yaml`, `resources/**`, `native/**`, `docs/superpowers/ideation/**`.
- No new dependencies. No new egress. Encrypt-at-rest preserved — all shard writes go through `reindexConversations`/`saveShard` (secure-fs), never a raw file write.
- Determinism: no wall-clock inside indexing; a failed reindex (embed engine down) must surface as an error, not a silent success.
- Windows-only. Tests `pnpm exec vitest run <files>`; typecheck `pnpm exec tsc --noEmit`.

---

## Task 1: `memoryExcluded` flag + reindex skip

**Files:** Modify `src/shared/post-mvp-types.ts:278` (`AiConversation`), `src/main/services/memory/indexer.ts:78-88` (`reindexConversations`). Test: `test/memory-forget-conversation.test.ts` (create).

**Interfaces — Produces:** `AiConversation.memoryExcluded?: boolean`; `reindexConversations()` omits excluded conversations.

- [ ] **Step 1: Write the failing test** — `test/memory-forget-conversation.test.ts`. Using the memory-service test harness (find it: `grep -rn "reindexConversations\|conversationShardPath\|_resetForTest" test/ src/main/services/memory/`), seed two conversations (one with `memoryExcluded: true`), run `reindexConversations()`, and assert the shard contains `convo:<included>` chunks but NOT `convo:<excluded>`. If no harness exists, unit-test a small extracted predicate: assert the source list built by the loop excludes `memoryExcluded` convos.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** In `src/shared/post-mvp-types.ts`, add `memoryExcluded?: boolean;` to the `AiConversation` interface (optional; absent = included). In `reindexConversations()` (indexer.ts), skip excluded conversations — after `if (!convo) continue;` (line 83) add:

```ts
    if (convo.memoryExcluded) continue; // tombstoned: keep the chat, omit it from the memory index
```

- [ ] **Step 4: Run tests + typecheck** — PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/post-mvp-types.ts src/main/services/memory/indexer.ts test/memory-forget-conversation.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(minds-eye): memoryExcluded flag on conversations; reindexConversations skips them"
```

---

## Task 2: IPC forget/remember + bonds prune

**Files:** Modify `src/shared/ipc-contracts.ts` (channels), `src/main/ipc/register.ts` (handlers), `src/preload/index.ts` + `src/preload/api.d.ts`, and use the bonds store (`src/main/services/memory/bonds.ts`). Test: `test/memory-forget-conversation-ipc.test.ts` (create — call the handler-backing functions).

**Interfaces — Consumes:** `reindexConversations` (T1); `aiConversations.get/save`; `bonds` remove. **Produces:** `window.api.memory.forgetConversation(id)`, `window.api.memory.rememberConversation(id)`.

- [ ] **Step 1: Write the failing test** — after `forgetConversation(id)`: the conversation record has `memoryExcluded === true`, the chat record still exists (`aiConversations.get(id)` non-null), the `__conversations__:convo:<id>` chunks are gone from the shard, and any bond referencing that node id is removed. `rememberConversation(id)` clears the flag and the chunks return. (Read `bonds.ts` for its remove/list signatures; read `register.ts`'s `forgetDoc` handler as the pattern.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.**
  - Channels: add `forgetConversation`, `rememberConversation` to the `memory` channel object in `ipc-contracts.ts` (mirror `forgetDoc`).
  - Handlers (`register.ts`, next to `memory:forgetDoc`):
    ```ts
    safeHandle(channels.memory.forgetConversation, async (...a) => {
      const id = ensureConversationId(a[0]);            // validate shape (see below)
      const convo = await aiConversations.get(id);
      if (convo) await aiConversations.save({ ...convo, memoryExcluded: true });
      await memory.reindexConversations();              // awaited; rethrows if embed engine down
      await memory.pruneBondsForNode(`__conversations__:convo:${id}`); // remove dangling user bonds
    });
    safeHandle(channels.memory.rememberConversation, async (...a) => {
      const id = ensureConversationId(a[0]);
      const convo = await aiConversations.get(id);
      if (convo) await aiConversations.save({ ...convo, memoryExcluded: false });
      await memory.reindexConversations();
    });
    ```
    Add a minimal `ensureConversationId` (a non-empty string of the expected shape) in `validate.ts` or inline, matching how `forgetDoc` validates. Implement `pruneBondsForNode(nodeId)` in the memory service (a thin wrapper over the existing `bonds` remove for any bond whose endpoints include `nodeId`); if the bonds store has no bulk-remove, iterate its list and remove matches. Reuse the exact `aiConversations` import already used elsewhere in `register.ts`.
  - Preload + types: add `forgetConversation`/`rememberConversation` to `window.api.memory` in `index.ts` + `api.d.ts` (mirror `forgetDoc`).

- [ ] **Step 4: Run tests + typecheck** — PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts src/main/services/memory/bonds.ts src/main/services/memory/graph/index.ts src/main/security/validate.ts test/memory-forget-conversation-ipc.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(minds-eye): memory:forgetConversation/rememberConversation IPC + dangling-bond prune"
```

(Stage only the memory-service file(s) you actually touched for `pruneBondsForNode`.)

---

## Task 3: Minds Eye renderer — enable conversation Forget, clarify entity

**Files:** Modify `src/renderer/modules/minds-eye/MindsEyeModule.tsx:227-229`. Test: `test/minds-eye-forget.test.tsx` (createRoot harness).

**Interfaces — Consumes:** `window.api.memory.forgetConversation` (T2).

- [ ] **Step 1: Write the failing test** — with a selected node of `kind:'conversation'` (id `__conversations__:convo:c1`), the inspector's Forget button is enabled and clicking it (after a confirm) calls `window.api.memory.forgetConversation('c1')` then reloads the graph; with `kind:'entity'`, the Forget button is `disabled` with the new tooltip text.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Replace the `(selected.kind === 'conversation' || selected.kind === 'entity')` branch with two branches:
  - `conversation`: an enabled `<button onClick={() => forgetConversation(selected)}>Forget</button>`; add a `forgetConversation` handler that `confirmDialog`s ("Forget this conversation's memory? The chat stays in AI Assistant, but it will no longer be recalled."), derives the id by stripping the `__conversations__:convo:` prefix (guard: bail if the shape doesn't match), calls `window.api.memory.forgetConversation(id)`, then `load()`s the graph; toast on error.
  - `entity`: keep `<button disabled title="Entity memory is a per-case aggregate — manage it in the case tool">Forget</button>`.

- [ ] **Step 4: Run tests + typecheck** — PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/minds-eye/MindsEyeModule.tsx test/minds-eye-forget.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(minds-eye): enable conversation Forget (tombstone); entity Forget disabled w/ clear tooltip"
```

---

## Task 4: AI Assistant conversation-list Forget/Remember toggle (reversibility)

**Files:** Modify the AI Assistant conversation list (find it: `grep -rn "conversations\|aiConvos\|convo" src/renderer/modules/ai-assistant/*.tsx | grep -i "list\|history\|delete"`). Test: extend `test/minds-eye-forget.test.tsx` or a new `test/ai-assistant-memory-toggle.test.tsx`.

**Interfaces — Consumes:** `forgetConversation`/`rememberConversation` (T2); `AiConversation.memoryExcluded` (T1).

- [ ] **Step 1: Write the failing test** — a conversation row/menu shows a "Forget from memory" action when `memoryExcluded` is false (calls `forgetConversation`) and "Remember" when true (calls `rememberConversation`); the label reflects `memoryExcluded`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** In the AI Assistant conversation list (wherever a per-conversation action/menu already exists — e.g. next to delete/rename), add a "Forget from memory" / "Remember" toggle bound to `memoryExcluded`, calling `window.api.memory.forgetConversation(id)` / `rememberConversation(id)` and refreshing the list. If the list exposes no per-row menu and adding one is disproportionate, instead surface reversibility as a small "Excluded from memory" list in the Minds Eye/memory settings pane — note in the commit which surface was used and why.

- [ ] **Step 4: Run tests + typecheck** — PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add <the modified AI-assistant file(s)> test/<the test file>
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(minds-eye): Forget/Remember-from-memory toggle in the conversation list (reversible tombstone)"
```

---

## Final Verification (controller)

1. `pnpm test` → green; `pnpm exec tsc --noEmit` → clean.
2. Whole-branch adversarial review: the chat record truly survives a forget (not deleted); the node/chunks truly vanish and return on remember; embed-engine failure surfaces (no false success); bond prune removes only the dead node's edges; entity Forget stays disabled; encryption path intact (no raw shard write).
3. (Ships as v3.50.1; document entity-Forget-disabled as intentional in the release note.)

## Self-Review (author, done)

- **Spec coverage:** flag + reindex skip (T1); forget/remember IPC + bonds prune (T2); Minds Eye enable/disable (T3); reversibility toggle (T4). Entity stays disabled (T3, by decision). All covered.
- **Placeholder scan:** none — the "find the harness/list" notes carry concrete grep commands; the reversibility-surface fallback is a stated acceptable alternative, not a TODO.
- **Type consistency:** `memoryExcluded` (T1) read by T2/T4; `forgetConversation`/`rememberConversation` signatures introduced in T2 and consumed in T3/T4; node-id shape `__conversations__:convo:<id>` used consistently in T2 (bond prune) and T3 (id derivation).
