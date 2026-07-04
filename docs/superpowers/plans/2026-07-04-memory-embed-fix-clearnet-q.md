# Memory-embed 404 fix + Tor-reliability/clearnet fallback + finish "Q" rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ultracode). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the root cause that makes Ghost Intel 98's memory index 0 chunks (embeddings 404), make the embedding-engine status honest and its failures visible, finish renaming the assistant to "Q" in the Access (Start) menu including a migration for existing installs, surface an in-conversation web-search toggle, and add an operator-authorized, off-by-default, hard-gated clearnet web-search fallback that triggers only when Tor search returns nothing.

**Architecture:** Ghost Intel 98 — Electron main (`src/main`), React renderer (`src/renderer`), shared types (`src/shared`). The bundled offline embedding runtime (`nomic-embed-text`) runs as its own Ollama on port 11435 with `OLLAMA_MODELS` pointed at the shipped model blobs. Web search is a text-directive loop in `src/main/services/ai.ts`: the model emits `[SEARCH: q]`, the main process runs a Tor-routed DuckDuckGo-onion search and feeds untrusted, fenced results back.

**Tech Stack:** TypeScript, Node, Electron, React, Vitest, electron-vite/electron-builder, bundled Ollama + Tor.

## Global Constraints

- **Charter — Tor-only egress is the default invariant.** The Tor onion path (`searchWeb` in `ddg.ts`) stays `.onion`-enforced and fail-closed; DO NOT weaken it. The clearnet path is a **separate** function, off by default (`ai.webSearchClearnet` defaults `false`), and only runs when Tor search returned zero results AND the user opted in. When a clearnet query runs, the chat stream MUST show an explicit, unmistakable deanonymization warning line. No telemetry, no phone-home.
- **No new egress beyond the above.** Embedding traffic is loopback only (127.0.0.1). The only new outbound network path in this change is the opt-in clearnet DDG search.
- **Do NOT stage or commit pre-existing dirty files:** `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/`. Each commit stages only files that task created/modified, by explicit path.
- **Commit identity:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`. NEVER emit `Co-Authored-By`, `Signed-off-by`, `Claude-Session`, or any AI-identity trailer in author, committer, or message body.
- **Internal keys are not labels.** `ModuleKey` values (`'ai-assistant'`), shortcut `id`s (`'ai'`), and chat message roles are internal — DO NOT rename them. Only user-visible strings change.
- **TDD.** Every task: write the failing test, watch it fail, minimal implementation, watch it pass, commit. Match existing test style in `test/`.
- Run `pnpm test <file>` for a single suite; `pnpm typecheck` must stay clean across both project configs.

---

### Task 1: Settings — add `ai.webSearchClearnet` (default false) + deep-merge coverage

**Files:**
- Modify: `src/shared/types.ts` — `AppSettings.ai` shape, its default, and the `mergeSettings` nested-field list for `ai`.
- Test: `test/settings-upgrade-merge-guard.test.ts` (add a case) and/or `test/settings-memory-default.test.ts`.

**Interfaces:**
- Produces: `settings.ai.webSearchClearnet: boolean` (default `false`). Consumed by Task 6 (ai.ts loop) and Task 7 (in-chat toggle).

**Why this matters:** Per the settings-merge-dataloss precedent, any new nested `ai` field MUST be added to the `mergeSettings` deep-merge list or upgraders silently drop it and consumers read `undefined`. This is the exact class of bug that caused the v3.24.0 "username search dead" regression.

- [ ] **Step 1: Write the failing test.** In `test/settings-upgrade-merge-guard.test.ts`, add: given a persisted settings object whose `ai` lacks `webSearchClearnet`, `mergeSettings` yields `ai.webSearchClearnet === false` (default seeded), AND given a persisted `ai.webSearchClearnet === true`, the merge preserves `true`.
- [ ] **Step 2: Run it, verify it fails** (`pnpm test settings-upgrade-merge-guard`).
- [ ] **Step 3: Implement.** Add `webSearchClearnet: boolean` to the `ai` type next to `webSearch`; add `webSearchClearnet: false` to the default `ai` object; add the field to whatever explicit `ai` sub-key list `mergeSettings` uses (mirror how `webSearch` is handled — grep `webSearch` in `types.ts`).
- [ ] **Step 4: Run tests, verify pass.** Also `pnpm test settings-memory-default settings-merge` to confirm no regression.
- [ ] **Step 5: Commit** (`git add src/shared/types.ts test/settings-upgrade-merge-guard.test.ts && git commit`), message: `feat(ai): add off-by-default ai.webSearchClearnet setting`.

---

### Task 2: Embed runtime — gate on the EMBED bundle, not the chat-model marker (ROOT CAUSE)

**Files:**
- Modify: `src/main/services/memory/embed-runtime.ts` — `resolveBundled()` and add an embed-specific bundled check.
- Test: `test/memory-embed-runtime.test.ts`.

**Interfaces:**
- Consumes: `safeBundledRoot()` (existing, embed-runtime.ts:51), `EMBED_MODEL_PRESENT` marker (shipped in `resources/local-ai/`).
- Produces: `ensureEmbedRuntime()` spawns the dedicated 11435 runtime whenever the embed model + ollama binary are bundled, independent of any chat-model `MODEL_PRESENT` marker.

**Root cause:** `resolveBundled()` currently delegates to chat `isBundled()` (`local-ai.ts:35`), which requires the **chat** marker `MODEL_PRESENT`. The installer ships only `EMBED_MODEL_PRESENT` (the chat model is the user's own Ollama), so the gate is always false in production → the 11435 embed runtime never starts → embeddings fall back to the user's Ollama on 11434, which lacks `nomic-embed-text` → HTTP 404.

- [ ] **Step 1: Write the failing test.** In `test/memory-embed-runtime.test.ts`, add a describe that does NOT use `__setBundledForTest` but instead points the embed runtime at a temp dir. Add a test-only seam if needed: export `__setBundledRootForTest(dir)` so the test can create `<dir>/ollama` (or `ollama.exe` on win) + `<dir>/EMBED_MODEL_PRESENT` and assert the new `embedBundled()` returns `true` even though NO `MODEL_PRESENT` file exists; and returns `false` when the marker is absent. (If a root seam is undesirable, unit-test the extracted `embedBundled(root)` pure helper directly with a temp dir.)
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement.** Add an embed-specific check (either a new exported `embedBundled(root?: string): Promise<boolean>` in embed-runtime.ts or a sibling in local-ai.ts) that returns `(ollama||ollama.exe exists) && (EMBED_MODEL_PRESENT exists)` under `safeBundledRoot()`. Point `resolveBundled()` at it instead of chat `isBundled()`. Keep the `bundledOverride` test seam behavior intact (checked first).
- [ ] **Step 4: Run tests, verify pass.** Confirm the existing "bundled: spawns on 11435" and "not bundled: falls back to 11434" tests still pass.
- [ ] **Step 5: Commit** — `fix(memory): start dedicated embed runtime when the embed model is bundled (was gated on the chat-model marker → 404)`.

---

### Task 3: Embed health — report `model-missing` when nomic-embed-text isn't loaded (honest status)

**Files:**
- Modify: `src/main/services/memory/embed-runtime.ts` — `EmbedHealth` type + `embedHealth()`.
- Modify: `src/renderer/modules/settings/SettingsModule.tsx:~415` — render the new state with an actionable message.
- Test: `test/memory-embed-runtime.test.ts` and/or `test/memory-embed-health-ipc.test.ts`.

**Interfaces:**
- Consumes: `EMBED_MODEL` name (`embeddings.ts`), `embedEndpoint()`.
- Produces: `embedHealth(): 'ready' | 'starting' | 'unavailable' | 'model-missing'`.

**Why:** `embedHealth()` today only pings `/api/tags` for "server up," so Settings shows "Embedding engine: ready" while every embed 404s. It must verify `nomic-embed-text` is in the model list, mirroring chat `detect()` (`local-ai.ts:54-61`). Distinct `model-missing` (vs `unavailable` = server down) gives a correct fix hint.

- [ ] **Step 1: Write the failing test.** With a probe seam that returns a tags list WITHOUT `nomic-embed-text`, `embedHealth()` returns `'model-missing'`; with the model present, `'ready'`; with the server unreachable, `'unavailable'`. (Add a `__setTagsForTest`/extend `__setProbeForTest` seam so health can inspect the model list independent of the spawn-readiness probe.)
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement.** Add `'model-missing'` to `EmbedHealth`. In `embedHealth()`, after the server-up check, GET `${embedEndpoint()}/api/tags`, parse `models[].name`, and return `'model-missing'` if none `startsWith(EMBED_MODEL)`. Keep `'starting'` while `starting` is true. Update `SettingsModule` render: `model-missing` → e.g. "Embedding engine: model not loaded — click Rebuild memory index"; `unavailable` → "engine offline".
- [ ] **Step 4: Run tests, verify pass** (`pnpm test memory-embed-runtime memory-embed-health-ipc`).
- [ ] **Step 5: Commit** — `fix(memory): embed health verifies the model is loaded, not just the server`.

---

### Task 4: Make embed failures visible where they're currently silent (+Add to Memory / auto-index)

**Files:**
- Modify: the "+Add to memory" IPC handler + its renderer call site (grep `addToMemory`/`add-to-memory`/`memory:add` in `src/main/ipc` and `src/renderer/modules/ai-assistant/AiAssistantModule.tsx`), and the auto-index-on-save path if it swallows embed errors.
- Test: an IPC/handler test asserting an embed failure yields a structured error the renderer surfaces (extend `test/memory-embed-health-ipc.test.ts` or add `test/memory-add-visible-failure.test.ts`).

**Why:** GhostExodus only saw the 404 because he hit Rebuild manually; "+Add to Memory" and auto-index ate it silently. Per the GhostExodus ADHD-UI constraint, a failed store MUST give immediate, plain-language feedback.

- [ ] **Step 1: Write the failing test.** When the embedder throws (mock `embed` to reject with the 404 Error), the add-to-memory handler resolves to `{ ok: false, error: <message> }` (or rejects in a way the renderer catches), NOT a silent success.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement.** Ensure the handler catches embed errors and returns a structured failure; in `AiAssistantModule` "+Add to memory" onClick, show `toast.error("Couldn't add to memory — the offline embedding engine isn't loaded. Open Settings → Rebuild memory index.")` on failure instead of a success toast. If auto-index-on-save swallows failures, add a debounced single error toast (do not spam).
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `fix(memory): surface embed failures on +Add to Memory instead of silent no-op`.

---

### Task 5: Finish the "Q" rename in the Access (Start) menu + migrate existing installs

**Files:**
- Modify: `src/shared/types.ts:560` (`defaultShortcuts` label) and `reconcileShortcuts()` (~line 599, alongside the Help→RTFM / Case Files→My Cases rules).
- Test: `test/shortcut-reconcile.test.ts`.

**Interfaces:**
- Consumes: `reconcileShortcuts(list, seeded)` (existing).
- Produces: fresh installs and existing installs both show the `id:'ai'` shortcut labelled `'Q'` (target `'ai-assistant'` unchanged).

**Why:** The Access menu renders the hardcoded `s.label` (`AccessMenu.tsx:91`), not the registry `title` (already `'Q'`). So `defaultShortcuts` label must change AND — like Help→RTFM — a reconcile rule must rewrite the persisted default `'AI Assistant'` → `'Q'`, or existing installs stay stale after update. Do NOT rename a user-customised label.

- [ ] **Step 1: Write the failing tests** (mirror the RTFM cases): (a) a persisted `{id:'ai', label:'AI Assistant', target:'ai-assistant'}` reconciles to label `'Q'`; (b) a user-customised `{id:'ai', label:'My AI', target:'ai-assistant'}` is preserved; (c) `defaultShortcuts` for `target:'ai-assistant'` has label `'Q'`.
- [ ] **Step 2: Run them, verify they fail.**
- [ ] **Step 3: Implement.** Change `defaultShortcuts` line 560 label to `'Q'`. In `reconcileShortcuts`, add a normalize rule: if a shortcut with `target === 'ai-assistant'` (or `id === 'ai'`) has label exactly `'AI Assistant'`, set it to `'Q'` — same shape/placement as the existing `'Help'→'RTFM'` and `'Case Files'→'My Cases'` normalizations.
- [ ] **Step 4: Run tests, verify pass** (`pnpm test shortcut-reconcile settings-shortcuts`).
- [ ] **Step 5: Commit** — `feat(ui): finish Q rename in the Access menu (+ migrate existing installs)`.

---

### Task 6: Clearnet DDG search path (separate, opt-in) — `searchWebClearnet`

**Files:**
- Modify: `src/main/services/web-search/ddg.ts` — add `searchWebClearnet(query, opts?)`, reusing `parseDdgResults`.
- Test: `test/web-search-ddg.test.ts`.

**Interfaces:**
- Consumes: `parseDdgResults` (existing, unchanged), `MAX_RESULTS`.
- Produces: `searchWebClearnet(query: string, opts?: { fetchImpl?: typeof fetch }): Promise<WebResult[]>` — a plain `https` fetch to `https://html.duckduckgo.com/html/?q=…` (clearnet, NOT `torFetch`, NOT onion). Injectable `fetchImpl` for tests.

