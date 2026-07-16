# Minds Eye — Forget a Conversation's Memory (tombstone) — Design Spec (v3.50.1)

**Date:** 2026-07-16
**Module:** Ghost Intel 98 → Minds Eye (memory graph) + the AI-memory conversation store / vector index.
**Origin:** Straggler close-out — the last genuine buildable straggler. The Minds Eye inspector had a permanently-disabled "Forget" for `conversation`/`entity` nodes ("not supported yet"). Operator decisions: **conversation = tombstone** (keep the chat, forget only its memory); **entity = leave disabled, documented as intentional**.

## Goal

Let the user **forget a conversation's memory** from Minds Eye without deleting the chat: the conversation stops being indexed/recalled (its graph node disappears) but the chat remains in AI Assistant history, and the action is reversible. Entity `Forget` stays disabled with an honest tooltip.

## Grounding (from the backend investigation)

- Minds Eye loads the whole graph via `window.api.memory.graph()`. A `conversation` node id is `__conversations__:convo:<conversationId>`, sourced from `ai-conversations.ts` (the chat) + `convo:<id>` chunks in the `<dataRoot>/memory/conversations.json` vector shard.
- `reindexConversations()` (`services/memory/indexer.ts`) rebuilds the `__conversations__` shard from the conversation store; a source no longer present is dropped from the shard. Shards are encrypted at rest via secure-fs. Reindex re-embeds and rethrows before `saveShard` if the embed engine is down (so a failed reindex leaves the prior shard intact).
- Existing pattern to mirror: `memory:forgetDoc(docId)` → remove source + awaited reindex.
- The `entity` node is a **per-case aggregate** (`<caseId>:entities`) of ALL a case's entities — too coarse for a single Forget; entities are managed in the case tool. Left disabled by decision.

## Design

### Tombstone flag (`src/main/storage/ai-conversations.ts` + its type in `src/shared/*`)

- Add `memoryExcluded?: boolean` to the conversation record type. Absent = included (default, back-compat).
- **`reindexConversations()` skips excluded conversations** — it does not emit a `convo:<id>` source for any conversation whose `memoryExcluded === true`. So on reindex, an excluded conversation's chunks leave the shard and its Minds Eye node vanishes, while the chat record itself is untouched.

### IPC (`memory:forgetConversation`, `memory:rememberConversation`)

- `memory:forgetConversation(conversationId)`: validate the id shape; set `memoryExcluded = true` on the conversation via `aiConversations.save` (idempotent); `await reindexConversations()`; prune any user-drawn bonds referencing `__conversations__:convo:<id>` (`bonds` store) so no dangling edges remain. Awaited so the node is gone when it resolves; surface an embed-engine failure as an error (not a silent success), matching `addLibraryDocIndexed`.
- `memory:rememberConversation(conversationId)` (un-forget / reversibility): set `memoryExcluded = false`; `await reindexConversations()` so the memory (and the node) comes back.
- Channels in `ipc-contracts.ts`, handlers in `register.ts` (mirror `forgetDoc`), preload in `index.ts` + `api.d.ts`. Server-side id validation (as `forgetDoc` does).

### Renderer

- **Minds Eye** (`MindsEyeModule.tsx:227-229`): replace the disabled `conversation` Forget button with a real handler → a `confirmDialog` ("Forget this conversation's memory? The chat stays in AI Assistant, but it will no longer be recalled.") → `window.api.memory.forgetConversation(idFromNode)` → reload the graph. The `entity` branch keeps a disabled button with a clearer tooltip: "Entity memory is a per-case aggregate — manage it in the case tool." Derive `conversationId` by stripping the `__conversations__:convo:` prefix from the node id (guard the shape).
- **Reversibility surface:** the AI Assistant conversation list (where the chat still lives) gets a per-conversation "Forget from memory / Remember" toggle reflecting `memoryExcluded`, calling `forgetConversation`/`rememberConversation`. (If that list has no per-row menu, fall back to a small "Excluded from memory" section in Minds Eye / memory settings — but the conversation list is the natural home since the chat is preserved there.)

### Validation / safety

- Delete/exclude goes through `aiConversations.save` + `reindexConversations` + `saveShard` (never a raw file write) → encryption + consistency preserved.
- Reindex determinism: pass no wall-clock into the pure indexing; treat embed-engine failure as "not yet forgotten" and toast the error.
- `forgetConversation` is idempotent (already-excluded → set again + reindex is a no-op-ish safe repeat).

## Testing

- **Store/indexer:** `reindexConversations()` omits an excluded conversation's `convo:<id>` chunks (present when included, absent when `memoryExcluded`); the conversation record survives (chat not deleted); `rememberConversation` restores the chunks.
- **IPC:** forget sets the flag + reindexes + prunes bonds referencing the node; remember clears it.
- **Renderer:** the conversation node's Forget button is enabled and calls `forgetConversation`; the entity node's button stays disabled; the AI Assistant toggle flips `memoryExcluded`.
- Determinism: fixed inputs → stable shard.

## Out of scope (documented intentional)

- **Entity `Forget`** — left disabled (per-case aggregate; managed in the case tool). Not a straggler.
- A per-entity node refactor.
- Bulk "forget all excluded" management UI beyond the single toggle.
