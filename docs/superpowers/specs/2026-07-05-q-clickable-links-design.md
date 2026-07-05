# Clickable hyperlinks in Q's replies — design

**Status:** design (brainstorm complete, awaiting plan)
**Date:** 2026-07-05
**Origin:** GhostExodus field request — "ensure the AI turns URLs into clickable hyperlinks." Today Q's reply renderer parses `text`/`bold`/`italic`/`code` only, so both markdown links and bare URLs (e.g. the web-search "Sources used" list) render as plain, unclickable text.
**Boundary:** CORE (`/dcs98`), renderer-only. No new IPC, no new egress path.

---

## 1. Purpose

Make URLs in Q's replies clickable — both markdown `[label](url)` links and bare `https://…` URLs — opening in the external browser, while respecting the tool's Tor-first OpSec: there is **no Tor-routed path for arbitrary URLs** (`shell.openExternal` → OS default browser = clearnet, real IP), so a click is a deanonymization event and is gated behind a one-time clearnet acknowledgment.

## 2. Locked decisions (operator's calls, this brainstorm)

1. **IP-exposure = one-time clearnet acknowledgment.** Links are clickable and open in the default browser via the existing `system:openExternal`. The FIRST click on a Q-reply link shows a one-time modal ("opening a link uses your real clearnet IP, not Tor"); acknowledge once, then clicks open directly. Mirrors the X-collector gate + clearnet-web-search deanon ethos.
2. **Both link types** — markdown `[label](url)` AND bare-URL autolink (the "Sources used" URLs are bare; models emit both).

## 3. Architecture & components

Slots into the existing small, clean renderer without restructuring.

| File | Change |
|------|--------|
| `src/renderer/modules/ai-assistant/markdown.ts` | Add a `link` inline node + parse markdown links and bare-URL autolinks. Pure, deterministic. |
| `src/renderer/modules/ai-assistant/MarkdownView.tsx` | Render the `link` node through the `safeHref` choke-point (null → plain text); styled anchor that calls an injected `onLinkClick(safeUrl)` and `preventDefault`s. |
| `src/renderer/modules/ai-assistant/useClearnetLinkOpener.ts` (new) | Hook owning the open *policy*: one-time clearnet ack + `system:openExternal`. Keeps `MarkdownView` a pure renderer. |
| `src/shared/types.ts` | New `ai.linkClearnetAcknowledged: boolean` (default false) + added to `mergeSettings`'s `ai` deep-merge. |
| `src/renderer/util/safe-href.ts` (moved) | Promote `socmint/safe-href.ts` here (the AI module now needs it too, rather than reaching into `socmint/`); socmint callers re-import. |

Reused as-is: `window.api.system.openExternal` (→ main `shell.openExternal` behind the `validateExternalUrl` allowlist), `confirmDialog`, the settings patch path, the CSP/`will-navigate` lockdown (backstop). No new IPC, no new egress.

## 4. Parsing (`markdown.ts`)

New inline node: `{ t: 'link'; href: string; children: Inline[] }`. Two cases added to `parseInline`'s scan loop, composing with the existing code/bold/italic handling:

- **Markdown link `[label](url)`** — on `[`, look for a closing `]` immediately followed by `(url)`. Match → `pushText()`, emit `{ t:'link', href:url, children: parseInline(label) }` (label parsed recursively, so `[**bold**](url)` works), advance past `)`. No match (unclosed/mid-stream) → `[` falls through as literal text (existing unclosed-marker behavior).
- **Bare-URL autolink** — at `http://`/`https://`, consume up to whitespace/`<`, then **trim trailing punctuation** so `see https://x.com/a.` links `https://x.com/a` and drops the period: strip trailing `.,;:!?'"`, and a trailing `)`/`]` only when the URL has no matching opener. Emit `{ t:'link', href:url, children:[{t:'text',v:url}] }`; advance only past the kept characters.

Falls out of the existing structure for free:
- **URLs inside `` `code` `` are never autolinked** (the backtick case consumes them into a `code` node first).
- **A URL inside a markdown link's `(url)`** is captured by the link case, never double-processed.

`stripMarkdown` (TTS flattener) gets `case 'link': return inlineToText(n.children)` — Piper voices the label (or the URL text for a bare link), keeping spoken output matched to rendered text.

**The parser stays scheme-agnostic** — it stores the raw `href` (even `javascript:` from a hostile `[x](javascript:…)`). Scheme-guarding is the renderer's job via `safeHref`, preserving the single choke-point. (Autolinked hrefs are always `https?://` by construction; only markdown-link hrefs can be hostile, and those are render-guarded.) Pure, no throw on partial input.

