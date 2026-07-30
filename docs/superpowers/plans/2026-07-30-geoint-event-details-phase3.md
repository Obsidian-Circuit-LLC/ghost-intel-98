# GeoINT Event Details — Phase 3 (Labeled AI + Honest Media) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the dossier's **MEDIA** and **INTEL SUMMARY** tabs live — a media *affordance* (never inline remote media), deterministic **Key Entities** and **casualty/verification quotes** that work for every user, and an **AI summary** through a NEW isolated local-Ollama path that summarizes only the description, stamped "AI · unverified" and degrading gracefully when no local model is set.

**Architecture:** Two pure deterministic renderer selectors (entities, claim-phrases) plus a new, self-contained main-process `summarizeEvent` service that talks to Ollama directly (loopback, SSRF-guarded) with NO RAG / web-search / memory — reached by a new `geoint:summarizeEvent` IPC channel. The panel's MEDIA/INTEL tabs render these; the AI summary is Ollama-only and gated, so an OpenAI-compatible remote endpoint can never receive unverified OSINT.

**Tech Stack:** TypeScript, React (renderer), Electron main IPC, existing Vitest + jsdom harness, existing headless-Chrome CSS harness.

## Global Constraints

- **No fabricated intelligence data.** Casualty/verification detail appears ONLY as deterministically-extracted **quoted phrases** from the source text, labeled "extracted · unverified" — NEVER a synthesized number or an invented "verified" badge. The AI summary is stamped **"AI · unverified"** and is a summary of the *unverified* report, never an assessment of its truth.
- **AI is local-only and isolated.** The Intel Summary path is **Ollama-only** (`settings.ai.provider === 'ollama'`); an OpenAI-compatible/remote endpoint is treated as "no local model" (never sent OSINT). The path does NOT use the conversational `chatStream` gateway, RAG, web-search directives, or memory. Endpoint validated by the existing `validateAiEndpoint(endpoint, 'ollama')` SSRF guard.
- **No new network egress beyond that one local loopback call.** The MEDIA tab is an **affordance only** — it MUST NOT inline a remote `<img>/<video>` (`src=http(s)`); the app's own `sanitizeHtml.ts` strips remote `<img>` because "an un-neutralized remote `<img>` … would beacon out — violating offline-first / no-egress", and the map popup renders no feed image. MEDIA shows what media the source *reports* (image/video indicator) + an Open-source affordance via the existing `onOpenLink` path.
- **No new dependency.** **Determinism** in both selectors (total, tie-broken order; no `Date.now()`/RNG). **XSS-safe** React-text rendering only (no `dangerouslySetInnerHTML`).
- **Graceful degradation.** With no local Ollama model, the Intel Summary shows a plain "Local AI model not available" notice and **every other tab still works**.
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>` via `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; explicit-path `git add <paths>` only (never `-A`/`.`; never stage `active-snapshot.tle`, `Cargo.lock`, `docs/superpowers/ideation/`, `resources/local-ai/`); **NO AI-identity trailers**. All work on branch `feat/geoint-event-details-p3`; the controller merges — implementers never touch main.

---

### Task 1: Deterministic Key Entities selector

**Files:**
- Modify: `src/renderer/modules/geoint/event-details.ts` (add `deriveEntities` beside `deriveTags`)
- Test: `test/geoint-event-entities.test.ts` (new)

**Interfaces:**
- Consumes: `GeoItem` (`title`, `detail?`/`summary?`, `place?`, `country?`).
- Produces:
  ```ts
  export interface EventEntities { places: string[]; mentions: string[]; }
  export function deriveEntities(item: GeoItem): EventEntities;
  ```
  `places` = ordered-unique of `[item.place, item.country]` (trimmed, case-insensitive dedupe). `mentions` = maximal runs of Capitalized words extracted from `"${title}. ${detail ?? summary ?? ''}"`, per-sentence, **dropping** a single-word run that is sentence-initial or a leading start-stopword (so "In Kyiv…" doesn't yield "In"; "The United Nations" yields "United Nations"), excluding anything already in `places`, deduped case-insensitively, capped at 10. Deterministic (source order). Presented in the UI as "extracted from report text", NOT typed as person/org (the app can't substantiate the type).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { deriveEntities } from '../src/renderer/modules/geoint/event-details';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string }): GeoItem =>
  ({ sourceId: 's', title: o.id, located: 'none', ...o } as GeoItem);

