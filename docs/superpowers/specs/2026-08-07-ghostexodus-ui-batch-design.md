# GhostExodus UI Batch — Module Banners + Journal Jots Rich-Text Upgrade — Design

**Date:** 2026-08-07
**Status:** Approved (operator relayed GhostExodus's mockups; "crop and apply as needed … use those please")
**Branch:** `feat/ghostexodus-ui-batch`

## Goal

Apply GhostExodus's field-delivered pixel-art to six modules as full-width banner headers, redesign the Shred module around a "SHRED IT" panel, relayout the Journal Jots unlock screen, and upgrade the Journal Jots entry editor with rich text (bold/italic/underline), photo upload + resize, and clickable hyperlinks — all preserving Ghost Intel 98's offline-first, encrypt-at-rest, no-egress, theme-aware invariants.

## Scope — two workstreams

The batch splits into two independently-shippable passes:

- **Pass 1 — Banners & layout (art/CSS/markup).** Six banner headers + the Shred SHRED-IT panel redesign + the Journal Jots unlock relayout. Mechanical, visible, low-risk.
- **Pass 2 — Journal Jots editor upgrade (feature).** Rich-text B/I/U + photo upload/resize + hyperlinks, reusing the Reports module's sanitized-rich-text / photo-picker / scheme-guarded-link infrastructure. Substantive; its own security surface.

Each pass produces working, testable software on its own and gets its own implementation plan.

## Assets (delivered, staged, finalized on-branch)

All eight bundled to `src/renderer/assets/` as PNG (matching the `ghost-ledger-banner.png` precedent). Clean standalones were converted from the delivered JPGs; two banners + the Shred panel art were cropped from GhostExodus's window screenshots (native-resolution crops — the banners already spanned full window width — so no upscaling; only the original JPEG compression is inherited, invisible at header size):

| Asset | Source | Dims | Use |
|---|---|---|---|
| `q-banner.png` | clean standalone | 1280×492 | Q (ai-assistant) header |
| `briefcase-banner.png` | clean standalone | 1280×513 | Briefcase header |
| `mail-banner.png` | clean standalone | 1280×504 | Mail header |
| `settings-banner.png` | clean standalone | 1280×387 | Settings header (carries "GHOST INTEL 98 / SETTINGS" wordmark) |
| `journal-jots-banner.png` | cropped from editor screenshot | 1266×212 | Journal Jots editor header |
| `journal-jots-book.png` | clean standalone | 1280×1024 | Journal Jots unlock illustration |
| `shred-banner.png` | cropped from Shred screenshot | 1266×226 | Shred header |
| `shred-ghost-bin.png` | cropped from Shred screenshot | 300×230 | Shred "SHRED IT" panel art (ghost tossing paper into recycle bin; grey backdrop matches Win98 ButtonFace) |

## Pass 1 — Banners & layout

### Banner treatment (uniform across all six)

Each module gets a full-width banner band at the very top of its window body, below the titlebar. From the mockups the treatment is a **fixed-height header band, `object-fit: cover`, `object-position: center`** — the art fills edge-to-edge at a consistent height regardless of the window's actual width, with the key composition (title text, main character) centered so the crop never removes it. A shared class (e.g. `.ga98-module-banner`) carries the sizing so all six stay consistent; the band has a bottom bevel/border to seat it against the module chrome.

- Band height: a responsive clamp (~`clamp(120px, 16vw, 190px)`) so it reads as a header, not a hero, on both small and maximized windows.
- `image-rendering` stays default (the art is anti-aliased pixel-art, not nearest-neighbor pixel-art — `pixelated` would degrade it).
- **Theme-aware:** the banner images are theme-agnostic art and render identically under Classic and QUIET AMETHYST. The surrounding chrome (band border, any fill) must use existing `--ga98-*` tokens so amethyst stays correct. No banner may hide or recolour a LOCKED status/honesty token.

### Per-module placement

- **Q** (`ai-assistant`), **Briefcase**, **Mail**, **Settings** — insert the banner `<img>` as the first child of each module's window-body/header region, above existing content. Settings keeps its left-nav + right-pane layout below the banner.
- **Journal Jots** (`journal`) — banner shows in the **unlocked editor view only** (not the PIN screen), as the header above the New/entry-list + editor columns.
- **Shred** (`shred`) — banner + panel redesign (below).

### Shred SHRED-IT panel redesign

Per the Shred concept mockup, the Shred module becomes: banner header on top; the existing shred action on the left; and a right-side **"SHRED IT" panel** built from `shred-ghost-bin.png` plus:

- Heading: **SHRED IT**
- A three-item checklist framing: **Delete it · Forget it · It never existed**
- A warning line: **ONCE IT'S SHREDDED, IT'S GONE FOR GOOD**

The panel is presentational chrome around the *existing* shred behaviour — no change to what shredding actually does (the destructive action, its confirmation, and its guarantees stay exactly as they are). Copy is fixed art-direction from GhostExodus. Panel uses `--ga98-*` tokens for theme-awareness; the warning must remain legible under amethyst (route its colour through a theme-aware token, never a hardcoded light-surface value).

### Journal Jots unlock relayout

Restructure the PIN unlock screen into two columns:

- **Left (top-pinned):** heading "Enter your journal PIN", the existing honest explanatory copy ("The PIN locks this journal from casual access. Your entries are encrypted at rest by the app vault — the PIN is a convenience gate, not the encryption key."), the 4-digit PIN input, and the Unlock button — all pinned to the upper-left, not vertically centered.
- **Right:** the `journal-jots-book.png` illustration, contained (`object-fit: contain`) so the whole book is visible.

The PIN gate, the encrypt-at-rest behaviour, and the honesty copy are unchanged — this is layout only.

## Pass 2 — Journal Jots editor upgrade

The current editor is a plain text body. Upgrade it to a sanitized rich-text editor while preserving every existing plain-text entry.

### Rich text (bold / italic / underline)

- A small Win98-style toolbar above the body editor: **B**, **I**, **U** buttons operating on a `contenteditable` region.
- Stored content is **HTML sanitized through the same DOMPurify allowlist Reports uses** — a tight allowlist (`b/strong`, `i/em`, `u`, `a`, `img`, `br`, `p`, block basics), no scripts, no event handlers, no arbitrary attributes. Sanitize on **both** write (save) and render (defense in depth), so a tampered-on-disk entry cannot inject.
- **Backward compatibility:** existing plain-text entries render as-is (plain text escaped into the editor). The entry's stored shape gains a format discriminator (or the body is treated as HTML only when marked), so old entries never get mis-parsed as HTML.

### Photo upload + resize

- Reuse the Reports module's photo-picker + resizable-photo infrastructure (`CasePhotoPicker`, `ImageBlock`'s %-width resize handle, `addPhotoBytes` → `putAsset` ref-based flow).
- **Net-new backend required:** Journal has no asset store today (unlike Reports' `reports.putAsset/getAsset`). Pass 2 adds a **journal-scoped encrypted asset store** — `journal.putAsset(bytes,mime)` / `journal.getAsset(ref)` IPC backed by `secure-fs` under the journal data root, png/jpeg only, ref-based (bytes never in the entry body). Photos are **encrypted at rest** through the same vault DEK as journal entries; the entry stores only an `assetRef`, **never a remote URL** (no beacon surface).
- **Editor-model fork (settled in Plan B):** Reports' text sanitizer intentionally excludes `<img>` — Reports separates photos into ref-based blocks rather than inlining them. Journal Jots therefore chooses between (A) adopting Reports' block-list model wholesale (max reuse, resize free, but changes `JournalEntry.body: string` → a blocks array + migration, and reads less like the single-page mockup), or (B) a single free-flowing rich `contentEditable` page (faithful to the "Dear journal…" mockup, B/I/U + links reuse `TextBlock`'s `execCommand` approach directly) with photos as inline `<img assetRef>` permitted by a **journal-specific** sanitizer variant (allowlist = Reports' tags **+ `img` whose `src` is an internal asset-ref/`data:` only, never remote**) and an ImageBlock-style resize overlay. Plan B pins one; the security constraints below bind either.

### Clickable hyperlinks

- Insert-link affordance in the toolbar; links render clickable in the entry.
- External open goes through the app's existing **scheme-guarded** safe-open path (http/https only, validated) — the same guard the rest of the app uses (`guardExternalUrl` / the clearnet-link-opener), including the app's real-IP/clearnet acknowledgement where applicable. No `javascript:`/`file:`/`data:`-navigation links. The sanitizer's `a href` allowlist enforces http/https only.

## Security & charter constraints (LOCKED — every task inherits these)

1. **Sanitize all rich-text** through the Reports DOMPurify allowlist, on write and render. No script/event-handler/unknown-attribute survives.
2. **Encrypt-at-rest** for Journal Jots photos and rich-text bodies — through the existing Journal vault; no plaintext note media on disk.
3. **Scheme-guard** every hyperlink external-open (http/https only) via the app's existing guarded opener; no new open path.
4. **No new network egress, no telemetry, no new runtime dependency.** Reuse in-tree infra (DOMPurify, photo picker, link guard) — do not add libraries.
5. **PIN gate preserved.** Journal Jots stays PIN-gated; unlock relayout is presentational.
6. **Theme-aware.** All new chrome uses `--ga98-*` tokens and stays legible under Classic and QUIET AMETHYST; no LOCKED status/honesty token is recoloured or hidden; banner art is theme-agnostic.
7. **Classic parity for existing behaviour.** Shred's destructive action, the PIN flow, and existing entries behave exactly as before.

## Testing

- **Banners:** panel-render tests (React 18 `createRoot`+`act`) assert each module renders its banner `<img>` with the expected asset; the headless Chromium computed-style harness (`test/helpers/chrome-computed-style.ts`, inside `.ga98-window-shell > .window > .window-body`) confirms the band sizing + that amethyst doesn't break legibility of adjacent chrome.
- **Shred panel:** render test asserts the SHRED IT heading, the three checklist items, and the warning copy are present; existing Shred behaviour tests stay green (no behavioural change).
- **JJ unlock:** render test asserts PIN form + book image present; PIN-gate + encryption tests unchanged.
- **JJ editor:** sanitizer tests (malicious HTML — `<script>`, `onerror=`, `javascript:` href, remote `img` src — is stripped) on write and render; plain-text back-compat test (an old entry renders unchanged); photo encrypt-at-rest test; hyperlink scheme-guard test (only http/https reach the opener).

## Out of scope

- No change to shred semantics, PIN semantics, or the encryption scheme.
- No new module, no new dependency, no new egress.
- WhatsApp/X/Telegram collectors untouched.
