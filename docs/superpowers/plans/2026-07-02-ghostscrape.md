# GhostScrape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new top-level module, **GhostScrape**, that scrapes an X (Twitter) user's timeline (tweets / retweets / bio, with date filtering) by driving a hidden, cookie-authenticated Electron browser session against x.com and capturing its GraphQL — reusing the existing X Intel session cookies, staying inside the clearnet X quarantine, and exporting results / saving them to a case.

**Architecture:** A reimplementation ("made our own", MIT-attributed to ZenScraper by 0Day3xpl0it) of a Playwright scraper onto **native Electron primitives**: a hidden `BrowserWindow` on a locked-down `persist:ghostscrape` session partition, cookies injected via `session.cookies.set`, scrolling via `webContents.executeJavaScript`, and GraphQL response capture via `webContents.debugger` (CDP). Load-bearing parsing/decision logic lives in pure, node-tested helpers; the browser/CDP glue is thin and verified by manual smoke + the whole-branch review (it cannot be exercised headlessly — there is no X login in CI).

**Tech Stack:** Electron main (`BrowserWindow`, `session`, `webContents.debugger`), React renderer, Zustand, Vitest (node env, `test/`), TypeScript strict.

## Global Constraints

- **Clearnet X quarantine.** GhostScrape's main code lives under `src/main/x/ghostscrape/` so the existing X-2 import sentinel (`test/x-collector-contracts.test.ts`) covers it automatically. It MUST NOT import any Tor/bgconn code (`src/main/bgconn/*`, `chat/transport-tor`, `chat/socks5`, `searchlight/tor-socks`, `socmint/collector`). Secrets, settings, and storage are **injected** from `register.ts` (outside `x/`) — never imported inside `x/ghostscrape/` — mirroring how `x/collector.ts` receives `getSecret`. Importing `electron` is fine. Replicate the quarantine header comment from `src/main/x/ipc.ts:18-24` in GhostScrape's entry files.
- **Reuse the existing X gate + cookies.** Egress is gated by the SAME two flags as X Intel — `settings.x.networkEnabled && settings.x.clearnetAcknowledged` (both default false). Credentials are the SAME shared store: `x.accounts.<accountId>.{auth_token,ct0}` via injected `getSecret`. Do NOT add a `settings.ghostscrape` namespace or a second cookie store. Account list reuses the existing `window.api.x.listAccounts()` from the renderer.
- **No new egress path.** The only network is the hidden browser's own clearnet HTTPS to x.com (the user's session, their IP — intrinsic to session-cookie scraping; surface this honestly in-UI). No Tor. No telemetry. No new outbound host in main outside the browser window.
- **Encrypted at rest.** Save-to-case reuses the existing `window.api.files.*` attachment API from the **renderer** (which already encrypts via secure-fs) — GhostScrape's main code writes nothing to disk itself.
- **Attribution.** Each new source file that ports ZenScraper logic carries a header: `Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native Electron primitives.`
- **Commits:** persona `Dezirae-Stark <213370007+Dezirae-Stark@users.noreply.github.com>`. NEVER emit `Co-Authored-By:` / `Signed-off-by:` / `Claude-Session:` trailers. Stage only files you changed (never `git add -A`). Do not touch pre-existing dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`).
- **No release in this plan.** No version bump, no installer, no publish. Left green for the v3.26.0 package (OSINT Toolkit still to come).
- Renderer `.tsx` is not headlessly testable → logic in pure helpers, tested.

## Reference

The original scraper is stashed at `/tmp/claude-0/-dcs98/956dbabe-6cc6-4375-9e68-f4a21d90048d/scratchpad/zs_zenscraper.py` (27 KB). **Read it** for the exact X GraphQL response shape (the timeline `instructions`/`entries`/`itemContent`/`tweet_results`/`result`/`legacy` paths, and the `UserByScreenName`/`UserTweets`/`UserTweetsAndReplies` endpoints) when porting `parse.ts`. Port the extraction logic; do not copy verbatim.

## File Structure

**Main — `src/main/x/ghostscrape/` (quarantined):**
- `types.ts` — `ScrapedTweet`, `ScrapedProfile`, `GhostScrapeConfig`, `GhostScrapeResult`.
- `graphql-urls.ts` — pure URL matcher `isTimelineGraphqlUrl(url)` / `isProfileGraphqlUrl(url)`.
- `parse.ts` — pure: GraphQL JSON → `ScrapedTweet[]` / `ScrapedProfile`; date filter; dedupe; cap.
- `scroll-control.ts` — pure: `shouldContinueScroll(state)`.
- `cookies.ts` — pure: `buildXCookies(authToken, ct0)` → Electron `CookiesSetDetails[]`.
- `capture.ts` — glue: CDP GraphQL capture over `webContents.debugger`.
- `browser.ts` — glue: hidden `BrowserWindow` on `persist:ghostscrape`, cookie inject, navigate, scroll, teardown.
- `job.ts` — glue: orchestrate a scrape job (config → result), progress, cancel.
- `ipc.ts` — main handlers factory (injected deps: `getSecret`, `networkEnabled`, `clearnetAcknowledged`).

**Renderer — `src/renderer/modules/ghostscrape/`:**
- `scrape-request.ts` — pure: `buildScrapeRequest` / `canScrape`.
- `results-view.ts` — pure: table rows + sort.
- `export.ts` — pure: JSON/TXT/CSV (CSV-injection safe).
- `GhostScrapeModule.tsx` — thin shell.
- `ghostscrape.css`.

**Wiring:** `src/renderer/state/store.ts` (ModuleKey union), `src/renderer/modules/register-builtins.tsx` (import + adapter + `registerModule`), `src/shared/ipc-contracts.ts` (`ghostscrape:` channels), `src/preload/index.ts` + `src/preload/api.d.ts` (`window.api.ghostscrape.*`), `src/main/ipc/register.ts` (wire handlers with injected deps).

---

## Task 1: Types + GraphQL URL matcher (pure)

**Files:** Create `src/main/x/ghostscrape/types.ts`, `src/main/x/ghostscrape/graphql-urls.ts`; Test `test/ghostscrape-graphql-urls.test.ts`.

**Interfaces — Produces:**
```ts
// types.ts
export type ScrapeType = 'all' | 'tweets' | 'retweets' | 'bio';
export interface ScrapedTweet { id: string; text: string; createdAt: string; isRetweet: boolean; likeCount: number; retweetCount: number; replyCount: number; url: string; }
export interface ScrapedProfile { handle: string; displayName: string; bio: string; followers: number; following: number; joined: string; }
export interface GhostScrapeConfig { accountId: string; username: string; type: ScrapeType; sinceAfter?: string; before?: string; scrolls: number; max: number; delayMs: number; }
export interface GhostScrapeResult { profile?: ScrapedProfile; tweets: ScrapedTweet[]; partial: boolean; captured: number; }
// graphql-urls.ts
export function isTimelineGraphqlUrl(url: string): boolean; // matches UserTweets / UserTweetsAndReplies
export function isProfileGraphqlUrl(url: string): boolean;   // matches UserByScreenName
```

- [ ] **Step 1: Failing test** — `test/ghostscrape-graphql-urls.test.ts`: `isTimelineGraphqlUrl('https://x.com/i/api/graphql/abc/UserTweets?variables=...')` → true; `UserTweetsAndReplies` → true; `UserByScreenName` → false for timeline / true for profile; a non-graphql URL (`https://x.com/home`) → false for both.
- [ ] **Step 2:** Run → FAIL. `pnpm vitest run test/ghostscrape-graphql-urls.test.ts`
- [ ] **Step 3:** Implement types + matchers (literal `.includes('/UserTweets')` etc. — NEVER `new RegExp` on runtime input).
- [ ] **Step 4:** Run → PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(ghostscrape): scrape types + GraphQL url matchers`.

## Task 2: GraphQL parser (pure) — the core

**Files:** Create `src/main/x/ghostscrape/parse.ts`; Test `test/ghostscrape-parse.test.ts` + fixtures under `test/fixtures/ghostscrape/`.

**Interfaces — Consumes:** Task 1 types. **Produces:**
```ts
export function parseTimeline(rawResponses: unknown[]): ScrapedTweet[]; // flatten instructions→entries→tweet_results→legacy
export function parseProfile(rawResponse: unknown): ScrapedProfile | null;
export function applyFilters(tweets: ScrapedTweet[], cfg: Pick<GhostScrapeConfig,'type'|'sinceAfter'|'before'|'max'>): ScrapedTweet[]; // retweet filter + ISO date window + dedupe by id + cap at max, newest-first, deterministic
```

- [ ] **Step 1: Read the reference** — read the stashed `zs_zenscraper.py` for the exact JSON paths, then build 2 small fixtures in `test/fixtures/ghostscrape/`: `timeline.json` (a minimal but real-shaped `UserTweets` response with ~3 tweets incl. one retweet) and `profile.json` (a `UserByScreenName` response).
- [ ] **Step 2: Failing test** — `parseTimeline([fixture])` returns the 3 tweets with correct id/text/createdAt/isRetweet; `parseProfile(fixture)` returns the handle/bio/followers; `applyFilters` with `type:'tweets'` drops the retweet; with a `sinceAfter`/`before` window drops out-of-range; dedupes duplicate ids; caps at `max`; malformed input → `[]`/`null` (never throws).
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement (tolerant traversal — optional chaining, guard every level; deterministic sort by createdAt desc then id). **Step 5:** Run → PASS; `pnpm typecheck`. **Step 6:** Commit `feat(ghostscrape): pure GraphQL timeline/profile parser + filters`.

## Task 3: Scroll control + cookie builder (pure)

**Files:** Create `src/main/x/ghostscrape/scroll-control.ts`, `src/main/x/ghostscrape/cookies.ts`; Test `test/ghostscrape-scroll-control.test.ts`, `test/ghostscrape-cookies.test.ts`.

**Interfaces — Produces:**
```ts
export interface ScrollState { scrollsDone: number; newItemsLastRound: number; totalCaptured: number; maxScrolls: number; maxItems: number; emptyRoundsInARow: number; }
export function shouldContinueScroll(s: ScrollState): boolean; // stop when scrollsDone>=maxScrolls OR totalCaptured>=maxItems OR emptyRoundsInARow>=2
// cookies.ts
export interface XCookie { url: string; name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; }
export function buildXCookies(authToken: string, ct0: string): XCookie[]; // .x.com, secure, path '/', url 'https://x.com'
```

- [ ] **Step 1: Failing tests** — `shouldContinueScroll`: continues mid-sweep; stops at maxScrolls, at maxItems, and after 2 empty rounds. `buildXCookies('AT','CT')` → two cookies (auth_token, ct0) for `.x.com`, `secure:true`, url `https://x.com`; empty inputs → only the non-empty ones (never a cookie with an empty value).
- [ ] **Step 2–5:** FAIL → implement → PASS + typecheck → commit `feat(ghostscrape): pure scroll-control + X cookie builder`.