## 5. Rendering + open flow

**Render** (`MarkdownView.renderInline`, new `link` case): compute `safeHref(n.href)` first.
- `null` (javascript:/data:/mailto:/malformed/userinfo) → `<span>{children}</span>`: **inert text, no anchor**.
- else:
  ```
  <a href={safe} title={`${safe} — opens in your clearnet browser`}
     onClick={(e) => { e.preventDefault(); onLinkClick?.(safe); }} style={LINK_STYLE}>
    {renderInline(n.children, onLinkClick)}<span aria-hidden>↗</span>
  </a>
  ```
  The `↗` cue + hover `title` signal "opens externally / clearnet." The real `href={safe}` gives hover-preview + right-click Copy-Link-Address, and — because `onClick` `preventDefault`s — never navigates the renderer. `onLinkClick` threads through `renderInline`'s recursion; `MarkdownView` takes it as a prop from `AiAssistantModule`.

**Open flow** (`useClearnetLinkOpener()` → `openLink(safeUrl)`):
- `ai.linkClearnetAcknowledged === true` → `void window.api.system.openExternal(safeUrl)` directly (click-and-go).
- else → `confirmDialog(CLEARNET_LINK_TEXT, 'Open link in clearnet browser?')` — *"Opening a link launches your default browser over the clearnet; the destination sees your real IP, not Tor. Continue? You won't be asked again."* Confirm → `patch({ ai: { …ai, linkClearnetAcknowledged: true } })` then open; cancel → nothing opens, flag stays false.

`AiAssistantModule` calls the hook and passes `openLink` as `MarkdownView`'s `onLinkClick`.

**Defense in depth (4 real layers):** (1) render-time `safeHref` → inert text for non-http/https; (2) `preventDefault` on **both `onClick` AND `onAuxClick`** → no in-app renderer navigation AND no middle-click new-window request; (3) the click routes to `onLinkClick` → the one-time clearnet-ack open policy → `window.api.system.openExternal`; (4) main-side `validateExternalUrl` allowlist re-checks the URL. **NB (adversarial finding):** the main `setWindowOpenHandler`/`will-navigate` path is NOT a clean backstop — an anchor with a real `href` middle-clicked issues a *new-window* request that `setWindowOpenHandler` sends straight to `shell.openExternal`, bypassing the ack. That vector is why `onAuxClick` must `preventDefault` (it cancels the new-window request before it is issued); left-click alone is insufficient.

**Streaming:** a partial `[label](` or half-typed URL renders as literal text mid-stream (existing robust-to-partial behavior) and resolves to a link once the full token arrives — the final render is always correct, no special handling. `mailto:` and other schemes stay inert text by design (not broadening `safeHref`).

## 6. Settings

`ai.linkClearnetAcknowledged: boolean` (default false), added to `mergeSettings`'s `ai` deep-merge so an older `settings.json` upgrades cleanly (`[[settings-merge-upgrade-dataloss]]`). Optional follow-on (noted, not built): a Settings → Q "Ask before opening links" checkbox to re-arm the warning.

## 7. Testing

- **`markdown.ts`** (pure): `[label](url)` → `link` node with recursively-parsed label; `[**b**](u)` keeps the bold child; bare-URL autolink splits `see https://x/a` into text+link; trailing-punctuation trim (`https://x/a.` and `(https://x/a)` link `https://x/a`); URL inside `` `code` `` NOT autolinked; hostile `[x](javascript:…)` keeps the raw href; unclosed `[label](` stays literal (no throw); `stripMarkdown` reads link label/URL text; assemble-twice deterministic.
- **`MarkdownView`** (jsdom): http link → `<a href=safe>` + `↗`, click calls `onLinkClick(safe)` and does NOT navigate (preventDefault); `javascript:`/`mailto:` → plain text, no anchor; `onLinkClick` threads through a link nested in a bullet/bold.
- **`useClearnetLinkOpener`**: acknowledged → opens directly, no dialog; not-acknowledged → shows `confirmDialog`, confirm patches flag + opens, cancel does neither (mock `openExternal`, `confirmDialog`, settings patch).
- **`mergeSettings`**: an old `settings.json` lacking the flag merges to include it (default false) with existing `ai` fields preserved.

## 8. Out of scope

- Any Tor-routed browsing path for arbitrary URLs (none exists; not building one here).
- Broadening `safeHref` beyond http/https (mailto/others stay inert text).
- A Settings toggle to re-arm the link warning (optional follow-on).
- Links anywhere other than Q's assistant replies (this renderer is Q-only).
