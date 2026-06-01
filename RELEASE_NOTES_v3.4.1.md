# Ghost Access 98 — v3.4.1

A focused fix release from the v3.4.0 field report: the Jukebox transport now works like a
proper tape deck, GeoINT no longer looks dead-on-arrival, and STFU stays responsive even when
the AI is dumping a huge wall of text.

## TL;DR

- **Jukebox transport rebuilt.** The four "wonky" buttons were Unicode media glyphs (`⏮ ▶ ⏹ ⏭`)
  that render as empty boxes on Windows builds lacking the symbol font. They're now crisp inline
  **SVG** icons that look the same everywhere, and the full tape-deck set is here:
  **Previous · Play/Pause · Stop · Next · Shuffle · Repeat**. Repeat cycles **off → all → one**
  (repeat-one shows a tiny "1"); Shuffle avoids replaying the current track and Previous walks
  back through the actual shuffle history. Sequencing logic is a pure, unit-tested module.
- **GeoINT stops looking dead.** Enabling "Allow GeoINT network" now drops in a default
  OpenStreetMap basemap so the map actually renders instead of staying a blank grey square
  (still **zero network until you tick that box** — the egress gate is unchanged; you can swap in
  any `{z}/{x}/{y}` tile server). Every previously-silent failure path — the snapshot load,
  enable/disable source, remove source, and map-pin — now surfaces the real error instead of
  doing nothing quietly.
- **STFU is responsive under heavy output.** Streaming replies are now flushed to the screen at
  a coalesced ~16 fps instead of re-rendering the whole growing transcript on every token, which
  is what starved the STFU click on very large outputs. The button registers immediately now,
  and a late flush can't overwrite the "[stopped]" marker.

## Why the buttons were wonky

They weren't styled badly — they were missing glyphs. The transport used the Unicode media
symbols, and your Windows build had no font covering them, so each drew the "tofu" not-defined
box (the four identical squares in your screenshot). Inline SVG removes the font dependency
entirely.

## Verification

- `typecheck` clean · **205/205 tests** (40 files; +11 new for the playlist-navigation logic)
- production build OK · headless xvfb boot smoke clean (no `uncaughtException`)

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.
- Built on the full v3.4.0 base (offline voice, Bookmarks, Firefox launcher, offline TTS, the
  v3.2.x modules, encrypt-at-rest).

---

**Artifact:** `GhostAccess98-Setup-3.4.1.exe` (~122 MB, NSIS, x64, unsigned)
**SHA-256:** `1ce28d48fc94ca594f414ace87e3b03f0f19f066b4a889c76912697d5fa51be3`
