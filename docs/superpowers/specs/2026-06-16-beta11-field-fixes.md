# v3.14.0-beta.11 — GhostExodus field-feedback batch

Field feedback from dogfooding beta.10. Eleven concrete fixes across GeoINT (globe),
EyeSpy (CCTV wall), and Mail. DialTerm confirmed working — no change.

Operator decisions (2026-06-16):
- Mail chime: **app-refresh always chimes** on new mail, poller also chimes (soundEnabled-guarded),
  both **de-duped** within a short window so one mail event won't double-chime.
- Double-click a feed → **fill the expanded pane, contained** (object-fit: contain, centered); same
  centering applied to wall tiles.
- Mail chime is **user-replaceable**: a Settings button opens a `userData/sounds/` folder seeded with
  the default `mail-notify.wav`; replacing the file changes the chime.

## GeoINT (globe)

- **G1 Space background.** The MapLibre canvas is transparent around the globe → shows the container
  (`.ga98-geo-map`) background, currently Win98 grey. Add a CSS starfield + faint nebula vignette to
  `.ga98-geo-map`. Offline, no egress. The in-sphere dark (`#0a0f1a` background layer in `buildStyle`)
  is unchanged so a gate-off globe stays dark.
- **G2 Popup style.** The globe uses MapLibre's default white popup. Add scoped CSS under
  `.ga98-geo-right` for `.maplibregl-popup-content` (translucent dark `rgba(10,15,26,.92)`, white text,
  subtle border/shadow, rounded), `a`/`b` colors, and per-anchor `.maplibregl-popup-tip` colors.
- **G3 Close-X overlap.** Same CSS change: `padding-right` on the content so the close ✕ no longer
  overlaps the title; reposition/restyle `.maplibregl-popup-close-button`.
- **G4 Left panel clipping.** `.ga98-geo-3col` is `380px 1fr 300px`; on a non-maximized window the fixed
  680px squeezes the layout and clips left controls. Make side tracks shrinkable
  (`minmax`), keep left readable, ensure left-pane rows wrap rather than clip.

## EyeSpy (CCTV)

- **E1 Add-feed tile.** `Wall.tsx:59` trailing add tile calls only `onAddNew` (never `onActivate`), so it
  can't be selected and the add targets the *last-active* slot. Fix: clicking "Add new feed" opens the
  add form AND the new stream is appended to the wall and becomes active (place-on-wall flow in
  `EyeSpyModule`), so it lands where the tile implies, not on a stale slot.
- **E2 Tile fit.** `Viewer` media is `maxWidth/maxHeight:100%`, top-left aligned → letterboxes top-left in
  wide tiles. Make media fill its box centered with `object-fit: contain`.
- **E3 Double-click fit-to-screen.** Expanded pane (`EyeSpyModule:293`) uses the same Viewer → same
  centering; the expanded view fills the pane, contained, centered.
- **E4 YouTube kind.** Add `'youtube'` to `StreamKind`. `Viewer` renders a sandboxed
  `www.youtube-nocookie.com/embed` iframe (reusing `parseYouTubeId`, the youtube-nocookie frame-src
  exception already authorized for Live News). Add-form gains a YouTube kind option + auto-detect of
  youtube URLs; URL validated via `parseYouTubeId` before save.

## Mail

- **M1 Chime fires from the app.** Drop the `!mailBackgroundCheck` guard in `MailModule` refresh/silent
  paths so an in-app refresh chimes on new mail; add a `soundEnabled` guard to the poller path
  (`App.tsx:100`). New `playMailNotifyDeduped()` (module-level last-fired timestamp, ~4 s window) used by
  both real paths so the poller + an in-app refresh of the same mail won't double-chime. The Settings
  test button keeps the raw always-play `playMailNotify()`.
- **M2 User-replaceable chime.** Ship `resources/sounds/mail-notify.wav` (extraResources). New
  `main/services/sounds.ts`: seed `userData/sounds/mail-notify.wav` from resources if absent; expose
  bytes (base64) + open-folder. IPC `sounds:mailChime` / `sounds:openFolder`. `synth.ts` loads the chime
  via IPC into a cached blob URL (media-src already allows `blob:`), falling back to the bundled asset.
- **M3 Settings.** "Open sounds folder" button + a one-line note in the Sound pane; opening the folder
  clears the renderer chime cache so a replacement takes effect without restart.

## Shared

- Extract `parseYouTubeId` to `src/shared/youtube.ts` (pure, `URL`-based); `LiveNewsPanel` and EyeSpy
  `Viewer` both import it. Keep `LiveNewsPanel` re-exporting it so existing tests resolve.

## Tests

- `test/eyespy-wall.test.ts` — add-feed appends + becomes active; existing slot fill still works.
- `test/youtube.test.ts` — `parseYouTubeId` host-allowlist + id shapes (migrated/extended from the
  livenews test's coverage).
- `test/eyespy-youtube.test.ts` — Viewer accepts a valid youtube URL, rejects a non-youtube host.
- Mail dedup: unit-test the dedup gate (synchronous timestamp window) without real audio.

## Out of scope / operator-owned

- Whether to bake the operator's `calm_male.wav` in as the *new default* (mechanism makes it replaceable
  regardless) — ask before changing the shipped default.
- Build + release ritual deferred to operator sign-off (beta.10 pattern).