## Task 4: CDP capture + hidden browser (glue)

**Files:** Create `src/main/x/ghostscrape/capture.ts`, `src/main/x/ghostscrape/browser.ts`. No new unit test (browser/CDP glue is not headlessly testable — the pure seams it uses are already tested in Tasks 1-3). Verified by `pnpm typecheck` + manual smoke + whole-branch review.

**Interfaces — Produces:**
```ts
// capture.ts — attach CDP to a webContents, buffer GraphQL response bodies matching the url filters.
export interface Capture { readonly raw: unknown[]; detach(): void; }
export function attachGraphqlCapture(wc: Electron.WebContents, match: (url: string) => boolean): Capture;
// browser.ts — a hidden, locked-down, cookie-injected session window.
export interface ScrapeWindow { navigate(url: string): Promise<void>; scrollToBottom(): Promise<void>; clickLatest(): Promise<void>; readonly webContents: Electron.WebContents; destroy(): void; }
export async function openScrapeWindow(cookies: XCookie[]): Promise<ScrapeWindow>;
```

- [ ] **Step 1: Implement `capture.ts`** — `wc.debugger.attach('1.3')`, `sendCommand('Network.enable')`, on `'message'` for `Network.responseReceived` whose `response.url` passes `match`, record the `requestId`; on `Network.loadingFinished` for a recorded id call `Network.getResponseBody` and `JSON.parse` the body into `raw` (guard/skip parse errors). `detach()` removes listeners + `wc.debugger.detach()`.
- [ ] **Step 2: Implement `browser.ts`** — `const ses = session.fromPartition('persist:ghostscrape')`; lock it down like `index.ts:265-266` (deny all permission requests/checks); `new BrowserWindow({ show:false, webPreferences:{ session: ses, sandbox:true, nodeIntegration:false, contextIsolation:true } })`; `await ses.cookies.set(c)` for each cookie; `navigate` = `loadURL` + wait for load; `scrollToBottom` = `executeJavaScript('window.scrollTo(0, document.body.scrollHeight)')`; `clickLatest` = best-effort `executeJavaScript` clicking the "Latest" tab; `destroy` closes the window. Header comment: quarantine + MIT attribution.
- [ ] **Step 3:** `pnpm typecheck` clean.
- [ ] **Step 4:** Commit `feat(ghostscrape): hidden locked-down browser window + CDP GraphQL capture`.