describe('deriveEntities', () => {
  it('lists place then country, deduped', () => {
    const e = deriveEntities(mk({ id: 'T', title: 'x', place: 'Kyiv', country: 'Ukraine' }));
    expect(e.places).toEqual(['Kyiv', 'Ukraine']);
  });

  it('extracts multi-word proper nouns, dropping a leading start-stopword', () => {
    const e = deriveEntities(mk({ id: 'T', title: 'Report', detail: 'The United Nations condemned the attack.' }));
    expect(e.mentions).toContain('United Nations');
    expect(e.mentions).not.toContain('The United Nations');
  });

  it('drops a sentence-initial single capitalized word but keeps a mid-sentence one', () => {
    const e = deriveEntities(mk({ id: 'T', title: 'x', detail: 'Strikes hit Mariupol overnight.' }));
    expect(e.mentions).toContain('Mariupol');
    expect(e.mentions).not.toContain('Strikes');
  });

  it('excludes mentions already listed as places and caps at 10', () => {
    const body = Array.from({ length: 14 }, (_, n) => `sentence ${n} mentions Alpha${String.fromCharCode(65 + n)}`).join('. ');
    const e = deriveEntities(mk({ id: 'T', title: 'x', place: 'Kyiv', detail: `Near Kyiv, ${body}.` }));
    expect(e.mentions).not.toContain('Kyiv');            // already a place
    expect(e.mentions.length).toBeLessThanOrEqual(10);
  });

  it('is deterministic', () => {
    const item = mk({ id: 'T', title: 'x', detail: 'Forces near Bakhmut and Soledar advanced.' });
    expect(deriveEntities(item)).toEqual(deriveEntities(item));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-event-entities.test.ts`
Expected: FAIL — `deriveEntities is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/renderer/modules/geoint/event-details.ts`:

```ts
export interface EventEntities { places: string[]; mentions: string[]; }

/** Capitalized words that, standing alone at a sentence's head, are not evidence of a proper noun. */
const START_STOP = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'In', 'On', 'At', 'After', 'Before', 'During',
  'As', 'It', 'Its', 'He', 'She', 'They', 'We', 'His', 'Her', 'Their', 'Our', 'Two', 'Three', 'Several',
  'Multiple', 'Many', 'Some', 'No', 'Reports', 'Report', 'Sources', 'Local', 'Officials'
]);
const CAP_RUN = /[A-Z][A-Za-z'’\-]*(?:\s+[A-Z][A-Za-z'’\-]*)*/g;
const ENTITY_CAP = 10;

/** People/orgs/places surfaced from the item — deterministically, from its own text. `places` are the
 *  known geography (place, country); `mentions` are maximal capitalized runs in title+body, minus
 *  sentence-initial single words / leading start-stopwords / anything already a place. No fabrication
 *  and no person-vs-org typing (the app can't substantiate the type). */
export function deriveEntities(item: GeoItem): EventEntities {
  const places: string[] = [];
  const seen = new Set<string>();
  for (const p of [item.place, item.country]) {
    const t = p?.trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); places.push(t); }
  }
  const body = `${item.title}. ${item.detail ?? item.summary ?? ''}`;
  const mentions: string[] = [];
  const sentences = body.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    if (mentions.length >= ENTITY_CAP) break;
    const re = new RegExp(CAP_RUN.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const words = m[0].trim().split(/\s+/);
      const atStart = s.slice(0, m.index).trim() === '';
      while (words.length > 1 && START_STOP.has(words[0])) words.shift();
      if (words.length === 1 && (atStart || START_STOP.has(words[0]))) continue;
      const clean = words.join(' ');
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) { seen.add(key); mentions.push(clean); }
      if (mentions.length >= ENTITY_CAP) break;
    }
  }
  return { places, mentions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/geoint-event-entities.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/event-details.ts test/geoint-event-entities.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "feat(geoint): deterministic Key Entities selector for the Intel tab"
```

---

### Task 2: Deterministic casualty/verification phrase extractor

**Files:**
- Modify: `src/renderer/modules/geoint/event-details.ts` (add `extractClaimPhrases`)
- Test: `test/geoint-claim-phrases.test.ts` (new)

**Interfaces:**
- Consumes: `GeoItem` (`detail?`/`summary?`).
- Produces:
  ```ts
  export interface ClaimPhrase { text: string; }
  export function extractClaimPhrases(item: GeoItem): ClaimPhrase[];
  ```
  Splits the body into sentences; keeps each sentence containing a casualty/verification vocabulary term (literal, lowercase substring), verbatim; deduped, source order, capped at 6. It **extracts** — it never rewrites, aggregates, or synthesizes a number. The UI labels these "extracted · unverified". `[]` when the body is empty or contains none.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { extractClaimPhrases } from '../src/renderer/modules/geoint/event-details';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string }): GeoItem =>
  ({ sourceId: 's', title: o.id, located: 'none', ...o } as GeoItem);

describe('extractClaimPhrases', () => {
  it('extracts only sentences with casualty/verification vocabulary, verbatim', () => {
    const item = mk({ id: 'T', title: 'x', detail: 'A missile hit the depot. At least five people were killed. Casualties remain unconfirmed. The weather was clear.' });
    const out = extractClaimPhrases(item).map((c) => c.text);
    expect(out).toEqual(['At least five people were killed.', 'Casualties remain unconfirmed.']);
  });

  it('returns [] when there is no body or no claim vocabulary', () => {
    expect(extractClaimPhrases(mk({ id: 'T', title: 'x' }))).toEqual([]);
    expect(extractClaimPhrases(mk({ id: 'T', title: 'x', detail: 'A convoy moved north at dawn.' }))).toEqual([]);
  });

  it('dedupes and caps at 6', () => {
    const s = 'Many were injured.';
    const item = mk({ id: 'T', title: 'x', detail: Array.from({ length: 9 }, (_, n) => `Report ${n}: ${n} were killed.`).join(' ') + ` ${s} ${s}` });
    const out = extractClaimPhrases(item);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out.filter((c) => c.text === s).length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-claim-phrases.test.ts`
Expected: FAIL — `extractClaimPhrases is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/renderer/modules/geoint/event-details.ts`:

```ts
export interface ClaimPhrase { text: string; }

/** Vocabulary marking a casualty or a verification claim. Literal lowercase substrings (so 'casualt'
 *  catches casualty/casualties, 'fatalit' catches fatality/fatalities, 'alleg' catches alleged/…). */
const CLAIM_VOCAB = [
  'killed', 'dead', 'death', 'wounded', 'injured', 'casualt', 'fatalit', 'missing',
  'confirmed', 'unconfirmed', 'unverified', 'reported', 'alleg', 'claim'
];
const CLAIM_CAP = 6;

/** Sentences from the item body that STATE a casualty/verification claim — extracted verbatim, never
 *  aggregated or turned into a number. The UI shows them as quotes labeled "extracted · unverified".
 *  This is the ONLY place casualty/verification detail may surface (charter). */
export function extractClaimPhrases(item: GeoItem): ClaimPhrase[] {
  const body = (item.detail ?? item.summary ?? '').trim();
  if (!body) return [];
  const out: ClaimPhrase[] = [];
  const seen = new Set<string>();
  for (const raw of body.split(/(?<=[.!?])\s+/)) {
    if (out.length >= CLAIM_CAP) break;
    const s = raw.trim();
    if (!s) continue;
    const low = s.toLowerCase();
    if (CLAIM_VOCAB.some((v) => low.includes(v)) && !seen.has(low)) {
      seen.add(low);
      out.push({ text: s });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/geoint-claim-phrases.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/event-details.ts test/geoint-claim-phrases.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "feat(geoint): deterministic casualty/verification phrase extractor (quotes only)"
```

---

### Task 3: Isolated local-Ollama `summarizeEvent` service + IPC

**Files:**
- Create: `src/main/geoint/event-summary.ts`
- Modify: `src/shared/ipc-contracts.ts` (add `geoint.summarizeEvent`)
- Modify: `src/main/ipc/register.ts` (register the handler)
- Modify: `src/preload/index.ts` (expose `geoint.summarizeEvent`)
- Modify: `src/preload/api.d.ts` (type it)
- Modify: `src/shared/post-mvp-types.ts` (add `EventSummaryResult`)
- Test: `test/geoint-event-summary.test.ts` (new)

**Interfaces:**
- Consumes: `settingsStore.read()` (`src/main/storage/json-fs`), `validateAiEndpoint` (`src/main/security/validate`), global `fetch`, `AiChatMessage` (`{role, content}`).
- Produces:
  ```ts
  // post-mvp-types.ts
  export interface EventSummaryResult { available: boolean; text?: string; reason?: string; }
  // event-summary.ts
  export async function summarizeEvent(description: string): Promise<EventSummaryResult>;
  // ipc-contracts.ts geoint group:
  summarizeEvent: 'geoint:summarizeEvent'
  // preload / api.d.ts geoint:
  summarizeEvent(description: string): Promise<EventSummaryResult>
  ```
  `summarizeEvent` returns `{available:false, reason}` when `provider !== 'ollama'`, no `model`, empty `description`, an invalid/`non-loopback` endpoint (from `validateAiEndpoint` throwing), or a fetch/timeout/parse failure. On success it POSTs `/api/chat` with `{model, messages:[{role:'system',content:SUMMARY_SYSTEM},{role:'user',content:description}], stream:false}` to the validated loopback endpoint under a ~30s `AbortController` timeout and returns `{available:true, text}` from `message.content`. NO RAG / web-search / memory.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let settings: any;
vi.mock('../src/main/storage/json-fs', () => ({ settingsStore: { read: async () => settings } }));
import { summarizeEvent } from '../src/main/geoint/event-summary';

const okFetch = (content: string) => vi.fn(async () => ({
  ok: true, status: 200, json: async () => ({ message: { role: 'assistant', content } })
} as any));

beforeEach(() => {
  settings = { ai: { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'llama3' } };
  vi.unstubAllGlobals();
});

describe('summarizeEvent (isolated local-Ollama path)', () => {
  it('returns available:false when the provider is not ollama (never sends OSINT remotely)', async () => {
    settings.ai.provider = 'openai-compatible';
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await summarizeEvent('A strike was reported.');
    expect(r.available).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns available:false when no model is configured', async () => {
    settings.ai.model = '';
    const r = await summarizeEvent('A strike was reported.');
    expect(r.available).toBe(false);
  });

  it('returns available:false for an empty description without calling the model', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await summarizeEvent('   ');
    expect(r.available).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('summarizes via /api/chat (stream:false) and returns the text', async () => {
    const f = okFetch('Two districts were struck; details unconfirmed.');
    vi.stubGlobal('fetch', f);
    const r = await summarizeEvent('Missiles hit two districts near the airport.');
    expect(r.available).toBe(true);
    expect(r.text).toContain('struck');
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse((init as any).body);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('llama3');
    expect(body.messages[body.messages.length - 1].content).toContain('Missiles hit two districts');
  });

  it('returns available:false when the local model call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await summarizeEvent('A strike was reported.');
    expect(r.available).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-event-summary.test.ts`
Expected: FAIL — cannot import `summarizeEvent` (module absent).

- [ ] **Step 3: Write minimal implementation**

Create `src/main/geoint/event-summary.ts`:

```ts
/**
 * Isolated local-Ollama summary of a single GeoINT incident description. Deliberately NOT the
 * conversational `chatStream` gateway: no RAG, no web-search directives, no memory injection — so a
 * dossier summary can never trigger network egress beyond one loopback Ollama call, and never leaves
 * the machine. Ollama-only: an OpenAI-compatible/remote provider is treated as "no local model", so
 * unverified OSINT is never sent to a remote API. Charter: the summary is stamped "AI · unverified"
 * in the UI; it summarizes the unverified report, it does not assess its truth.
 */
import type { AiChatMessage, EventSummaryResult } from '@shared/post-mvp-types';
import { settingsStore } from '../storage/json-fs';
import { validateAiEndpoint } from '../security/validate';

const SUMMARY_SYSTEM =
  'You are summarizing a single UNVERIFIED open-source intelligence report. In one or two sentences, ' +
  'neutrally summarize ONLY what the report text states. Do not add facts, context, locations, or ' +
  'figures that are not present. Do not infer, estimate, or state casualty numbers. Do not judge ' +
  'whether the report is true. Output only the summary text.';

const TIMEOUT_MS = 30_000;

export async function summarizeEvent(description: string): Promise<EventSummaryResult> {
  const desc = (description ?? '').trim();
  const unavailable = (reason: string): EventSummaryResult => ({ available: false, reason });
  if (!desc) return unavailable('No description to summarize.');

  const s = await settingsStore.read();
  if (s.ai.provider !== 'ollama') return unavailable('Local AI model not available (set a local Ollama model in Settings → AI).');
  if (!s.ai.model?.trim()) return unavailable('No local Ollama model is configured (Settings → AI).');

  let endpoint: URL;
  try {
    endpoint = validateAiEndpoint(s.ai.endpoint, 'ollama');
  } catch (err) {
    return unavailable(`Invalid local AI endpoint: ${(err as Error).message}`);
  }

  const messages: AiChatMessage[] = [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: desc }
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL('/api/chat', endpoint).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.ai.model, messages, stream: false }),
      signal: controller.signal
    });
    if (!res.ok) return unavailable(`Local AI model returned HTTP ${res.status}.`);
    const data = (await res.json()) as { message?: { content?: unknown } };
    const text = typeof data?.message?.content === 'string' ? data.message.content.trim() : '';
    if (!text) return unavailable('Local AI model returned no summary.');
    return { available: true, text };
  } catch (err) {
    return unavailable(`Local AI model did not respond: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
```

Add to `src/shared/post-mvp-types.ts`:
```ts
/** Result of the isolated local-Ollama incident summary (Phase 3 Intel tab). `available:false` +
 *  `reason` when no local model / bad endpoint / call failed — the UI shows the reason and every
 *  other tab still works. */
export interface EventSummaryResult { available: boolean; text?: string; reason?: string; }
```

Add to `src/shared/ipc-contracts.ts` inside the `geoint` group:
```ts
    summarizeEvent: 'geoint:summarizeEvent',
```

Register in `src/main/ipc/register.ts` (beside the other `channels.geoint.*` handlers), importing `summarizeEvent`:
```ts
  safeHandle(channels.geoint.summarizeEvent, (...a) => summarizeEvent(String(a[0] ?? '')));
```

Expose in `src/preload/index.ts` (geoint block):
```ts
    summarizeEvent: (description: string) => ipcRenderer.invoke(channels.geoint.summarizeEvent, description),
```

Type in `src/preload/api.d.ts` (geoint block; import `EventSummaryResult`):
```ts
    summarizeEvent(description: string): Promise<EventSummaryResult>;
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run test/geoint-event-summary.test.ts && pnpm typecheck`
Expected: PASS (5/5); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/geoint/event-summary.ts src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts src/shared/post-mvp-types.ts test/geoint-event-summary.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "feat(geoint): isolated local-Ollama summarizeEvent service + IPC (Ollama-only, no RAG/web)"
```

---

### Task 4: MEDIA + INTEL SUMMARY tabs go live in `EventDetailsPanel`

**Files:**
- Modify: `src/renderer/modules/geoint/EventDetailsPanel.tsx`
- Test: `test/geoint-intel-media-tabs.test.tsx` (new)

**Interfaces:**
- Consumes: `deriveEntities` / `extractClaimPhrases` (Tasks 1-2); `window.api.geoint.summarizeEvent` (Task 3); existing `onOpenLink`, `safeHref`, `formatAbsolute`.
- Produces: MEDIA + INTEL marked `live:true` in `TABS`; `activeTab` widened to `'overview' | 'sources' | 'media' | 'intel'`.
  - **MEDIA (affordance only, NO inline remote media):** if `item.hasMedia`/`item.isVideo` or a non-empty `item.image`, show a "Media reported by source" block naming the kind (photo/video/image) + an **Open source** button (`onOpenLink(item.link)`, disabled when no `safeHref`). It MUST NOT render an `<img>`/`<video>` with a remote `src`. Empty state: "No media reported for this event."
  - **INTEL SUMMARY:** always renders **Key Entities** (`deriveEntities` — Places + "extracted mentions", or "None extracted") and **Reported casualty/verification phrases** (`extractClaimPhrases`, each as a quote with an "extracted · unverified" label, or "No casualty or verification phrases in the report."). The **AI summary** is fetched via `window.api.geoint.summarizeEvent(detail)` when the tab opens (guard: only if `window.api?.geoint?.summarizeEvent` exists): loading → then either the text under an **"AI · unverified"** stamp, or the returned `reason` (e.g. "Local AI model not available"). The AI section degrading NEVER blocks Entities/Phrases.

- [ ] **Step 1: Write the failing test**

Mirror the Phase 2 panel-test harness (`// @vitest-environment jsdom`, `createRoot`+`act`, `clickButton`/`hasText`; NO `@testing-library`). Stub `window.api.geoint.summarizeEvent`.

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement; let root: Root;
const render = (el: React.ReactElement): void => { act(() => root.render(el)); };
const clickButton = (re: RegExp): void => {
  const b = Array.from(container.querySelectorAll('button')).find((x) => re.test(x.textContent ?? ''));
  if (!b) throw new Error(`no button ${re}`);
  act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const hasText = (re: RegExp): boolean =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).some((el) => el.children.length === 0 && re.test(el.textContent ?? ''));
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem => ({ title: o.id, located: 'geo', ...o } as GeoItem);
const item = mk({ id: 'T', sourceId: 'wt', title: 'Strike near Mariupol', category: 'chatter', link: 'https://ex.org/e',
  detail: 'Missiles hit two districts near Mariupol. At least three people were killed. Casualties remain unconfirmed.',
  hasMedia: true, isVideo: true, place: 'Mariupol', country: 'Ukraine' });

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as any).window.api = { geoint: { summarizeEvent: vi.fn(async () => ({ available: true, text: 'Two districts were struck; details unconfirmed.' })) } };
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); delete (globalThis as any).window.api; });

