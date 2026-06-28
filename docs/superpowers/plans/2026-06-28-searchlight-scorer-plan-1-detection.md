# Searchlight Structural + ML Detection Scorer — Plan 1 (Detection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Implementers run SEQUENTIALLY on the shared git tree (never parallel).

**Goal:** Replace Searchlight's HTTP-200-trusting fallback detection with a structural confidence scorer (heuristic signals + a ported Aliens_eye logistic-regression model, model-driven blend) plus a first-class `maybe` tier, an adaptive two-phase probe, and a modernized sweep-panel UI — killing soft-404 false positives in the uncurated detection tail.

**Architecture:** New pure shared modules (`signals.ts`, `scorer.ts`, `ml.ts`) compute a feature vector and a 0..1 probability; `interpret.ts` routes only its non-curated fallback branches through them via an injected `ScorerCtx` (keeps `interpret.ts` pure — no main-only imports); `sweep.ts` runs an adaptive two-phase probe (HEAD → escalate-to-body on an ambiguous Maybe); the renderer gains a `maybe` badge, sortable columns, a live progress bar, and a summary panel. The ML port is gated behind a parity test against the model's own training set so a fidelity miss falls back to heuristic-only rather than shipping a miscalibrated model.

**Tech Stack:** TypeScript (strict), Electron main + React renderer, Vitest, electron-vite. **No new runtime dependency** — scorer/ml are pure TS; all needed APIs (`secureReadFile`/`secureWriteFile`, `settingsStore`, hashing) already exist.

## Global Constraints

