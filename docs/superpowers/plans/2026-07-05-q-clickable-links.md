# Clickable hyperlinks in Q's replies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Make URLs in Q's assistant replies clickable — markdown `[label](url)` links and bare `https://…` URLs — opening in the external browser behind a one-time clearnet IP-exposure acknowledgment.

**Architecture:** Renderer-only. A `link` AST node + parser change in `markdown.ts`; a `safeHref`-guarded external-opening anchor in `MarkdownView.tsx`; a `useClearnetLinkOpener` hook for the one-time-ack open policy; a `ai.linkClearnetAcknowledged` settings flag. Full spec — **read it, it carries the node shape, parsing rules, render markup, open flow, and per-section tests:** `docs/superpowers/specs/2026-07-05-q-clickable-links-design.md`.

**Tech Stack:** TypeScript, React 18, Vitest (+ jsdom `createRoot`). No new deps.

## Global Constraints

- **Commit identity:** author/committer `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`. NEVER emit `Co-Authored-By`/`Signed-off-by`/`Claude-Session`/any AI trailer.
- **Never stage pre-existing dirty files:** `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`. Stage only your task's files.
- **Security:** `safeHref` is the SINGLE render-time choke-point — a non-http/https or userinfo-bearing href renders as INERT TEXT, never an anchor. The parser stays scheme-agnostic (stores raw href). Link clicks `preventDefault` (no in-app navigation) and go through `window.api.system.openExternal` (main-side `validateExternalUrl` re-checks). No new IPC, no new egress path.
- **OpSec:** opening a link is a clearnet/real-IP event — gated behind the one-time `ai.linkClearnetAcknowledged` acknowledgment.
- **Determinism:** `markdown.ts` is pure — no Date.now/Math.random; assemble-twice equal.
- Branch `feat/q-clickable-links`. TDD: failing test → run (fails) → minimal impl → run (passes) → full `pnpm test` → `pnpm typecheck` → commit. Component tests mirror `test/x-ghostscrape-cases-sidebar.test.tsx` (createRoot in act(), mocked window.api).

---

### Task 1: Promote `safeHref` to a shared util

**Files:** Create `src/renderer/util/safe-href.ts` (move the body of `src/renderer/modules/socmint/safe-href.ts` verbatim); update importers — `src/renderer/modules/socmint/SocmintModule.tsx`, `src/renderer/modules/x/XCollectorModule.tsx` (grep `safe-href` to catch any others); delete the old file OR leave a one-line re-export. Test: `test/safe-href.test.ts` (move/extend any existing safe-href test).

**Produces:** `export function safeHref(url: string): string | null` at `src/renderer/util/safe-href.ts` — http/https only, rejects userinfo, null otherwise (unchanged behavior).

- [ ] Grep all `safe-href` importers; move the file; update every import path; run the socmint/x suites → still green (behavior-preserving). Add/keep a unit test: http/https pass, `javascript:`/`data:`/`mailto:`/malformed/userinfo → null. Run full suite, commit.

### Task 2: `link` AST node + markdown/autolink parsing

**Files:** `src/renderer/modules/ai-assistant/markdown.ts`. Test: `test/ai-markdown.test.ts` (extend — it exists).

**Produces:** `Inline` union gains `{ t: 'link'; href: string; children: Inline[] }`; `parseInline` parses markdown `[label](url)` (label recursive) and bare `https?://` autolinks (trailing-punctuation trimmed per spec §4); `inlineToText` gains `case 'link': return inlineToText(n.children)` (TTS parity via `stripMarkdown`). Parser stays scheme-agnostic (raw href stored; NO safeHref here).

- [ ] Tests: `[label](url)` → link node, href + parsed label; `[**b**](u)` keeps the bold child; `see https://x/a` → text + link; trailing trim (`https://x/a.` and `(https://x/a)` link `https://x/a`); URL inside `` `code` `` NOT autolinked; hostile `[x](javascript:alert(1))` → link node with raw `javascript:` href; unclosed `[label](` → literal text (no throw); `stripMarkdown('[go](http://x)')` reads `go`; parse-twice `toEqual`. TDD, run suite + typecheck, commit.

