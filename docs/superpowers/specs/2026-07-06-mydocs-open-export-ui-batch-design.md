# Design — My Documents Open/Export + UI batch (GhostExodus beta feedback)

**Date:** 2026-07-06
**Status:** approved design, pre-plan
**Origin:** GhostExodus field feedback on v3.32.0 (My Documents shipped; he hit the encrypt-at-rest
wall opening files, plus four polish asks).

## Goal

Close the one real defect in My Documents — files are stored encrypted-at-rest, but the module gives
no in-app way to open them, so the "open them here, not in Explorer" banner promises something the app
can't yet do — and fold in four UI refinements GhostExodus requested in the same pass.

## Context

My Documents (`src/main/documents/`, `src/renderer/modules/my-documents/`) shipped in v3.32.0. Imported
files route through `secureWriteFile`, which encrypts the bytes whenever the vault is unlocked
(`store.ts:169`). The only way to reach a file today is `reveal` (`shell.showItemInFolder`) → double-click
in Explorer → the native app reads **ciphertext** → "unreadable content / check file permissions." That
is the encrypt-at-rest trade-off working as designed; the defect is that we instruct the user to open
files "here" while providing no "here."

Operator decisions (2026-07-06), locked:
- My Documents openability = **A + B**: an in-app **Open** (decrypt → launch native app → session-scoped
  shred) **and** an **Export decrypted copy…** action. Encrypt-at-rest is preserved; the vault store is
  never rewritten to plaintext.
- Temp lifecycle for Open = **session-scoped + startup sweep** (Windows gives no reliable "the external
  app closed the file" signal, so we don't guess).
- Q clearnet control = **two controls** — an Enable-clearnet checkbox plus a Fallback/First mode — with
  clearnet **disabled by default** and defaulting to **Fallback** when first enabled.

## Global Constraints

- **Encrypt-at-rest invariant is not weakened.** The vault-backed store keeps ciphertext on disk. The
  only plaintext that ever exists is (a) a session-scoped temp created by Open, swept on quit and on next
  launch, and (b) a copy the user *deliberately* exports to a location they choose. Both are the
  unavoidable cost of handing bytes to a third-party app / the user; neither changes what sits in the vault.
- **No new network egress** beyond the clearnet DuckDuckGo path that already exists and that the user must
  explicitly enable. Clearnet-first adds no new clearnet engines (DDG only).
- **Win98 visual fidelity** is load-bearing (the app reads as a real OS). New surfaces use the existing
  98.css idiom, not modern chrome.
- Commits authored `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, **no AI-identity
  trailers**, explicit-path staging only (never `git add -A`/`.`).
- Path confinement unchanged: every relPath crossing IPC is fenced by `ensureDocRelPath`/`ensureDocName`
  and re-confined in the store via `confineExisting` (realpath-prefix). Traversal fails closed.

---

## Workstream 1 — My Documents: Open + Export

### Store operations (`src/main/documents/store.ts`)

Two new exported functions beside `reveal`:

**`openEntry(relPath: string): Promise<void>`** — files only.
- Confine `relPath` (`confineExisting`) → real absolute path.
- Reject a directory target (`stat().isDirectory()` → throw `Refusing to open a folder.`).
- Decide per-file with `isEncryptedFile(real)` (secure-fs already exports it):
  - **Encrypted** → `secureReadFile(real)` (decrypt) → write bytes to a temp in the dedicated dir
    `join(app.getPath('temp'), 'ga98-docopen')` with a random basename that **preserves the real
    extension** (`randomUUID()` + `extname(name)`), so the OS launches the correct app → `shell.openPath(temp)`.
    Track the temp path in a module-level `Set<string>` for shredding.
  - **Not encrypted** (vault off — passthrough store) → `shell.openPath(real)` directly; no temp, nothing
    to track.
- `openPath` returning a non-empty error string is surfaced to the caller (renderer shows a toast), not
  swallowed.

**`exportEntry(relPath: string, destPath: string): Promise<void>`** — files only.
- `destPath` is chosen by the user via `dialog.showSaveDialog` in the IPC layer (see below); it is
  deliberately **outside** the documents-root confinement (that is the point of export), so it is NOT run
  through `ensureDocRelPath`. It is instead guarded against a symlink target and a non-existent parent
  directory (mirrors the existing export symlink-refusal at `register.ts:1213`).
- Confine `relPath`, reject directories, then `secureReadFile(real)` (decrypts iff encrypted; passthrough
  otherwise) → `writeFile(destPath, bytes)`.

### Temp lifecycle (`src/main/documents/` — new small module `open-temp.ts`)

- `sweepDocOpenTemp()` — on app startup (called from main bootstrap): `rm(ga98-docopen, {recursive,
  force})` then recreate the empty dir. Clears any stragglers left by a prior crash.
- `shredDocOpenTemps()` — on `app.on('before-quit')`: for each tracked temp, best-effort **overwrite with
  random bytes of the same length, then unlink**, wrapped in try/catch (Windows may still hold a lock;
  the startup sweep is the backstop), then `rm(ga98-docopen, {recursive, force})`. This is a targeted
  secure-delete helper, distinct from the Shred recycle-bin store (`shredStore`, which is a restore/purge
  soft-delete for cases).

### IPC (`src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, preload, `api.d.ts`)

