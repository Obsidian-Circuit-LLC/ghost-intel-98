# Ghost Intel 98 — v3.16.3

**Field-fix polish.** Three cosmetic fixes from the field: the assistant stops voicing markdown
markers, the GeoINT map popup ✕ finally shrinks clear of the coordinate readout, and RTFM gains a
bug-report contact. Renderer + CSS only; no crypto/data/protocol/egress change.

## What's new

### Assistant stops reading markdown aloud
- The offline Piper / character voices no longer narrate formatting markers (`**`, `*`, `` ` ``,
  `#`, `-`). The spoken text now runs through the **same in-house markdown stripper the on-screen
  renderer uses**, so what you hear matches what you see.
- Pure, deterministic transform applied at both speak paths (streamed reply + voice conversation);
  it reuses the existing `parseMarkdown` AST, so there is no second markdown dialect to drift.

### GeoINT map popup ✕ — the one that wouldn't shrink
- The map pin/popup close button kept overlapping the coordinate readout despite the v3.15.0 and
  v3.16.0 sizing passes. **Root cause:** the dark-card + small-✕ styling was scoped to
  `.ga98-geo-right`, a selector that never actually matched the popup MapLibre injects into the map
  container — so MapLibre's **default white popup with the oversized ✕ at the corner** rendered
  instead, sitting on the text.
- Fix: the popup styling is now scoped **globally to MapLibre's own classes** (GeoINT is the only
  MapLibre surface in the app, so there is no collateral), which cannot miss the popup. The ✕ is a
  tight 12 px square with a 10 px glyph and a reserved content gutter, so the coordinate text always
  clears it.

### RTFM bug-report contact
- The RTFM (Manual) pane gains a **"Found a bug?"** line with a contact address. The link routes
  through the existing external-URL validator, which already permits `mailto:` and strips any query
  parameters — no egress-policy change.

## Safety / scope
- **No crypto, data-model, protocol, CSP, or egress change.** Renderer + CSS only.
- No new dependency, no new network path, no telemetry.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.16.3.exe -Algorithm SHA256
```

SHA-256: _pending — filled in the follow-up `release: v3.16.3 installer SHA-256 + size` commit once
the Windows installer is built._
Size: _pending (≈837 MB, unchanged from v3.16.2 — no new bundled assets)._

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin)
and upgrades any prior `Ghost Intel 98` build in place.

## Notes
- The markdown stripper is unit-tested (9 new cases: marker stripping, nested emphasis, bullets,
  unmatched-asterisk literal, determinism). **1207 automated tests** green, typecheck clean,
  `electron-vite build` clean.
- Same `Ghost Intel 98` app id — upgrades in place.
- Everything from v3.16.2 carries forward.
