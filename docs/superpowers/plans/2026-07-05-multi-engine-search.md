# Multi-engine web-search picker (DuckDuckGo + SearXNG) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Let the user pick the search engine Q uses via a `SearchEngine` registry — shipping **DuckDuckGo** (existing, onion) and **SearXNG** (new, onion metasearch aggregating Google/Bing/etc.), both onion-to-onion / IP-hidden. A Firefox-style toolbar picker.

**Architecture:** Refactor the hard-wired DDG search into a pluggable registry; add a SearXNG engine parsing the real captured JSON. No clearnet engine ships (verified: Google/Bing/Yandex block scraping). Full spec — read it: `docs/superpowers/specs/2026-07-05-multi-engine-search-design.md`. **Real fixtures already committed:** `test/fixtures/search/searxng-results.json` (11 real results) + `ddg-onion-results.html` (control).

**Tech Stack:** TypeScript, Electron main, React 18, Vitest. No new deps.

## Global Constraints

- **Commit identity:** author/committer `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`. NEVER emit `Co-Authored-By`/`Signed-off-by`/`Claude-Session`/any AI trailer.
- **Never stage pre-existing dirty files:** `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`. Stage only your task's files.
- **Egress (charter):** both engines are onion — `.onion`-ENFORCED fail-closed (a non-onion endpoint, default or operator-misconfigured, returns `[]` — never routes a clearnet host through Tor). No clearnet egress added. No telemetry.
- **Parsers verified against REAL fixtures only** — parse `test/fixtures/search/*`; do NOT invent formats.
- **Untrusted-data fence preserved:** search results stay untrusted (the existing per-request fence in `ai.ts` — newline-strip + URL-sanitize + per-request fence — must still wrap every engine's results).
- **Determinism:** parsers pure; no Date.now/Math.random. Run `pnpm test` + `pnpm typecheck` before each commit.
- Branch `feat/multi-engine-search`. jsdom component tests mirror `test/x-ghostscrape-cases-sidebar.test.tsx`; IPC/loop tests reuse existing web-search test patterns.

---

### Task 1: `SearchEngine` registry + DDG extraction (behavior-preserving)

**Files:** Create `src/main/services/web-search/registry.ts`. Modify `src/main/services/web-search/ddg.ts` (export a DDG `SearchEngine` descriptor wrapping the existing `searchWeb`). Test: `test/web-search-registry.test.ts`.

**Produces:** `interface SearchEngine { id: string; label: string; egress: 'tor' | 'clearnet'; run(query: string, deps?): Promise<{ results: WebResult[]; reason: SearchReason }> }`; `SEARCH_ENGINES: Record<string, SearchEngine>` + `getEngine(id: string): SearchEngine` (unknown id → DDG fallback); the `ddg` descriptor (`egress:'tor'`, `run` = the existing `searchWeb` adapted to return `{results, reason}` — DDG's `searchWeb` already reports a `SearchReason` via `onReason`, so wrap it). `searchWeb`/`parseDdgResults`/`.onion` enforcement UNCHANGED — this is a wrapping extraction, not a rewrite.

- [ ] Tests: `getEngine('ddg')` returns the DDG descriptor with `egress:'tor'`; `getEngine('nonexistent')` falls back to DDG; DDG's `run` delegates to `searchWeb` (mock the fetch, assert the onion endpoint + results). Existing `ddg` tests stay green. TDD, run suite + typecheck, commit.

### Task 2: SearXNG engine + JSON parser (against the real fixture)

**Files:** Create `src/main/services/web-search/searxng.ts`. Test: `test/web-search-searxng.test.ts` (uses `test/fixtures/search/searxng-results.json`).

**Consumes:** `torFetch`/`ensurePluginTor` (like ddg.ts), `WebResult`/`SearchReason`.
**Produces:** `parseSearxngJson(body: string): WebResult[]` — `JSON.parse` → `results[]` → `{ title: r.title, url: r.url, snippet: r.content ?? '' }`, skipping entries with no `url`; malformed JSON / no results → `[]`, never throws. `DEFAULT_SEARXNG_ONION = 'http://searxokthnxmo7ndis35jpts2tawcwvbovuy47qtavwo7oq4jgcm5gqd.onion'`. `searxngEngine: SearchEngine` (`egress:'tor'`) whose `run(query, {endpoint})` fetches `${endpoint}/search?q=<enc>&format=json` via `torFetch` with `{ headers: {'User-Agent':'Mozilla/5.0','Accept':'application/json'} }`, **`.onion`-enforced** on the endpoint host (fail-closed → `bad-endpoint`/`[]`), maps via `parseSearxngJson`, reports the `SearchReason` (ok/no-results/tor-unavailable/blocked/bad-endpoint).

- [ ] Tests: `parseSearxngJson(fixture)` → **11** `WebResult`s with the first = `{title:'OpenBSD', url:'https://www.openbsd.org/', snippet: startsWith('The OpenBSD project')}`; a result with no `url` is skipped; `'{}'`/`'not json'`/`''` → `[]` (no throw); `run` with a non-onion endpoint → `[]` + `bad-endpoint` (never fetches); `run` maps a mocked fetch of the fixture to 11 results. TDD, run suite + typecheck, commit.

### Task 3: Settings — selected engine + SearXNG instance

**Files:** `src/shared/types.ts` (`ai.searchEngine: string` default `'ddg'`; `ai.searxngOnion: string` default `DEFAULT_SEARXNG_ONION`). Test: settings-merge test.

**Produces:** the two `ai` fields; both upgrade via the existing `{...base.ai, ...patch.ai}` merge (`json-fs.ts:930`) — add to `defaultSettings.ai` + the type only.

- [ ] Test: an old `settings.json` whose `ai` lacks `searchEngine`/`searxngOnion` merges to include them (defaults `'ddg'` / the pinned onion) with existing `ai` fields preserved. TDD, run suite + typecheck, commit.

### Task 4: Loop integration — run the selected engine

**Files:** `src/main/services/ai.ts` (the `[SEARCH:]` handler) + possibly `directive.ts`. Test: extend the existing ai/web-search test.

**Consumes:** Task 1 registry, Task 2 SearXNG, `settings.ai.searchEngine`/`searxngOnion`.
**Produces:** the `[SEARCH: query]` handler resolves `getEngine(s.ai.searchEngine)` and runs `engine.run(query, { endpoint: engine.id==='searxng' ? s.ai.searxngOnion : undefined, caseId })`; the transparency line names the engine (`🔍 searching <label> over Tor for "q"`). **Preserve the existing DDG clearnet-fallback behavior** (planWebSearch/searchWebClearnet + the deanon warning) ONLY for the DDG engine when it returns nothing and `webSearchClearnet` is on; SearXNG (onion) has no clearnet fallback. The untrusted-data fence around results is unchanged.

- [ ] Tests: with `ai.searchEngine='searxng'`, the loop calls the SearXNG engine (mock its run) and formats its results behind the fence; with `'ddg'`, existing DDG behavior (incl. the clearnet fallback path) is preserved; the transparency line names the selected engine. TDD, run suite + typecheck, commit.

### Task 5: Toolbar picker UI

**Files:** `src/renderer/modules/ai-assistant/AiAssistantModule.tsx` (add the engine dropdown next to the existing "Web (Tor)" checkbox). Test: `test/ai-search-engine-picker.test.tsx`.

**Consumes:** `useSettings` (`ai.searchEngine` + patch). Engine list = a small shared const (`[{id:'ddg',label:'DuckDuckGo · Tor'},{id:'searxng',label:'SearXNG · Tor'}]`) — keep it in `src/shared` or a renderer const mirroring the registry ids so main+renderer agree.
**Produces:** a `<select>` bound to `ai.searchEngine`, options DDG + SearXNG (both "· Tor" badge), patching `ai.searchEngine` on change; shown next to the Web (Tor) toggle.

- [ ] Tests (jsdom, mock `window.api`/settings): the picker renders both engines; selecting SearXNG patches `ai.searchEngine='searxng'`; default selection reflects `ai.searchEngine`. TDD, run suite + typecheck, commit.

## Self-review checklist (controller, before adversarial pass)

- Both engines `.onion`-enforced fail-closed; no clearnet egress added; untrusted-data fence intact.
- SearXNG parser verified against the REAL committed fixture (11 results); malformed → [].
- DDG extraction behavior-preserving (existing tests green); DDG clearnet-fallback preserved.
- New `ai` fields upgrade via the existing merge (test proves it).
- Full `pnpm test` + `pnpm typecheck` green; one commit per task, charter author, no trailers.