## Task 5: Job orchestration (glue)

**Files:** Create `src/main/x/ghostscrape/job.ts`. No new unit test (orchestration glue; the decisions it makes — scroll continuation, parsing, filtering — are all tested pure helpers). Typecheck + manual smoke + whole-branch review.

**Interfaces — Consumes:** Tasks 1-4. **Produces:**
```ts
export interface JobDeps { getSecret(key: string): Promise<string | null>; onProgress(p: { captured: number; scrollsDone: number }): void; }
export async function runScrapeJob(cfg: GhostScrapeConfig, deps: JobDeps, signal: AbortSignal): Promise<GhostScrapeResult>;
```
Flow: read `x.accounts.<cfg.accountId>.{auth_token,ct0}` via `deps.getSecret`; if missing → throw a typed `GhostScrapeNoCredsError`. `buildXCookies` → `openScrapeWindow`. For `bio`/`all`: navigate `x.com/<username>`, capture profile. For tweets/retweets/all: `clickLatest`, then loop `shouldContinueScroll` → `scrollToBottom` + wait `cfg.delayMs` + track new-items via `parseTimeline(capture.raw).length`; honor `signal.aborted` (stop, mark `partial:true`). Finally `parseTimeline` + `applyFilters`, `parseProfile`, `destroy()` the window (in a `finally`), return the result.