- `documents.open` — arg `relPath` → `ensureDocRelPath` → `store.openEntry`.
- `documents.export` — arg `relPath` → `ensureDocRelPath`; the handler opens `dialog.showSaveDialog`
  (default filename = the entry's real name), and on a non-cancelled result calls `store.exportEntry(rel,
  chosenPath)`. Cancel = no-op, resolves cleanly.

### Renderer (`src/renderer/modules/my-documents/`)

- `useDocuments.ts` gains `open(entry)` and `exportFile(entry)` calling the new IPC, each with explicit
  error handling (no silent swallow — the v3.32.0 review flagged that class).
- Double-clicking a **file** entry calls `open`. Double-clicking a **folder** enters it (unchanged).
- Context menu (see Workstream 3) gains **Open** and **Export…**, both files-only.
- The encrypt-at-rest banner stays — it is now truthful.

---

## Workstream 2 — My Documents: Win98 large-icons grid

Replace the current cramped small-row list in `MyDocumentsModule.tsx` with a Win98-faithful **large-icons
view**:
- A wrapping grid of tiles; each tile = a large glyph (tan folder glyph for folders, a generic ruled-
  document glyph for files) with the real name label beneath, center-aligned, Win98 selection highlight.
- Ordering: folders first, then files, each group name-sorted (matches `store.list` output; assert order
  in the store test already covers folder/file separation).
- Double-click folder = enter; double-click file = Open (Workstream 1).
- This is a deliberate translation of GhostExodus's Win11-tile reference into the Win98 large-icons idiom;
  we do **not** render a path subtitle or pin glyph (would break the OS illusion). Name label only.
- No thumbnails/previews — generic glyphs only (non-goal).

---

## Workstream 3 — My Documents: context-menu reorder

`DocumentsContextMenu.tsx` new order, top to bottom:

```
New Folder            (always shown)
────────── separator ──────────
Open                  (entry only, files only)
Rename                (entry only)
Delete                (entry only)
Copy                  (entry only)
Cut                   (entry only)
Paste                 (always shown; disabled unless canPaste)
Export…               (entry only, files only)
```

- New Folder moves to the top (was below the separator).
- Paste sits directly beneath Cut (was in the New Folder group).
- On an empty-space right-click (no entry) the menu is just `New Folder · separator · Paste` — unchanged
  set, new order.
- Open/Export are gated on `entry && entry.kind === 'file'`.

---

## Workstream 4 — Jukebox: compact-by-default with expand caret

`src/renderer/modules/media/MediaPlayerModule.tsx` (422 lines; title "Jukebox").

- Introduce a boolean `expanded` UI state with two layouts:
  - **Compact** (default): transport controls + track display only (GhostExodus's third image).
  - **Expanded**: adds Track Length row, the action bar (Add folder / Open files / Load playlist / Save
    queue / Refresh), Library list, and Stations list (fourth image).
- A caret button (▲/▼, Win98 idiom) in the player header toggles the two; the module window resizes to fit
  each mode.
- **Opens compact by default**, then remembers the last choice: persist a `jukeboxExpanded: boolean`
  (default `false`) in app settings.
- **Settings-merge guard (charter-critical):** `jukeboxExpanded` must be added to `mergeSettings` so an
  upgrade from an older settings file does not drop it, with a merge test — this is the exact footgun that
  caused the v3.24.0 "username search dead" dataloss. If it lands inside a new nested settings object,
  that whole object joins the deep-merge list.

---

## Workstream 5 — Q: clearnet checkbox + Fallback/First mode

### Setting (`src/shared/types.ts`)

- `ai.webSearchClearnet: boolean` — exists, default `false` (the master enable).
- **New** `ai.webSearchClearnetMode: 'fallback' | 'first'` — default `'fallback'`. Added to the `ai`
  settings group (already deep-merged) plus a merge test.

### Semantics

- `webSearch` off → no web search at all (unchanged master gate).
- `webSearchClearnet` off → Tor-only, onion-to-onion, never clearnet (today's default; unchanged).
- `webSearchClearnet` on + mode `fallback` → **today's behavior**: Tor first; DDG clearnet fires only on
  an empty Tor result; deanonymization warning shown in-stream when it fires.
- `webSearchClearnet` on + mode `first` → skip Tor, query DDG clearnet directly, with the in-stream
  deanonymization warning on **every** such search.
- **DDG-only reality:** clearnet is DDG-only (`clearnetEligible = engine.id === 'ddg'`, `ai.ts:165`). If
  the selected engine is the SearXNG onion (not clearnet-eligible), mode `first` is inert — the search
  stays Tor-only and an in-stream note says clearnet applies to DuckDuckGo only. Not silently ignored.

### Decision helper (`src/main/services/web-search/directive.ts`)

- `WebSearchPlan.mode` already `'tor' | 'clearnet' | 'empty'`. Extend the pure planner to take the new
  mode: when `clearnetOn && clearnetEligible && mode === 'first'`, the initial plan is `clearnet` (no Tor
  attempt). Otherwise the existing tor→(empty?)→clearnet fallback logic is unchanged. Side-effect-free;
  unit-tested.
- `ai.ts` passes `clearnetMode: s.ai.webSearchClearnetMode` alongside the existing `clearnetOn` /
  `clearnetEligible`.

### UI (`src/renderer/modules/ai-assistant/AiAssistantModule.tsx`)

- An **Enable clearnet** checkbox bound to `webSearchClearnet` (unchecked by default).
- When checked, a **Fallback / First** control (radio or select) bound to `webSearchClearnetMode`,
  defaulting to Fallback. Selecting First shows a short inline warning that clearnet-first exposes the real
  IP on every search. Both controls sit inside the Q window (not buried in Settings), matching
  GhostExodus's "checkbox inside Q… simply toggled."

---

## Testing

- **`documents-store` / new `documents-open-export` test:** encrypted file → Open writes a decrypted temp
  under `ga98-docopen` with the right extension and calls `openPath` (mock secure-fs + `shell`); plaintext
  file → Open calls `openPath` on the real path, no temp; Open rejects a folder; Export writes the
  decrypted bytes to the chosen dest (mock `dialog`); Export refuses a symlink dest; `sweepDocOpenTemp`
  clears the dir; `shredDocOpenTemps` overwrites+unlinks tracked temps.
- **`documents-ipc-surface`:** `documents.open` / `documents.export` route relPath through
  `ensureDocRelPath`; export cancel is a clean no-op.
- **`my-documents-module`:** grid renders folders-then-files with correct glyphs; double-click file →
  open; context-menu order (New Folder top, Paste under Cut, Open/Export files-only).
- **`web-search directive`:** mode `first` + eligible → plan `clearnet`; mode `first` + ineligible engine
  → plan `tor`; mode `fallback` preserves current tor→empty→clearnet path.
- **`media` module:** opens compact; caret toggles to expanded; persists `jukeboxExpanded`.
- **settings merge:** `jukeboxExpanded` and `webSearchClearnetMode` survive an upgrade from a settings
  file lacking them (deep-merge guard).
- Full `pnpm typecheck` (both configs) + full `pnpm test` green — controller re-runs the whole suite
  after the workflow, not per-file (the v3.32.0 stale-snapshot lesson).

## Non-goals

- No drag-out of files from My Documents to the PC (Export covers deliberate extraction).
- No in-grid thumbnails/previews — generic glyphs only.
- No per-file "close & shred now" button (session-scoped sweep chosen instead).
- No new clearnet search engines; clearnet remains DDG-only.
- No change to the Shred recycle-bin store; Open's temp shred is a separate targeted helper.

## Security notes

- Open's plaintext temp is the only new plaintext-on-disk surface. It lives in an app-dedicated temp dir,
  carries a random name, is overwrite-then-unlinked on quit, and the dir is swept on every startup — so a
  crash bounds exposure to "until next launch," never indefinitely.
- Export writes plaintext only to a path the user explicitly picks; the symlink-target refusal prevents an
  export being redirected to clobber another file.
- Clearnet-first is strictly opt-in behind an off-by-default master toggle, carries a per-search
  deanonymization warning, and cannot route a non-DDG engine over clearnet. The Tor-only path is never
  weakened for users who leave clearnet disabled.