**Why / charter:** This is the ONLY new clearnet egress and it is deliberately a distinct function so the Tor `searchWeb` stays `.onion`-enforced and untouched. Results are still untrusted (Task caller fences them). This function does not decide policy — the ai.ts loop (Task 7) decides whether it may run.

- [ ] **Step 1: Write the failing test.** `searchWebClearnet` with an injected `fetchImpl` returning the DDG `/html/` fixture yields the parsed results; it targets `html.duckduckgo.com` (assert the URL passed to `fetchImpl`); it never imports/uses `torFetch`.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement.** Add `searchWebClearnet` using global `fetch` (or injected), `q` trimmed, URL `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, `User-Agent: Mozilla/5.0`, on non-200/throw return `[]`, else `parseDdgResults(body)`. No onion, no Tor.
- [ ] **Step 4: Run tests, verify pass** (`pnpm test web-search-ddg` — existing Tor tests must stay green).
- [ ] **Step 5: Commit** — `feat(ai): add opt-in clearnet DDG search path (separate from Tor onion)`.

---

### Task 7: ai.ts loop — visible search result status + opt-in clearnet fallback on empty

**Files:**
- Modify: `src/main/services/ai.ts:~105-142` (the web-search directive loop).
- Test: extract the fallback decision into a pure helper and unit-test it, or test the loop with injected `searchWeb`/`searchWebClearnet`/`emit` seams. Add `test/web-search-fallback.test.ts`.

**Interfaces:**
- Consumes: `searchWeb` (Tor, unchanged), `searchWebClearnet` (Task 6), `settings.ai.webSearch`, `settings.ai.webSearchClearnet` (Task 1), `formatWebResults`, `emit`.
- Produces: after each search, a visible status line in the chat stream; when Tor returns 0 results AND `webSearchClearnet` is on, a clearnet query with an explicit deanon warning line.

**Behavior (exact):** In the loop, after `const results = await searchWeb(q, { caseId })`:
1. If `results.length > 0`: emit `\n(${results.length} result(s) over Tor)\n`, then feed `formatWebResults(q, results, fence)` as today.
2. Else (0 results):
   - If `s.ai.webSearchClearnet` is true: emit `\n\n⚠ Tor search returned nothing — falling back to CLEARNET for “${q}”. Your real IP is exposed to these results and their hosts.\n\n`, then `const cn = await searchWebClearnet(q)`, emit `\n(${cn.length} result(s) over CLEARNET)\n`, feed `formatWebResults(q, cn, fence)`.
   - Else: emit `\n⚠ no web results (Tor search returned nothing).\n`, feed `formatWebResults(q, [], fence)` (existing empty-preamble tells the model to say so).

The deanon warning is emitted to the **user stream** regardless of what the model does — the visibility fix does not depend on the abliterated model relaying it.

- [ ] **Step 1: Write the failing test.** Pure helper `planWebSearch({ torResults, clearnetOn })` returns a discriminated decision `{ mode: 'tor' | 'clearnet' | 'empty' }`: torResults non-empty → `tor`; empty + clearnetOn → `clearnet`; empty + !clearnetOn → `empty`. Assert clearnet is chosen ONLY when opted in AND Tor empty.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** the helper and wire the loop per the exact behavior above, using the helper for the branch and emitting the status/warning lines. Keep `MAX_WEB_SEARCHES` bound intact (a clearnet fallback for one directive counts as that one search, not an extra).
- [ ] **Step 4: Run tests, verify pass** (`pnpm test web-search-fallback web-search-directive`).
- [ ] **Step 5: Commit** — `feat(ai): visible web-search status + opt-in clearnet fallback when Tor returns nothing`.

---

### Task 8: In-conversation web-search toggle(s) in the AI toolbar

**Files:**
- Modify: `src/renderer/modules/ai-assistant/AiAssistantModule.tsx` toolbar (~line 603-641), reading `settings` (line 63) and writing via `patchSettings` (line 64, example usage line 221).
- Modify: `src/renderer/modules/settings/SettingsModule.tsx:~388` — add the clearnet checkbox in Settings too (labelled with the deanon warning), directly under the existing Tor web-search checkbox.
- Test: a light renderer/logic test if the module has a testable seam; otherwise assert the settings binding via existing settings tests. (This task is primarily UI; keep it minimal and rely on the shared `patch` path already covered.)

**Interfaces:**
- Consumes: `settings.ai.webSearch`, `settings.ai.webSearchClearnet`, `patchSettings`.
- Produces: a compact toolbar toggle for "Search web (Tor)" bound to `ai.webSearch`, reachable mid-conversation (the circled region in GhostExodus's screenshot). Optionally a second compact toggle/indicator for clearnet, or leave clearnet to Settings only — but its Settings checkbox with the deanon warning is required.

- [ ] **Step 1:** Add the Settings clearnet checkbox under `SettingsModule.tsx:388`, bound to `ai.webSearchClearnet`, label e.g. "Allow CLEARNET fallback when Tor search fails (⚠ exposes your real IP to results — off by default)".
- [ ] **Step 2:** Add a compact `<label><input type=checkbox checked={settings?.ai.webSearch ?? false} onChange={e => void patchSettings({ ai: { ...settings.ai, webSearch: e.target.checked } })}/> Web (Tor)</label>` in the AI toolbar next to "Include file contents".
- [ ] **Step 3:** `pnpm typecheck`; run any affected settings tests.
- [ ] **Step 4:** Manually reason through sync: toggling in the toolbar updates Settings and vice-versa (same `patch` → `window.api.settings.update` path).
- [ ] **Step 5: Commit** — `feat(ui): in-conversation web-search toggle + Settings clearnet opt-in`.

---

## Whole-branch adversarial review (after all tasks)

Parallel reviewers, refute-by-default verify, auto-fix only confirmed-CRITICAL:
- **Charter/egress:** does any path let clearnet run when `webSearchClearnet` is false? Is the Tor onion path still `.onion`-enforced and fail-closed? Any new non-loopback, non-opt-in-clearnet egress? Is the deanon warning always emitted before/at a clearnet query?
- **Correctness:** does the embed gate now start 11435 in the real packaged layout (bin + EMBED_MODEL_PRESENT, no MODEL_PRESENT)? Does health return `model-missing` correctly? Does the fallback fire only on empty+opt-in?
- **Prompt-injection:** clearnet results go through the same fence/scrub as Tor results (no bypass).
- **Regression/merge:** new `ai.webSearchClearnet` is in the `mergeSettings` list (no dataloss); no pre-existing dirty file staged; internal keys/roles unchanged.

## Verification (controller, before merge)

- `pnpm test` full suite green; `pnpm typecheck` clean (both configs).
- Re-read the diff for the four global constraints.
- Confirm the embed fix by reasoning through the packaged resource layout (bin + `EMBED_MODEL_PRESENT`, no `MODEL_PRESENT`) → `embedBundled()` true → 11435 spawns → embeddings hit the bundled model.
