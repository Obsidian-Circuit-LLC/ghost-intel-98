# Multi-engine web-search picker for Q — design

**Status:** design (brainstorm complete, awaiting plan)
**Date:** 2026-07-05
**Origin:** GhostExodus field request — a Firefox-style search-engine picker ("sometimes Google hasn't indexed what Yahoo has"). Today Q's web search is DuckDuckGo-only.
**Boundary:** CORE (`/dcs98`). Extends the existing `web-search` service + the `[SEARCH:]` directive loop + a chat-toolbar picker. No architecture-level new egress posture (reuses the app's existing Tor-onion and opt-in-clearnet tiers).

---

## 1. Purpose

Let the user pick which search engine Q uses, for coverage diversity, WITHOUT weakening the Tor-first posture: a strict onion-to-onion default tier (DuckDuckGo + a SearXNG onion metasearch that aggregates Google/Bing/etc. while keeping the IP fully hidden) and an opt-in, deanon-warned clearnet tier for the literal big engines.

## 2. Locked decisions (operator's calls, this brainstorm)

1. **Two egress tiers, both = the charter's existing consent tiers.** `tor` = onion-to-onion only (IP fully hidden, `.onion`-enforced, no exit node); `clearnet` = direct clearnet, opt-in behind `ai.webSearchClearnet` + a per-query "⚠ real IP exposed" warning. **No Tor-exit middle tier** (an exit node weakens the path and the big engines block Tor exits anyway).
2. **Approach = Tor-safe coverage diversity (default) + the literal big engines opt-in with a warning.**
3. **Include SearXNG onion**, pinned default instance + operator-configurable + fail-closed. It sees the user's queries (a trust shift from DDG) — documented plainly.

## 3. Architecture — pluggable engine registry

Refactor the hard-wired DDG search into a **registry of `SearchEngine` descriptors**:

```ts
interface SearchEngine {
  id: string;                    // 'ddg' | 'searxng' | 'bing' | 'yandex' | 'yahoo' | 'google'
  label: string;                 // 'DuckDuckGo (Tor onion)'
  egress: 'tor' | 'clearnet';
  run(query: string, deps): Promise<{ results: WebResult[]; reason: SearchReason }>;
}
```

- **`ddg.ts` becomes the DDG engine descriptor** (`egress:'tor'`, onion-to-onion) — its `parseDdgResults` + `.onion` enforcement stay UNTOUCHED (behavior-preserving extraction, not a rewrite).
- **Each new engine is a self-contained descriptor** with its own endpoint + parser + egress class. A broken parser for one engine can never affect another — the registry isolates fragility per-engine.
- **`SearchReason`** gains `needs-clearnet-optin` (a clearnet engine selected without the opt-in → a clear reason, never a silent fail).

## 4. Egress tiers

- **`tor` (default, no new consent):** IP fully hidden, `.onion`-enforced fail-closed. Runs under the existing `ai.webSearch` gate. A non-onion endpoint (default or operator-misconfigured) returns `[]` — a clearnet host can never route through Tor.
- **`clearnet` (opt-in + warned):** real IP hits the engine. Runs only when BOTH `ai.webSearch` AND `ai.webSearchClearnet` are on; every clearnet query prints the existing unmistakable "⚠ your real IP is exposed to these results and their hosts" banner.

Deliberately **no `tor-exit` tier** — worst of both (exit node in the trust path + the big engines captcha/block Tor exits → mostly challenge pages). Binary is honest: fully hidden (onion) or exposed-and-warned (clearnet).

## 5. Engine set

**Honesty gate:** no endpoint's current reachability/parseability is assumed. Task 1 is a **prior-art / verification pass** (fetch each candidate over Tor/clearnet, confirm a parseable no-JS/JSON response, save a real fixture, record in `research-wiki/prior-art/`). An engine that can't be verified is dropped, not shipped broken.

**`tor` (onion-to-onion, IP-hidden):**
- **DuckDuckGo onion** — already working, stable `/html/` parse. Default engine.
- **SearXNG onion** — metasearch aggregating Google/Bing/DDG/Brave/Startpage behind one onion endpoint with a JSON API (`?format=json`): real big-engine coverage while fully Tor-hidden, clean JSON not HTML scraping. Pinned default onion instance, operator-configurable (`ai.searxngOnion`), fail-closed + `.onion`-enforced. Trust note: the chosen instance sees the user's queries.

**`clearnet` (opt-in + warned, IP-exposed):**
- **Bing, Yandex, Yahoo** — direct HTML scrape; more parseable than Google, each an isolated (fragile, maintenance-prone) parser.
- **Google** — best-effort and least reliable (consent walls / JS-required even from clearnet); included but labeled as such.

*(Explicitly out of scope: an onion-site search like Ahmia — that searches the dark web, a different feature.)*

## 6. Picker UX, loop, settings

**Settings** (added to `mergeSettings`):
- `ai.searchEngine: string` — selected engine id, default `'ddg'`.
- `ai.searxngOnion: string` — SearXNG onion instance URL, default a pinned vetted instance, editable in Settings → Q, `.onion`-enforced fail-closed.
- Reuse `ai.webSearch` (Tor gate) + `ai.webSearchClearnet` (clearnet opt-in) — no new gates.

**Picker UI:** a compact dropdown in the chat toolbar next to the existing "Web (Tor)" checkbox. Each option shows label + egress badge (`DuckDuckGo · Tor`, `SearXNG · Tor`, `Bing · clearnet`, `Google · clearnet (best-effort)`). Clearnet engines are visible but, with the opt-in off, selecting one shows an inline "needs the clearnet opt-in (Settings → Q)" hint.

**Directive loop** (`ai.ts` / `directive.ts`): the `[SEARCH: query]` handler resolves `registry.get(settings.ai.searchEngine)` and runs `engine.run(query, deps)`; the tor/clearnet gate is decided by `engine.egress`. The model stays oblivious (it just emits `[SEARCH:]`). Kept exactly as-is (engine-agnostic, security-critical): the **untrusted-data fence** (per-request fence + newline-strip + URL-sanitize — the red-team-hardened prompt-injection guard) applies to every engine's `WebResult[]`; the transparency line becomes engine-aware ("🔍 searching **Bing** over CLEARNET for …" with the deanon warning). "Sources used" URLs are clickable (the just-shipped links feature).

## 7. Testing

- **Verification pass (Task 1, gates all parsers):** real saved fixtures per engine + prior-art record; unverifiable engines dropped.
- **Per-engine parsers (pure):** `parse(fixture) → WebResult[]` for DDG (existing), SearXNG JSON, Bing/Yandex/Yahoo/Google HTML; malformed/empty/challenge-page → `[]`, never throws; deterministic.
- **Registry:** lookup by id; unknown/removed id → DDG fallback; each `egress` class correct; id set == picker options.
- **Egress gating (security core):** `tor` engine runs under `ai.webSearch`; `clearnet` engine blocked without `ai.webSearchClearnet` → `needs-clearnet-optin` reason; onion engines (DDG, SearXNG) `.onion`-enforced fail-closed on a non-onion endpoint.
- **Untrusted-data fence:** an injected `[SEARCH:]`/instruction in any engine's result body is fenced/neutralized (engine-agnostic).
- **SearXNG instance config:** pinned default loads; operator override honored; non-`.onion` override fails closed.
- **Settings merge:** old `settings.json` lacking `searchEngine`/`searxngOnion` upgrades cleanly (defaults) with existing `ai` fields preserved.
- **Picker UI (jsdom):** engines listed with egress badges; selecting patches `ai.searchEngine`; clearnet engine shows the opt-in hint when off.

**Charter/security:** onion tier `.onion`-enforced (no clearnet leak); clearnet tier only under the explicit opt-in + per-query deanon warning; injection fence preserved; SearXNG instance sees queries (documented trust shift); no parser ships against an unverified format (prior-art pass is a hard gate); no telemetry.

## 8. Out of scope

- Any Tor-exit egress tier (excluded by decision).
- Onion-site (dark-web) search engines (Ahmia et al.) — different feature.
- Multi-engine simultaneous/aggregated querying in-app (SearXNG does the aggregating server-side; the app queries ONE selected engine at a time — GhostExodus asked for user-selection, not all-at-once).
- Self-hosting/bundling a SearXNG instance (v1 pins a public onion + allows an operator override).