- **No new network egress.** Phase-2 `GET` reuses the existing `socksDial`/`safeFetch` to the SAME hosts; the netns/no-egress gate must still pass. The `maybe` status rides the existing `searchlight:onSweepResult`. Exactly ONE new IPC channel is added — `searchlight.revealSiteDbDir` (Task 14, a local `shell.openPath`, no network) — so the `searchlight` exact-set contract test (`test/searchlight-contracts.test.ts`, if present) and the channel-uniqueness test must be updated in that task.
- **Determinism.** `signals.ts`, `scorer.ts`, `ml.ts` are pure functions of their inputs — NO `Date.now`/`Math.random` inside them (elapsed is an injected field). Same input → identical output.
- **Untrusted-HTML safety.** Body parsing runs in main on untrusted HTML: STATIC regexes only, NEVER `new RegExp(untrustedInput)`; guarded `JSON.parse`; bounded by the existing 64 KB `BODY_CAP`.
- **Model is authoritative & self-describing.** Read `ml_weight`, `thresholds`, `mean`, `scale`, `coef`, `intercept`, `feature_schema` FROM `model.json` (v2.0.0). Never hardcode the `WORKING.md` prose values (0.4 / 0.6 / 0.35) — the shipped model says `ml_weight` 0.6, thresholds 0.5559/0.3224.
- **Heuristic uses Aliens_eye's exact sigmoid SCALE = 6.0** (not re-derived) so `heuristic_score` (feature #30) matches the model's training distribution.
- **Attribution.** Add `THIRD_PARTY_LICENSES` with the Aliens_eye MIT notice (© 2021 Aaron Thomas) covering the vendored `model.json` and the ported extractor.
- **No telemetry / no phone-home.** Unchanged charter baseline.
- **Every feature must be UI-reachable, and zero-config by default.** Detection works out of the box with NO setting to find: adaptive deep-scan ON, `useMl` ON, thresholds from the model. A user just runs a sweep and gets fewer false positives + the `maybe` tier automatically — nothing is gated behind a setting they must discover. The tuning controls (thresholds, deep-scan, ML toggle) are reachable in Settings → Searchlight; the `maybe` tier is reachable as a filter chip. Surface controls with plain-language labels, not internal field names (e.g. expose a "Deep scan (reduce false positives) — recommended" toggle bound to `!lightweightMode`, never the word "lightweightMode").
- **Version target 3.23.0** (no beta) — but DO NOT bump `package.json`, write release notes, or cut a release in this plan; that's an operator-triggered step after both plans land.
- **Spec:** `docs/superpowers/specs/2026-06-28-searchlight-structural-scorer-design.md`.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/searchlight/types.ts` (modify) | `SweepStatus` += `'maybe'`; `SweepResult.probability?: number`; `SignalVector` type |
| `src/shared/searchlight/signals.ts` (create) | `extractSignals(site, raw, url) → SignalVector` — cheap + body signals, static-regex parsing |
| `src/shared/searchlight/keywords.ts` (create) | `POSITIVE_KEYWORDS`, `ERROR_KEYWORDS`, `AUTH_PATH_PATTERNS` constants (English; reconciled to upstream in the parity task) |
| `src/shared/searchlight/scorer.ts` (create) | `DEFAULT_WEIGHTS`, `SIGMOID_SCALE=6`, `scoreSignals()`, `classify()` |
| `src/shared/searchlight/ml.ts` (create) | `MlModel` type, `predict(vector, model)` with standardization, `blend()` |
| `src/main/searchlight/model-store.ts` (create) | load bundled `resources/searchlight/model.json`, expose `getModel()` |
| `src/shared/searchlight/interpret.ts` (modify) | fallback branches route through scorer via optional `ScorerCtx` arg |
| `src/main/searchlight/sweep.ts` (modify) | adaptive two-phase; build `ScorerCtx` from model-store + settings |
| `src/shared/types.ts` (modify) | `AppSettings.searchlight.scorer` + defaults |
| `src/renderer/modules/searchlight/panels/SweepPanel.tsx` (modify) | `maybe` badge + probability %, sortable columns, progress bar, summary panel |
| `src/renderer/modules/searchlight/panels/ReportsPanel.tsx` (modify) | `maybe` row class + stat box |
| `src/renderer/modules/searchlight/searchlight.css` (modify) | `maybe` colors (bg restated on class per cascade rule), sort/summary/progress styles |
| `resources/searchlight/model.json` (create) | vendored Aliens_eye model (gitignored if large, else committed — it's ~KB, commit it) |
| `THIRD_PARTY_LICENSES` (create) | Aliens_eye MIT notice |
| `test/searchlight-signals.test.ts`, `test/searchlight-scorer.test.ts`, `test/searchlight-ml.test.ts` (create); `test/searchlight-interpret.test.ts`, `test/searchlight-sweep.test.ts` (extend) | TDD |

---

### Task 1: Data model — `maybe` status + `probability` field

**Files:** Modify `src/shared/searchlight/types.ts` (line 2 `SweepStatus`; line 42-60 `SweepResult`). This task must leave the whole repo type-checking, so it also patches the renderer `switch` statements that would become non-exhaustive.

**Interfaces — Produces:** `SweepStatus = 'found'|'maybe'|'not_found'|'blocked'|'error'|'unknown'`; `SweepResult.probability?: number`; `SignalVector = Record<string, number>`.

- [ ] **Step 1:** In `types.ts`, change `export type SweepStatus = 'found' | 'not_found' | 'blocked' | 'error' | 'unknown';` to include `'maybe'` (canonical order: `'found' | 'maybe' | 'not_found' | 'blocked' | 'error' | 'unknown'`). Add `probability?: number;` to `SweepResult` (after `confidence`). Add `export type SignalVector = Record<string, number>;`.
- [ ] **Step 2:** `pnpm typecheck` — expect FAILures in `SweepPanel.tsx`/`ReportsPanel.tsx` where `switch (r.status)` is now non-exhaustive or where exhaustive checks exist. Fix minimally: in `SweepPanel.tsx` `statusColor` add `case 'maybe': return '#d8a83a';` and `statusLabel` add `case 'maybe': return 'MAYBE';`. (Full UI in Task 10 — here just keep it compiling.)
- [ ] **Step 3:** `pnpm typecheck` → PASS.
- [ ] **Step 4:** Run `npx vitest run test/searchlight-interpret.test.ts test/x-ipc.test.ts` → PASS (channel-uniqueness unaffected; interpret unchanged).
- [ ] **Step 5:** Commit: `feat(searchlight): add 'maybe' SweepStatus + probability field`.

---

### Task 2: Signal extraction (`signals.ts` + `keywords.ts`)

**Files:** Create `src/shared/searchlight/keywords.ts`, `src/shared/searchlight/signals.ts`, `test/searchlight-signals.test.ts`.

**Interfaces — Consumes:** `MaigretSiteEntry`, `RawCheckResult`, `SignalVector` from `types.ts`. **Produces:** `extractSignals(site: MaigretSiteEntry, raw: RawCheckResult, targetUrl: string): SignalVector` — keys are the model's `feature_schema` names. Cheap keys always present; body keys present (computed) only when `raw.body` is non-empty, else omitted (the ML task fills missing keys with the model `mean`).

**Signal computation (matches the model `feature_schema`):**
- Cheap (no body): `http_200`/`http_3xx`/`http_404`/`http_4xx`/`http_5xx` (1.0 if statusCode in bucket else 0.0), `has_username_in_path` (1.0 if the searched username, lowercased, is a path segment of `targetUrl`), `has_auth_pattern` (1.0 if `targetUrl` or `raw.redirectUrl` path matches any `AUTH_PATH_PATTERNS`), `redirect_count` (1.0 if `raw.redirectUrl` present else 0.0 — Tor path captures one hop), `response_time` (`raw.elapsed`), `content_length` (body length if present else 0).
- Body (when `raw.body`): `title_has_username`/`meta_has_username`/`username_in_canonical` (1.0 if username in the parsed `<title>` / og:title|twitter:title / `<link rel=canonical>`), `og_type_profile` (1.0 if a `<meta property="og:type" content="profile">`), `has_json_ld_person` (1.0 if any `<script type="application/ld+json">` block parses and contains `"@type"` value `Person`), `error_keyword_count`/`positive_keyword_count` (count of distinct ERROR/POSITIVE keywords in body text), `meta_error_keyword_count`/`meta_positive_keyword_count` (same within `<meta>` tag text), `profile_section_count`/`error_section_count` (count of class/keyword hits like `profile`,`avatar`,`followers` vs `error`,`notfound`,`404`), `img_count`/`input_count`/`form_count`/`link_count` (`<img>`/`<input>`/`<form>`/`<a>` tag counts), `text_length` (length of text with tags stripped). `fingerprint_match_found`/`fingerprint_match_not_found`: OMITTED (filled with mean by ML task). `heuristic_score`: OMITTED here (added by the scorer/interpret layer, not the extractor).

**Parsing rules (HARD):** STATIC regexes only — e.g. `/<meta[^>]+property=["']og:type["'][^>]+content=["']profile["']/i`, `/<title[^>]*>([^<]*)<\/title>/i`, `/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i`. JSON-LD: match all `<script type="application/ld+json">...</script>`, `JSON.parse` each in a `try/catch` (malformed → skip, signal stays 0). NEVER build a regex from username or body. Tag counts via `(body.match(/<img\b/gi) || []).length`. Username match is case-insensitive substring.

- [ ] **Step 1: Write the failing test** `test/searchlight-signals.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { extractSignals } from '../src/shared/searchlight/signals';
import type { MaigretSiteEntry, RawCheckResult } from '../src/shared/searchlight/types';

const site = (p: Partial<MaigretSiteEntry> = {}): MaigretSiteEntry => ({
  name: 'S', url: 'https://s.com/{username}', urlMain: 'https://s.com', urlProbe: '',
  category: 'social', tags: [], checkType: 'status_code', presenseStrs: [], absenceStrs: [],
  alexaRank: 1, headers: {}, usernameClaimed: 'admin', ...p });
const raw = (p: Partial<RawCheckResult> = {}): RawCheckResult =>
  ({ statusCode: 200, statusMessage: 'OK', elapsed: 10, redirectUrl: null, error: null, body: '', ...p });

const PROFILE = `<html><head><title>ghostexodus</title>
<meta property="og:type" content="profile">
<link rel="canonical" href="https://s.com/ghostexodus">
<script type="application/ld+json">{"@type":"Person","name":"ghostexodus"}</script>
</head><body><img src=a><img src=b>followers joined posts</body></html>`;
const SOFT404 = `<html><head><title>Page not found</title></head>
<body>Sorry, this account doesn't exist. <a href=/>home</a></body></html>`;

describe('extractSignals', () => {
  it('cheap: 200 status bucket + username in path', () => {
    const v = extractSignals(site(), raw({ statusCode: 200 }), 'https://s.com/admin');
    expect(v.http_200).toBe(1); expect(v.http_404).toBe(0); expect(v.has_username_in_path).toBe(1);
  });
  it('cheap: 404 bucket', () => {
    const v = extractSignals(site(), raw({ statusCode: 404 }), 'https://s.com/admin');
    expect(v.http_404).toBe(1); expect(v.http_200).toBe(0);
  });
  it('body: real-profile markers fire', () => {
    const v = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    expect(v.og_type_profile).toBe(1); expect(v.has_json_ld_person).toBe(1);
    expect(v.title_has_username).toBe(1); expect(v.username_in_canonical).toBe(1);
    expect(v.positive_keyword_count).toBeGreaterThan(0); expect(v.img_count).toBe(2);
  });
  it('body: soft-404 error markers fire, profile markers do not', () => {
    const v = extractSignals(site(), raw({ body: SOFT404 }), 'https://s.com/ghostexodus');
    expect(v.og_type_profile).toBe(0); expect(v.has_json_ld_person).toBe(0);
    expect(v.error_keyword_count).toBeGreaterThan(0);
  });
  it('malformed JSON-LD does not throw', () => {
    const v = extractSignals(site(), raw({ body: '<script type="application/ld+json">{bad</script>' }), 'https://s.com/x');
    expect(v.has_json_ld_person).toBe(0);
  });
  it('determinism: same input → identical vector', () => {
    const a = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    const b = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    expect(a).toEqual(b);
  });
});
```
- [ ] **Step 2:** `npx vitest run test/searchlight-signals.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Create `keywords.ts` with English constants — `POSITIVE_KEYWORDS = ['followers','following','joined','posts','profile','member since','avatar','bio']`, `ERROR_KEYWORDS = ["doesn't exist","not found","no user","page not found","account suspended","removed","404","does not exist"]`, `AUTH_PATH_PATTERNS = ['/login','/signin','/sign_in','/auth']`, `PROFILE_SECTION_HINTS = ['profile','avatar','followers','user-info']`, `ERROR_SECTION_HINTS = ['error','notfound','not-found','404','empty']`. (These are reconciled to upstream verbatim in Task 9; the parity test there is the acceptance gate.) Then implement `signals.ts` per the computation rules above. The username for matching comes from the `targetUrl`'s last path segment (lowercased) — derive it inside `extractSignals` as `decodeURIComponent(targetUrl.replace(/\/+$/,'').split('/').pop() ?? '').toLowerCase()`.
- [ ] **Step 4:** `npx vitest run test/searchlight-signals.test.ts` → PASS.
- [ ] **Step 5:** `pnpm typecheck` → PASS. Commit: `feat(searchlight): structural signal extraction (cheap + body)`.

---

### Task 3: Heuristic scorer (`scorer.ts`)

**Files:** Create `src/shared/searchlight/scorer.ts`, `test/searchlight-scorer.test.ts`.

**Interfaces — Consumes:** `SignalVector`. **Produces:** `DEFAULT_WEIGHTS: Record<string, number>`, `SIGMOID_SCALE = 6`, `scoreSignals(v: SignalVector, weights?: Record<string,number>): number` (0..1), `classify(prob: number, t: { found: number; notFound: number }): { status: 'found'|'maybe'|'not_found'; confidence: 'high'|'medium'|'low' }`.

**Weights (lifted `detector.py` baseline):** `{ http_200: 5, http_404: -10, http_5xx: -3, http_4xx: -2, http_3xx: -1, og_type_profile: 6, has_json_ld_person: 5, meta_has_username: 5, username_in_canonical: 4, profile_section_count: 4, error_section_count: -3, meta_error_keyword_count: -3, meta_positive_keyword_count: 2, error_keyword_count: -2, positive_keyword_count: 1.5, title_has_username: 3, has_username_in_path: 2, has_auth_pattern: -4, img_count: 0.1, form_count: -0.5, input_count: -0.3, link_count: 0.02, redirect_count: -2 }`. `scoreSignals` = `sigmoid(Σ weights[k]·(v[k] ?? 0) / SIGMOID_SCALE)`, `sigmoid(x) = 1/(1+Math.exp(-x))`. `classify`: `prob >= t.found → found`, `prob < t.notFound → not_found`, else `maybe`; confidence = `high` if distance to the nearest crossed boundary > 0.2, `low` if < 0.07, else `medium`.

- [ ] **Step 1: Write the failing test** `test/searchlight-scorer.test.ts` — the load-bearing regression is the operator's screenshot. Build the two vectors via `extractSignals` from the Task-2 fixtures and assert classification under the model's default thresholds `{ found: 0.5559, notFound: 0.3224 }`:
```typescript
import { describe, it, expect } from 'vitest';
import { scoreSignals, classify } from '../src/shared/searchlight/scorer';
import { extractSignals } from '../src/shared/searchlight/signals';
// reuse PROFILE / SOFT404 / site()/raw() helpers (copy from signals test or a shared fixture)
const T = { found: 0.5559, notFound: 0.3224 };
it('real profile → found', () => {
  const v = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
  expect(classify(scoreSignals(v), T).status).toBe('found');
});
it('soft-404 → not_found', () => {
  const v = extractSignals(site(), raw({ body: SOFT404 }), 'https://s.com/ghostexodus');
  expect(classify(scoreSignals(v), T).status).toBe('not_found');
});
it('bare 200 no body → maybe (ambiguous, triggers escalation)', () => {
  const v = extractSignals(site(), raw({ statusCode: 200, body: '' }), 'https://s.com/x');
  expect(classify(scoreSignals(v), T).status).toBe('maybe');
});
it('threshold override flips verdict', () => {
  const v = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
  const p = scoreSignals(v);
  expect(classify(p, { found: 0.99, notFound: 0.98 }).status).not.toBe('found');
});
it('sigmoid output bounded 0..1', () => {
  expect(scoreSignals({ http_404: 1 })).toBeGreaterThan(0);
  expect(scoreSignals({ http_404: 1 })).toBeLessThan(0.5);
});
```
- [ ] **Step 2:** `npx vitest run test/searchlight-scorer.test.ts` → FAIL.
- [ ] **Step 3:** Implement `scorer.ts`. If the bare-200 vector does not land in the Maybe band with the default weights, adjust the cheap-only contribution (e.g. `http_200` weight) so a body-less 200 sits between `notFound` and `found` — a body-less 200 MUST be Maybe (that is the escalation trigger). Keep all weights as exported constants.
- [ ] **Step 4:** `npx vitest run test/searchlight-scorer.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat(searchlight): heuristic structural scorer + classify`.

---

### Task 4: `interpret.ts` integration (heuristic path)

**Files:** Modify `src/shared/searchlight/interpret.ts`; extend `test/searchlight-interpret.test.ts`.

**Interfaces — Consumes:** `scoreSignals`, `classify` (Task 3), `extractSignals` (Task 2). **Produces:** `interpretResult(site, result, targetUrl, ctx?: ScorerCtx)` where `ScorerCtx = { thresholds: { found: number; notFound: number }; useMl: boolean; model: MlModel | null }` (model unused until Task 9 — pass `null`). When `ctx` is present and the branch is a fallback branch (`status_code`, `response_url`, or `message` with no presence/absence strings), compute `extractSignals` → `scoreSignals` → `classify(prob, ctx.thresholds)` and return `{ found: status==='found', confidence, status, probability: prob }`. Curated `message` sites with presence/absence strings, the `error`/`blocked` short-circuits, and the no-`ctx` path are UNCHANGED.

- [ ] **Step 1: Write failing tests** extending `test/searchlight-interpret.test.ts`:
```typescript
const ctx = { thresholds: { found: 0.5559, notFound: 0.3224 }, useMl: false, model: null };
it('status_code 200 with no body → maybe (was false-positive found)', () => {
  const r = interpretResult(base, raw({ statusCode: 200, body: '' }), 'https://x.com/admin', ctx);
  expect(r.status).toBe('maybe');
});
it('status_code 200 with profile body → found', () => {
  const r = interpretResult(base, raw({ statusCode: 200, body: PROFILE }), 'https://x.com/ghostexodus', ctx);
  expect(r.status).toBe('found');
});
it('curated message site stays authoritative (unchanged, no ctx influence)', () => {
  const s = { ...base, checkType: 'message' as const, absenceStrs: ['No such user'] };
  const r = interpretResult(s, raw({ statusCode: 200, body: 'No such user' }), 'https://x.com/admin', ctx);
  expect(r.status).toBe('not_found'); expect(r.confidence).toBe('high');
});
it('no ctx → legacy behavior preserved', () => {
  const r = interpretResult(base, raw({ statusCode: 200 }), 'https://x.com/admin');
  expect(r.status).toBe('found'); // unchanged legacy path
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the optional `ctx` param and the fallback-branch routing. Keep `Interpretation` extended with `probability?: number`. Legacy (no-ctx) behavior must be byte-for-byte unchanged so existing tests pass.
- [ ] **Step 4:** `npx vitest run test/searchlight-interpret.test.ts` → PASS (new + all existing).
- [ ] **Step 5:** Commit: `feat(searchlight): route interpret fallback branches through scorer`.

---

### Task 5: Adaptive two-phase probe (`sweep.ts`)

**Files:** Modify `src/main/searchlight/sweep.ts`; extend `test/searchlight-sweep.test.ts`.

**Interfaces — Consumes:** `interpretResult` w/ `ScorerCtx`. `RunSweepArgs` gains `scorerCtx: ScorerCtx` and `lightweightMode: boolean`. **Produces:** worker does phase-1 `fetchBody = site.checkType === 'message'`; after interpret, if `interp.status === 'maybe' && !fetchBody && !lightweightMode && !raw.error`, re-probe the same URL with `fetchBody: true` and re-interpret; emit the escalated result. `SweepResult.probability` carried through. Progress (`checked`) counts SITES, incremented once per site regardless of escalation.

- [ ] **Step 1: Write failing tests** in `test/searchlight-sweep.test.ts` using a `probeImpl` mock that returns body only on the 2nd (GET) call:
```typescript
it('ambiguous 200 escalates exactly once (HEAD then GET)', async () => {
  const calls: boolean[] = []; // fetchBody flag per call
  const probeImpl = vi.fn(async (_u, opts) => { calls.push(opts.fetchBody);
    return { statusCode: 200, statusMessage: 'OK', elapsed: 5, redirectUrl: null, error: null,
             body: opts.fetchBody ? PROFILE : '' }; });
  const emit = vi.fn(); const onDone = vi.fn();
  await runSweep({ jobId: 'j', username: 'ghostexodus', sites: [mk('a')], useTor: false, concurrency: 1,
    networkEnabled: true, emit, onDone, isCancelled: () => false,
    scorerCtx: { thresholds: { found: 0.5559, notFound: 0.3224 }, useMl: false, model: null },
    lightweightMode: false, probeImpl: probeImpl as never });
  expect(calls).toEqual([false, true]);            // HEAD then escalate GET
  expect(emit.mock.calls[0][0].status).toBe('found');
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ checked: 1 })); // site counted once
});
it('clean 404 does NOT escalate (zero body fetches)', async () => {
  const calls: boolean[] = [];
  const probeImpl = vi.fn(async (_u, opts) => { calls.push(opts.fetchBody);
    return { statusCode: 404, statusMessage: 'NF', elapsed: 5, redirectUrl: null, error: null, body: '' }; });
  await runSweep({ jobId: 'j', username: 'u', sites: [mk('a')], useTor: false, concurrency: 1,
    networkEnabled: true, emit: vi.fn(), onDone: vi.fn(), isCancelled: () => false,
    scorerCtx: { thresholds: { found: 0.5559, notFound: 0.3224 }, useMl: false, model: null },
    lightweightMode: false, probeImpl: probeImpl as never });
  expect(calls).toEqual([false]);                  // no escalation
});
it('lightweightMode disables escalation', async () => {
  const calls: boolean[] = [];
  const probeImpl = vi.fn(async (_u, opts) => { calls.push(opts.fetchBody);
    return { statusCode: 200, statusMessage: 'OK', elapsed: 5, redirectUrl: null, error: null, body: '' }; });
  await runSweep({ jobId: 'j', username: 'u', sites: [mk('a')], useTor: false, concurrency: 1,
    networkEnabled: true, emit: vi.fn(), onDone: vi.fn(), isCancelled: () => false,
    scorerCtx: { thresholds: { found: 0.5559, notFound: 0.3224 }, useMl: false, model: null },
    lightweightMode: true, probeImpl: probeImpl as never });
  expect(calls).toEqual([false]);
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the escalation in the worker. On phase-2 GET failure (probe throws or returns `error`), keep the phase-1 interpretation (graceful fallback). Build the emitted `SweepResult` from the FINAL interpretation, including `probability`.
- [ ] **Step 4:** `npx vitest run test/searchlight-sweep.test.ts` → PASS (new + existing, including the `networkEnabled:false` test — add the new required args to it).
- [ ] **Step 5:** Commit: `feat(searchlight): adaptive two-phase probe (escalate ambiguous 200)`.

---

### Task 6: Settings wiring

**Files:** Modify `src/shared/types.ts` (`AppSettings.searchlight` ~line 463, defaults ~line 624); `src/main/ipc/register.ts` (startSweep handler ~line 1355).

**Interfaces — Produces:** `AppSettings.searchlight.scorer = { foundThreshold: number | null; maybeFloor: number | null; lightweightMode: boolean; useMl: boolean }`, defaults `{ foundThreshold: null, maybeFloor: null, lightweightMode: false, useMl: true }`. `startSweep` resolves thresholds (settings override ?? model thresholds ?? hard fallback 0.5559/0.3224) and passes `scorerCtx` + `lightweightMode` into `startSweep`/`runSweep`.

- [ ] **Step 1:** Add the `scorer` field to the interface and defaults object (exact spots from the file map). `foundThreshold`/`maybeFloor` are `number | null`.
- [ ] **Step 2:** `pnpm typecheck` → expect FAIL where `startSweep` deps must now supply `scorerCtx`/`lightweightMode`.
- [ ] **Step 3:** In `register.ts` `startSweep` handler: read `const sc = s.scorer;`, get the model via `getModel()` (Task 8 — until Task 8 lands, pass `model: null, useMl: false`), resolve `thresholds = { found: sc.foundThreshold ?? model?.thresholds.found ?? 0.5559, notFound: sc.maybeFloor ?? model?.thresholds.not_found ?? 0.3224 }`, and thread `scorerCtx`/`lightweightMode` through `startSweep` → `runSweep`. Update `StartSweepDeps`/`startSweep` in `sweep.ts` to accept and forward them.
- [ ] **Step 4:** `pnpm typecheck` → PASS; `npx vitest run test/searchlight-sweep.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat(searchlight): scorer settings + threshold resolution`.

---

### Task 7: ML inference (`ml.ts`)

**Files:** Create `src/shared/searchlight/ml.ts`, `test/searchlight-ml.test.ts`.

**Interfaces — Produces:** `interface MlModel { version: string; feature_schema: string[]; mean: number[]; scale: number[]; coef: number[]; intercept: number; ml_weight: number; thresholds: { found: number; not_found: number } }`; `predict(v: SignalVector, m: MlModel): number` = `sigmoid(Σ coef[i]·((x_i − mean[i]) / scale[i]) + intercept)` where `x_i = v[feature_schema[i]] ?? mean[i]` (missing feature → mean → standardizes to 0, neutral); guard `scale[i] === 0 → use 1`; `blend(ml: number, heuristic: number, weight: number) = weight*ml + (1-weight)*heuristic`.

- [ ] **Step 1: Write failing tests** with a tiny synthetic 2-feature model (deterministic, hand-computable) AND a missing-feature case:
```typescript
import { predict, blend } from '../src/shared/searchlight/ml';
const M = { version: 't', feature_schema: ['a','b'], mean: [0,0], scale: [1,1], coef: [1,0], intercept: 0,
            ml_weight: 0.6, thresholds: { found: 0.5559, not_found: 0.3224 } };
it('predict = sigmoid(coef·z)', () => { expect(predict({ a: 2, b: 0 }, M)).toBeCloseTo(1/(1+Math.exp(-2)), 6); });
it('missing feature uses mean (neutral)', () => { expect(predict({ b: 5 }, { ...M, mean: [3,0] })).toBeCloseTo(0.5, 6); });
it('scale 0 guarded', () => { expect(predict({ a: 1 }, { ...M, scale: [0,1] })).toBeDefined(); });
it('blend respects ml_weight', () => { expect(blend(1, 0, 0.6)).toBeCloseTo(0.6, 6); });
it('determinism', () => { expect(predict({ a: 2 }, M)).toBe(predict({ a: 2 }, M)); });
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `ml.ts`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(searchlight): logistic-regression ML inference (standardized)`.

---

### Task 8: Model store + vendored model + attribution

**Files:** Create `src/main/searchlight/model-store.ts`, `resources/searchlight/model.json`, `THIRD_PARTY_LICENSES`.

**Interfaces — Produces:** `getModel(): MlModel | null` — reads `resources/searchlight/model.json` relative to the app resources path (mirror how other `resources/searchlight` assets are resolved in the codebase — grep `resources/searchlight` / `process.resourcesPath`), parsed + shape-validated (all of `feature_schema/mean/scale/coef` are arrays of equal length; else return `null` and log). Cached after first load.

- [ ] **Step 1:** Fetch the model: `curl -sL https://raw.githubusercontent.com/arxhr007/Aliens_eye/main/src/aliens_eye/data/model.json -o resources/searchlight/model.json` and verify it parses and has the v2.0.0 keys (`feature_schema` length 30, `mean`/`scale`/`coef` length 30, `ml_weight`, `thresholds`).
- [ ] **Step 2:** Create `THIRD_PARTY_LICENSES` containing the Aliens_eye MIT block (© 2021 Aaron Thomas) with a header line: `Aliens_eye (https://github.com/arxhr007/Aliens_eye) — vendored model.json (resources/searchlight/model.json) and ported feature-extraction logic (src/shared/searchlight/signals.ts, keywords.ts).` Paste their MIT text verbatim (fetch `.../main/LICENSE`).
- [ ] **Step 3: Write failing test** `test/searchlight-model-store.test.ts` — load the real vendored file through a parse+validate helper (`parseModel(json): MlModel | null`, exported from `model-store.ts` so it's testable without Electron paths): assert it returns a model with `feature_schema.length === 30` and `typeof ml_weight === 'number'`; assert `parseModel('{bad')` and a length-mismatch object return `null`.
- [ ] **Step 4:** Implement `model-store.ts` (`parseModel` pure + `getModel` reading from resources). Run the test → PASS.
- [ ] **Step 5:** Wire `register.ts` startSweep to call `getModel()` and pass it into `scorerCtx` with `useMl: sc.useMl` (now real). Commit: `feat(searchlight): vendor Aliens_eye model + model-store + attribution`.

---

### Task 9: Feature-fidelity parity gate (flips ML live)

**Files:** Modify `src/shared/searchlight/keywords.ts`/`signals.ts` to match upstream verbatim; modify `interpret.ts` to apply the blend; create `test/searchlight-parity.test.ts`.

**Interfaces — Consumes:** `predict`, `getModel`/`parseModel`, `extractSignals`, `scoreSignals`. **Produces:** in `interpret.ts`, when `ctx.useMl && ctx.model`, compute `heuristic = scoreSignals(v)`; set `v.heuristic_score = heuristic`; `ml = predict(v, ctx.model)`; `prob = blend(ml, heuristic, ctx.model.ml_weight)`; `classify(prob, ctx.thresholds)`. When `!useMl` or no model, use `heuristic` directly (Task 4 behavior).

**The parity test is the acceptance gate.** Fetch `https://raw.githubusercontent.com/arxhr007/Aliens_eye/main/src/aliens_eye/core/features.py` and `.../data/seed_dataset.csv`. Transcribe the EXACT positive/error keyword lists and per-feature computation from `features.py` into `keywords.ts`/`signals.ts` (replacing the English placeholders from Task 2). The seed dataset rows are labeled feature vectors; for each row, run `predict()` with the vendored model and assert it reproduces the expected label/probability within tolerance.

- [ ] **Step 1:** Fetch `features.py` (raw) and reconcile `keywords.ts` + the body-signal computation to match it verbatim. Fetch `seed_dataset.csv`; commit a small representative slice to `test/fixtures/searchlight-seed-sample.csv` (≤50 rows; note in the file header it's vendored from Aliens_eye MIT).
- [ ] **Step 2: Write the parity test** `test/searchlight-parity.test.ts`: load the vendored model via `parseModel`, read the fixture CSV, for each row build the `SignalVector` from its stored feature columns (the CSV columns ARE the feature_schema), run `predict`, and assert agreement with the row's label at the model's `thresholds` for **≥85%** of rows (record the exact rate in the assertion message). This quantifies port fidelity including the fingerprint gap.
- [ ] **Step 3:** Run → if ≥85% PASS, wire the blend into `interpret.ts` and leave `useMl` default `true`. If <85%, the gate FAILS: set the `searchlight.scorer.useMl` DEFAULT to `false` (heuristic still ships and fixes soft-404s), leave the blend code in place behind the toggle, and add a one-line note to the spec's "Out of scope / future" that the as-shipped model needs the Plan-2 retrain to clear parity. Either way the suite stays green.
- [ ] **Step 4:** `npx vitest run test/searchlight-parity.test.ts test/searchlight-interpret.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat(searchlight): ML blend + feature-fidelity parity gate`.

---

### Task 10: Sweep-panel `maybe` badge + probability

**Files:** Modify `src/renderer/modules/searchlight/panels/SweepPanel.tsx`, `searchlight.css`.

- [ ] **Step 1:** `statusColor`: `case 'maybe': return '#d8a83a';`. `statusLabel`: `case 'maybe': return 'MAYBE';`. In the MATCH column, show for `found` OR `maybe`: a badge with the probability — `{(r.status === 'found' || r.status === 'maybe') && r.probability != null ? <span className={r.status==='maybe'?'sl-match-maybe':'sl-match-badge'}>● {Math.round(r.probability*100)}%</span> : ...}`. Keep the existing TOR-badge and dash branches.
- [ ] **Step 2:** Add CSS for `.sl-match-maybe` (amber on dark; **background restated on the class** — `background: rgba(216,168,58,0.12); border:1px solid rgba(216,168,58,0.35); color:#d8a83a;`) and a `.sl-row-maybe { background: rgba(216,168,58,0.02); }` row tint.
- [ ] **Step 3:** Verify via the existing headless Playwright computed-style harness that the `maybe` badge text renders amber (`rgb(216, 168, 58)`-ish), NOT white (98.css cascade check). If no harness exists in-repo, add a focused jsdom render test asserting the className is applied for `status==='maybe'`.
- [ ] **Step 4:** `pnpm typecheck` + relevant tests → PASS.
- [ ] **Step 5:** Commit: `feat(searchlight): maybe badge + probability in sweep results`.

---

### Task 11: Sortable columns + live progress + summary panel

**Files:** Modify `src/renderer/modules/searchlight/panels/SweepPanel.tsx`, `searchlight.css`.

- [ ] **Step 1:** Sort state `const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'status', dir: 1 })`. Make the `<th>` clickable (toggle dir, set key). Sort `visibleResults` with a STABLE comparator: primary by `sort.key` (status uses the canonical order index `['found','maybe','blocked','not_found','unknown','error']`; probability/elapsed numeric; site/category string), tie-break by `siteName` ascending (deterministic). Add a sort caret to the active header.
- [ ] **Step 2:** Progress bar: derive `checked` from `visibleResults.length` and `total` from the running job's total; render a Win98 progress bar (`width %`) + `checked/total` + a rolling ETA (`elapsedSoFar/checked * remaining`, computed from result timestamps — guard divide-by-zero). Wire the existing cancel control to `window.api.searchlight.cancelSweep`.
- [ ] **Step 3:** Summary panel: compute per-status tallies from `visibleResults` (`found/maybe/blocked/not_found/unknown/error`) and a by-category `found`/`maybe` mini-breakdown; render above the table; updates live (it's derived from state each render).
- [ ] **Step 4: Maybe filter chip (triage reachability).** Add `'maybe'` to `FilterBucket` (line 26), a `case 'maybe': return r.status === 'maybe';` in `matchesBucket` (line 55), a `maybe:` count in `bucketCounts` (lines 212-216), and a chip in the bucket array that renders the filter row (~line 596) with label `MAYBE`, the count, and `accent: '#d8a83a'`. Clicking it filters the table to the Maybe worklist. Confirm `setResultBucket('maybe')` filters correctly.
- [ ] **Step 5:** Add CSS for `.sl-summary`, `.sl-progress`, sortable header hover/caret, and the maybe chip accent. Verify the `maybe` tally + chip appear. `pnpm typecheck` + tests → PASS. Commit: `feat(searchlight): sortable columns, live progress, summary panel, maybe filter`.

---

### Task 12: Searchlight scorer settings UI (reachability)

**Files:** Modify `src/renderer/modules/settings/SettingsModule.tsx` (`SearchlightPane`, ~line 528: `const sl = s.searchlight; const set = (p) => void patch({ searchlight: { ...sl, ...p } });`).

**Goal:** make every scorer control reachable with plain-language labels and a reset. Bind to `sl.scorer` via `set({ scorer: { ...sl.scorer, ...} })`.

- [ ] **Step 1:** In `SearchlightPane`, add a "Detection scoring" subsection with:
  - **Deep scan** checkbox — label "Deep scan: inspect page content to cut false positives (recommended)", `checked={!sl.scorer.lightweightMode}`, `onChange={(e) => set({ scorer: { ...sl.scorer, lightweightMode: !e.target.checked } })}`.
  - **Use ML model** checkbox — label "Use ML model (blends with heuristics)", `checked={sl.scorer.useMl}`, `onChange={(e) => set({ scorer: { ...sl.scorer, useMl: e.target.checked } })}`.
  - **Found threshold** number input — `className="ga98-text"`, `type="number"` step `0.01` min `0` max `1`, `value={sl.scorer.foundThreshold ?? ''}`, `placeholder="model default (0.5559)"`, `onChange={(e) => set({ scorer: { ...sl.scorer, foundThreshold: e.target.value === '' ? null : Number(e.target.value) } })}`.
  - **Maybe floor** number input — same pattern, `value={sl.scorer.maybeFloor ?? ''}`, `placeholder="model default (0.3224)"`, key `maybeFloor`.
  - **Reset to defaults** button — `onClick={() => set({ scorer: { foundThreshold: null, maybeFloor: null, lightweightMode: false, useMl: true } })}`.
  - One helper line: "Leave thresholds blank to use the model's own calibrated values."
- [ ] **Step 2:** `pnpm typecheck` → PASS (the `scorer` shape matches Task 6's `AppSettings.searchlight.scorer`).
- [ ] **Step 3:** Add/extend a settings render test if one exists for `SearchlightPane`; else a focused jsdom test that renders `SearchlightPane` with a stub `patch` and asserts the four controls are present and that toggling "Deep scan" calls `patch` with `lightweightMode: true`. Confirm changing a value round-trips through `patch`.
- [ ] **Step 4:** `pnpm typecheck` + tests → PASS.
- [ ] **Step 5:** Commit: `feat(searchlight): scorer settings controls in Settings → Searchlight`.

---

### Task 13: Reports/PDF `maybe` support

**Files:** Modify `src/renderer/modules/searchlight/panels/ReportsPanel.tsx`.

- [ ] **Step 1:** In `generateHTML`, add `r.status === 'maybe' ? 'maybe' : ...` to the row class; add CSS `tr.maybe .status{color:#d8a83a;font-weight:700}`; add a stats box `<div class="stat-val" style="color:#d8a83a">${results.filter(r=>r.status==='maybe').length}</div><div class="stat-lbl">MAYBE</div>`. Preserve the existing `esc()`/`safeHref()` escaping on ALL interpolated values (XSS gate).
- [ ] **Step 2:** If a Reports test exists, extend it to assert a `maybe`-status result renders the `maybe` row class and the stat count; else add a focused test calling `generateHTML` with a `maybe` result and asserting the substring `class="maybe"` and the MAYBE stat. Confirm no unescaped interpolation was introduced.
- [ ] **Step 3:** `pnpm typecheck` + tests → PASS.
- [ ] **Step 4:** Commit: `feat(searchlight): maybe tier in PDF/HTML report`.

---

### Task 14: Site-database folder button + drop-in override

**Files:** Modify `src/main/searchlight/site-db.ts` (bundled loader ~lines 12-15, add override + reveal), `src/shared/ipc-contracts.ts` (channel + API contract + exact-set test), `src/main/ipc/register.ts` (handler), `src/preload/index.ts` + `src/preload/api.d.ts` (expose), `src/renderer/modules/searchlight/panels/SweepPanel.tsx` (toolbar button next to `LOAD CUSTOM DB` / `EXPORT SITES.JSON`). Mirrors the Firefox pattern (`firefox.revealFirefoxDir()` + `channels.browser.revealFirefoxDir`).

**Interfaces — Produces:** `revealSiteDbDir(): Promise<void>` and `overrideSitesFile(): string` (= `join(app.getPath('userData'), 'searchlight', 'maigret_sites.json')`) in `site-db.ts`; channel `searchlight.revealSiteDbDir: 'searchlight:revealSiteDbDir'` with API contract `{ args: []; returns: void }`.

**Override-load (fail-safe):** the bundled-DB loader first tries `overrideSitesFile()`; if it exists AND `parseMaigretData(JSON.parse(...))` succeeds, use it; on ANY error (missing/corrupt) fall back to the bundled `maigret_sites.json`. Corruption can never brick the site DB — that is the whole point of the feature.

- [ ] **Step 1: Write the failing test** `test/searchlight-sitedb-override.test.ts` — unit-test the override-selection helper. Refactor the load to call a pure `pickSitesSource(overrideRaw: string | null, bundledRaw: string): MaigretSiteEntry[]` that returns parsed override when valid, else parsed bundled. Test: valid override JSON → override entries; `null` override → bundled; malformed override string → bundled (no throw).
```typescript
import { pickSitesSource } from '../src/shared/searchlight/sites';
it('valid override wins', () => { expect(pickSitesSource(OVERRIDE_JSON, BUNDLED_JSON)[0].name).toBe('OverrideSite'); });
it('null override → bundled', () => { expect(pickSitesSource(null, BUNDLED_JSON)[0].name).toBe('BundledSite'); });
it('malformed override → bundled (no throw)', () => { expect(pickSitesSource('{bad', BUNDLED_JSON)[0].name).toBe('BundledSite'); });
```
- [ ] **Step 2:** Run → FAIL. Implement `pickSitesSource` in `src/shared/searchlight/sites.ts` (pure, try/catch around the override parse) and wire `site-db.ts`'s bundled loader to read `overrideSitesFile()` (if present) and pass both raws to it. Run → PASS.
- [ ] **Step 3:** Add `revealSiteDbDir()` to `site-db.ts`: `await mkdir(join(app.getPath('userData'), 'searchlight'), { recursive: true }); const err = await shell.openPath(join(app.getPath('userData'), 'searchlight')); if (err) ...` (mirror `firefox.revealFirefoxDir` + `sounds.ts:93`). Add the channel to `ipc-contracts.ts` (+ API contract entry), register `safeHandle(channels.searchlight.revealSiteDbDir, () => revealSiteDbDir())` in `register.ts`, expose in preload + `api.d.ts`. **Update `test/searchlight-contracts.test.ts`** (if it asserts an exact channel set) to include `revealSiteDbDir`.
- [ ] **Step 4:** Add the toolbar button in `SweepPanel.tsx` next to `LOAD CUSTOM DB` (grep that label) — `<button onClick={() => void window.api.searchlight.revealSiteDbDir()}>SITE DB FOLDER</button>` with a `title="Open the writable site-database folder. Drop a corrected maigret_sites.json here to override the bundled database."`. `pnpm typecheck` + `npx vitest run test/searchlight-sitedb-override.test.ts test/searchlight-contracts.test.ts test/x-ipc.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat(searchlight): site-DB folder button + drop-in override (corruption quick-fix)`.

---

### Task 15: Full-suite green + charter gates

**Files:** none new — verification + any fixes.

- [ ] **Step 1:** `pnpm typecheck` → PASS. `pnpm build` → clean.
- [ ] **Step 2:** `pnpm test` (full suite) → all green. Record the new total count.
- [ ] **Step 3:** Determinism check: run the new pure-module suites twice; outputs identical. Confirm no `Date.now`/`Math.random` in `signals.ts`/`scorer.ts`/`ml.ts` (`grep -n "Date.now\|Math.random" src/shared/searchlight/{signals,scorer,ml}.ts` → empty).
- [ ] **Step 4:** Egress check: confirm no new outbound call site (`grep` shows phase-2 GET reuses `probe`/`safeFetch`/`socksDial` only; the only new channel `searchlight.revealSiteDbDir` is a local `shell.openPath`, no network); channel-uniqueness + searchlight exact-set contract tests green; body parser uses no `new RegExp(` on dynamic input (`grep -n "new RegExp" src/shared/searchlight/signals.ts` → empty).
- [ ] **Step 5:** Commit any fixes: `test(searchlight): full-suite green + charter gates for detection scorer`.

---

## Self-Review

- **Spec coverage:** signals (T2), heuristic scorer (T3), interpret routing tail-only (T4), adaptive two-phase (T5), settings data layer (T6), ML inference w/ standardization (T7), vendored model + attribution (T8), parity gate + blend (T9), maybe badge+probability (T10), sortable/progress/summary + maybe filter chip (T11), settings UI controls (T12), reports (T13), charter gates (T14). Retrain = Plan 2 (out of scope here). ✓
- **UI reachability (operator requirement):** maybe tier → badge (T10) + filter chip (T11) + report (T13); thresholds/deep-scan/ML toggle → Settings UI (T12); site-DB folder button + drop-in override → Sweep toolbar (T14); zero-config by default (deep-scan + ML on, thresholds from model) so a bare sweep already benefits with nothing to configure. ✓
- **Site-DB override is fail-safe:** corrupt override → bundled fallback (T14), so the quick-fix feature can never brick the site database. ✓
- **No new IPC channels** in Plan 1 → no searchlight contract exact-set churn (verified against the file map; `maybe` rides `onSweepResult`). ✓
- **Type consistency:** `ScorerCtx`, `MlModel`, `SignalVector`, `extractSignals`/`scoreSignals`/`classify`/`predict`/`blend` names are consistent across T2–T9. Thresholds use `{ found, notFound }` in `ScorerCtx`/`classify` but the model file key is `not_found` — conversion happens at resolution (T6/T8); flagged so the implementer maps `not_found → notFound`. ✓
- **Parity risk handled:** T9 degrades to heuristic-only (useMl=false) rather than shipping a sub-threshold model; suite stays green either way. ✓