describe('EventDetailsPanel — MEDIA + INTEL tabs', () => {
  it('MEDIA shows a reported-media affordance and NEVER an inline remote <img>/<video>', () => {
    render(<EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/MEDIA/i);
    expect(hasText(/Media reported/i)).toBe(true);
    const remote = Array.from(container.querySelectorAll('img,video')).filter((el) => /^https?:/i.test(el.getAttribute('src') ?? ''));
    expect(remote.length).toBe(0);
  });

  it('INTEL renders deterministic entities + casualty QUOTES (never a synthesized number)', () => {
    render(<EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/INTEL/i);
    expect(hasText(/Mariupol/)).toBe(true);                                   // place entity
    expect(hasText(/At least three people were killed\./)).toBe(true);        // verbatim quote
    expect(hasText(/extracted · unverified/i)).toBe(true);
  });

  it('INTEL shows the AI summary under an "AI · unverified" stamp when a model is available', async () => {
    render(<EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/INTEL/i);
    await flush();
    expect(hasText(/AI · unverified/i)).toBe(true);
    expect(hasText(/Two districts were struck/)).toBe(true);
  });

  it('INTEL degrades gracefully when no local model — entities still render', async () => {
    (globalThis as any).window.api.geoint.summarizeEvent = vi.fn(async () => ({ available: false, reason: 'Local AI model not available' }));
    render(<EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/INTEL/i);
    await flush();
    expect(hasText(/Local AI model not available/i)).toBe(true);
    expect(hasText(/Mariupol/)).toBe(true);   // rest of the tab still works
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-intel-media-tabs.test.tsx`
Expected: FAIL — MEDIA/INTEL tabs disabled; no media/intel content.

- [ ] **Step 3: Write minimal implementation**

In `EventDetailsPanel.tsx`: (a) set `media` and `intel` `live:true` in `TABS`; (b) widen `activeTab` state type to include `'media' | 'intel'`; (c) add a `summary` state `{ loading:boolean; result?: EventSummaryResult }` and a `useEffect` that, when `activeTab === 'intel'` and `window.api?.geoint?.summarizeEvent` exists and `item.detail` present, sets loading and calls it (guard against setting state after unmount / item change); (d) render the two tab bodies. Reuse `sectionStyle`/`legendStyle`/`noteStyle`. AI stamp = a small badge reading `AI · unverified`. MEDIA renders only text + an `Open source` button — NEVER an `<img>`/`<video>` with a remote src. Entities render as chips; claim phrases as blockquote-styled text with the `extracted · unverified` note.

- [ ] **Step 4: Run test + full geoint panel suite + typecheck**

Run: `pnpm vitest run test/geoint-intel-media-tabs.test.tsx test/geoint-sources-tab.test.tsx test/geoint-event-details-panel.test.tsx && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/EventDetailsPanel.tsx test/geoint-intel-media-tabs.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "feat(geoint): MEDIA (affordance) + INTEL (entities/quotes/AI·unverified) tabs live"
```

---

### Task 5: DOM-contract + charter test (no remote media, no raw HTML, all tabs live)

**Files:**
- Test: `test/geoint-intel-media-contract.test.tsx` (new — jsdom DOM/charter contract)

**Interfaces:**
- Consumes: `EventDetailsPanel` inside the `.ga98-window-shell > .window > .window-body` wrapper; a fixture with media + a rich description.
- Produces: assertions that (1) all four tabs (`OVERVIEW/SOURCES/MEDIA/INTEL`) are enabled and none carries "· soon"; (2) the panel root is `.ga98-geo-details` (not `.window`) with `overflow-y:auto`; (3) across every tab, there is **no** `<img>`/`<video>` with a remote `src` and **no** element with non-empty `dangerouslySetInnerHTML`/`innerHTML` injected content (charter: no egress, no XSS). The pixel-height scroll check remains a **controller** step (headless Chrome WITH the window-shell wrapper).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement; let root: Root;
const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem => ({ title: o.id, located: 'geo', ...o } as GeoItem);
const item = mk({ id: 'T', sourceId: 'wt', title: 'Strike', category: 'chatter', link: 'https://ex.org/e', image: 'https://ex.org/p.jpg',
  detail: 'Missiles hit two districts. At least three were killed. Casualties unconfirmed.', hasMedia: true, isVideo: true, place: 'Mariupol', country: 'Ukraine' });

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as any).window.api = { geoint: { summarizeEvent: vi.fn(async () => ({ available: false, reason: 'Local AI model not available' })) } };
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); delete (globalThis as any).window.api; });

describe('Intel/Media contract', () => {
  it('all four tabs are live and no tab inlines remote media, on any tab', () => {
    act(() => root.render(
      <div className="ga98-window-shell" style={{ height: 600 }}><div className="window"><div className="window-body">
        <EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />
      </div></div></div>
    ));
    const panel = container.querySelector('.ga98-geo-details') as HTMLElement;
    expect(panel.classList.contains('window')).toBe(false);
    expect(panel.style.overflowY).toBe('auto');
    const tabButtons = Array.from(container.querySelectorAll('button')).filter((b) => /OVERVIEW|SOURCES|MEDIA|INTEL/.test(b.textContent ?? ''));
    expect(tabButtons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(tabButtons.some((b) => /· soon/.test(b.textContent ?? ''))).toBe(false);
    for (const re of [/MEDIA/, /INTEL/, /SOURCES/]) {
      const b = tabButtons.find((x) => re.test(x.textContent ?? ''))!;
      act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      const remote = Array.from(panel.querySelectorAll('img,video')).filter((el) => /^https?:/i.test(el.getAttribute('src') ?? ''));
      expect(remote.length).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes honestly**

Run: `pnpm vitest run test/geoint-intel-media-contract.test.tsx`
Expected: PASS. If a remote `<img>` appears (e.g. someone rendered `item.image` as `<img src>`), that is a real charter finding — fix by replacing it with the affordance.

- [ ] **Step 3: Commit**

```bash
git add test/geoint-intel-media-contract.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "test(geoint): Intel/Media charter contract — all tabs live, no remote media inlined"
```

---

## Self-Review

- **Spec coverage:** INTEL SUMMARY = Task 3 (isolated Ollama path) + Task 4 (UI, "AI · unverified", graceful); KEY ENTITIES = Task 1 (deterministic) + Task 4; casualty/verification = Task 2 (quotes only) + Task 4; honest MEDIA = Task 4 (affordance, no remote media) + Task 5 (contract). Open question #2 (media reality) resolved by grounding: war-tracker gives booleans + `source_url` only → affordance. AI is Ollama-only + isolated (Global Constraints) per the operator's 2026-07-30 scope decision.
- **Type consistency:** `EventSummaryResult` defined in `post-mvp-types.ts` (Task 3), consumed by preload types + Task 4; `deriveEntities`/`EventEntities` + `extractClaimPhrases`/`ClaimPhrase` (Tasks 1-2) consumed by Task 4; `geoint.summarizeEvent` channel name identical across ipc-contracts / register / preload / api.d.ts.
- **Placeholder scan:** none — every step carries real code.
- **Charter:** AI local-only + isolated (no RAG/web/memory, Ollama-only, SSRF-guarded); casualties as verbatim quotes only; MEDIA never inlines remote media (cited `sanitizeHtml.ts` egress rule); no new dependency; deterministic selectors; XSS-safe.