- [ ] **Step 1:** Implement per the flow. **Step 2:** `pnpm typecheck`. **Step 3:** Commit `feat(ghostscrape): scrape job orchestration (navigate/scroll/capture/parse, cancelable)`.

## Task 6: IPC + preload (gate reuse, injected deps)

**Files:** Create `src/main/x/ghostscrape/ipc.ts`; Modify `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/main/ipc/register.ts`. No new unit test (IPC glue).

**Interfaces — Produces (`window.api.ghostscrape`):**
```ts
start(cfg: GhostScrapeConfig): Promise<{ jobId: string }>; // throws GhostScrapeGatedError if gate closed
cancel(jobId: string): Promise<void>;
onProgress(cb: (p: { jobId: string; captured: number; scrollsDone: number }) => void): () => void;
onDone(cb: (d: { jobId: string; result?: GhostScrapeResult; error?: string }) => void): () => void;
```
`ipc.ts` exports `createGhostScrapeHandlers(deps: { getSecret; networkEnabled; clearnetAcknowledged; getWindow })`. `start` first checks `await networkEnabled() && await clearnetAcknowledged()` → else throw `GhostScrapeGatedError` (mirror `XCollectorGatedError`, `x/ipc.ts:44-53`); tracks jobs by id with an `AbortController`; runs `runScrapeJob` and emits progress/done. `register.ts` wires the injected deps exactly like the X handlers (`register.ts:1650-1651` for the gate, `getSecret: (k)=>secretStore.get(k)`). Account list + save-to-case are NOT new handlers — the renderer uses existing `window.api.x.listAccounts()` and `window.api.files.*`.

- [ ] **Step 1:** Add channels + preload + `api.d.ts` types + `ipc.ts` + `register.ts` wiring. **Step 2:** `pnpm typecheck`. **Step 3:** Commit `feat(ghostscrape): gated IPC (reuses X two-flag gate + shared cookies via injected deps)`.

## Task 7: Renderer pure helpers

**Files:** Create `src/renderer/modules/ghostscrape/scrape-request.ts`, `results-view.ts`, `export.ts`; Test `test/ghostscrape-scrape-request.test.ts`, `test/ghostscrape-results-view.test.ts`, `test/ghostscrape-export.test.ts`.

**Interfaces — Produces:**
```ts
// scrape-request.ts
export function buildScrapeRequest(p: {...}): GhostScrapeConfig; // trims username (strip leading @), clamps scrolls/max/delay to sane bounds
export function canScrape(p: { networkEnabled: boolean; clearnetAcknowledged: boolean; accountId: string; username: string; running: boolean }): boolean;
// results-view.ts
export function toRows(r: GhostScrapeResult): {...}[]; export function sortRows(rows, key, dir): {...}[];
// export.ts
export function toJson(r: GhostScrapeResult): string; export function toTxt(r): string; export function toCsv(r): string; // CSV cells with =,+,-,@ leading char are prefixed with ' (formula-injection safe); quotes doubled
```