### Task 3: `ai.linkClearnetAcknowledged` settings flag

**Files:** `src/shared/types.ts` (add to the `ai` interface + `defaultSettings.ai`, default `false`). Test: `test/settings-memory-default.test.ts` OR a merge test (grep for the existing `ai`-merge/default test).

**Produces:** `ai.linkClearnetAcknowledged: boolean` (default false). Note: the merge at `src/main/storage/json-fs.ts:930` already spreads `ai: { ...base.ai, ...patch.ai }`, so a new default field upgrades cleanly — no json-fs change needed; just add to the type + defaults.

- [ ] Test: an old settings object whose `ai` block lacks `linkClearnetAcknowledged` merges (via the `{...base.ai, ...patch.ai}` path) to include it (default false) with existing `ai` fields preserved. TDD, run suite + typecheck, commit.

### Task 4: `useClearnetLinkOpener` hook (one-time-ack open policy)

**Files:** Create `src/renderer/modules/ai-assistant/useClearnetLinkOpener.ts`. Test: `test/use-clearnet-link-opener.test.tsx`.

**Consumes:** `useSettings` (`s.settings.ai.linkClearnetAcknowledged` + `s.patch`) from `../../state/store`; `confirmDialog` from `../../state/dialogs`; `window.api.system.openExternal`.
**Produces:** `useClearnetLinkOpener(): (safeUrl: string) => void` — if `ai.linkClearnetAcknowledged` → `void window.api.system.openExternal(safeUrl)`; else `confirmDialog(CLEARNET_LINK_TEXT, 'Open link in clearnet browser?')` → on ok `patch({ ai: { ...ai, linkClearnetAcknowledged: true } })` then openExternal, on cancel do nothing. Export `CLEARNET_LINK_TEXT`.

- [ ] Tests (mock `window.api.system.openExternal`, `confirmDialog`, `useSettings` store): acknowledged=true → openExternal called directly, confirmDialog NOT called; acknowledged=false + confirm → patch sets flag true AND openExternal called; acknowledged=false + cancel → neither patch nor openExternal. TDD, run suite + typecheck, commit.

### Task 5: MarkdownView render + AiAssistantModule wiring

**Files:** `src/renderer/modules/ai-assistant/MarkdownView.tsx`, `src/renderer/modules/ai-assistant/AiAssistantModule.tsx`. Test: `test/markdown-view-links.test.tsx`.

**Consumes:** Task 1 `safeHref`, Task 2 `link` node, Task 4 hook.
**Produces:** `MarkdownView` gains an `onLinkClick?: (safeUrl: string) => void` prop threaded through `renderInline`. `link` case: `const safe = safeHref(n.href)`; `safe===null` → `<span>{renderInline(children)}</span>` (inert text); else `<a href={safe} title={`${safe} — opens in your clearnet browser`} onClick={(e)=>{e.preventDefault(); onLinkClick?.(safe);}} style={LINK_STYLE}>{renderInline(children,onLinkClick)}<span aria-hidden>↗</span></a>`. `AiAssistantModule` calls `useClearnetLinkOpener()` and passes it as `<MarkdownView onLinkClick={openLink} …>`.

- [ ] Tests (jsdom): an http `link` node → renders an `<a>` with `href` = the safe URL; clicking it calls `onLinkClick(safe)` and the event is defaultPrevented (no navigation); a `javascript:` link node → renders text, NO `<a>`; a `mailto:` → text, no `<a>`; `onLinkClick` fires for a link nested inside a bullet list item. TDD, run suite + typecheck, commit.

## Self-review checklist (controller, before adversarial pass)

- safeHref is the single render choke-point; hostile schemes render inert; parser scheme-agnostic.
- Link clicks preventDefault (no in-app nav) + route via system:openExternal; one-time clearnet ack gates the open.
- New `ai` field upgrades via the existing `{...base.ai,...patch.ai}` merge (test proves it).
- No new IPC/egress. Full `pnpm test` + `pnpm typecheck` green; one commit per task, charter author, no trailers.