- [ ] **Step 1: Failing tests** — `buildScrapeRequest` strips a leading `@`, clamps `max` to its ceiling; `canScrape` false unless both gate flags + account + username + !running; `toCsv` neutralizes a tweet text starting with `=`/`+`/`@`, doubles quotes; `toJson`/`toTxt` round-trip a result; `sortRows` deterministic.
- [ ] **Step 2–5:** FAIL → implement → PASS + typecheck → commit `feat(ghostscrape): renderer request/results/export helpers (CSV-injection safe)`.

## Task 8: Renderer module + registration

**Files:** Create `src/renderer/modules/ghostscrape/GhostScrapeModule.tsx`, `ghostscrape.css`; Modify `src/renderer/state/store.ts` (ModuleKey union), `src/renderer/modules/register-builtins.tsx`; Test `test/ghostscrape-module-registered.test.ts`.

- [ ] **Step 1: Failing test** — `test/ghostscrape-module-registered.test.ts` mirrors `test/x-module-registered.test.ts`: after importing register-builtins, `getModule('ghostscrape')` is defined with title `'GhostScrape'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `| 'ghostscrape'` to the ModuleKey union (`store.ts:47`); import `GhostScrapeModule` + define `GhostScrapeAdapter({spec})` (mirror `XCollectorAdapter`) + `registerModule({ key:'ghostscrape', title:'GhostScrape', glyph:'🐦', component:GhostScrapeAdapter, builtin:true, defaultWidth:960, defaultHeight:680 })` in register-builtins.tsx. Build the `.tsx` shell: account `<select>` (from `window.api.x.listAccounts()`), username input, type radios, date range, scrolls/max/delay, Start/Cancel, progress, results table (from `results-view`), export buttons (from `export.ts`), Save-to-case (case picker via `window.api.cases.list()` → `window.api.files.*`). Gate-closed and no-account states show a visible reason (not a dead button). All scraped text rendered as React text children (XSS-safe). Honest in-UI note: "drives a real logged-in browser from your clearnet IP."
- [ ] **Step 4:** Run test → PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(ghostscrape): renderer module + top-level registration`.

## Task 9: Quarantine + attribution verification

**Files:** Modify `test/x-collector-contracts.test.ts` ONLY IF a legitimate new cross-dir import needs allowlisting (it should not — GhostScrape uses injected deps + electron). Confirm the sentinel passes over `src/main/x/ghostscrape/`.

- [ ] **Step 1:** Run `pnpm vitest run test/x-collector-contracts.test.ts` — the X-2 sentinel now also walks `x/ghostscrape/`. If it fails on a forbidden import, FIX the import (use an injected dep instead) rather than widening the allowlist; only add to `ALLOWED_CROSS_DIR` if the dep is genuinely safe (no Tor) and unavoidable, with a comment.
- [ ] **Step 2:** Grep the new files for the MIT attribution header; add any missing.
- [ ] **Step 3:** `pnpm typecheck` + `pnpm test` green.
- [ ] **Step 4:** Commit `test(ghostscrape): confirm clearnet quarantine + MIT attribution` (only if files changed; otherwise skip).

---

## Verification (whole-branch, before proposing anything)

- `pnpm typecheck` clean; `pnpm test` fully green (record the total).
- Commit security-review gate on the branch diff. XSS: scraped tweet/profile text + username in the module and CSV/TXT/JSON export. Egress: confirm no Tor/bgconn import from `x/ghostscrape/` (sentinel green); the ONLY network is the hidden browser to x.com; no new outbound host in main; no telemetry. Cookies: injected only into the isolated `persist:ghostscrape` partition; never logged; never sent to the renderer.
- Quarantine: `test/x-collector-contracts.test.ts` green (covers `x/ghostscrape/`).
- Gate: scraping refused unless `settings.x.networkEnabled && clearnetAcknowledged`; missing-account and gate-closed states show a visible reason.
- No release: version unchanged; branch left green for the v3.26.0 package (OSINT Toolkit next).

## Self-Review (author)

- **Coverage:** types/urls (T1), parser (T2), scroll+cookies (T3), browser+capture (T4), job (T5), IPC/gate (T6), renderer helpers (T7), module+registration (T8), quarantine (T9). Pure cores are TDD; browser/CDP glue is honestly flagged as manual-smoke + whole-branch-review.
- **Type consistency:** `GhostScrapeConfig`/`GhostScrapeResult`/`ScrapedTweet` defined in T1, used identically in T2/T5/T6/T7; `XCookie` (T3) consumed by `openScrapeWindow` (T4) + `runScrapeJob` (T5).
- **Charter:** quarantine via directory placement + injected deps; reuse X gate + cookies; no new egress; encrypted save via existing files API; MIT attribution.
