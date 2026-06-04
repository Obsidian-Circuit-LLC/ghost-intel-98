# Dead Cyber Society 98 — v3.6.1

A small follow-up to v3.6.0: a **Briefcase** for loose notes, **street-name labels** and a tile
**Reset** in GeoINT, and a desktop tidy-up that pins **Shred to the bottom-right** like the classic
Recycle Bin.

## What's new

- **Briefcase (new app).** A home for standalone text notes that aren't tied to any case. Open the
  **Briefcase** app to browse/edit/delete them, or — in **Notepad 98** — pick **💼 Briefcase** in the
  case selector and your note saves straight there. Encrypted at rest like everything else; zero network.
- **GeoINT — street-name labels.** A new **Labels** toggle overlays street and place names on the map.
  It's off by default (the 2D map already labels); the win is on **Satellite**, which otherwise shows no
  names. Labels come from Esri's reference layers on the same host the satellite view already uses — no
  new outside connection.
- **GeoINT — tile Reset + visible default.** A **Reset** button restores the default OpenStreetMap tiles
  in one click, and the Tiles box now shows that default URL as its placeholder — so you can never get
  stuck after editing it away.
- **Desktop — Shred in the corner.** Shred now sits in the **bottom-right** like the Recycle Bin, and the
  Briefcase icon joins the left column.

## Security

The additions went through an adversarial red-team pass. The Briefcase store mirrors the AI-conversation
store reviewed in v3.6.0 (serialized writes, validated + length-bounded input, encrypted at rest, no
network). The GeoINT label overlays are gated behind the same GeoINT network toggle as the basemap and
add **no new outbound domain** (same Esri host as the satellite view), so no CSP change was needed.

## Verification

- `typecheck` clean · **232 tests** (45 files) · production build OK · headless boot smoke clean.

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.1.exe` (124,449,833 bytes ≈ 119 MB, NSIS, x64, unsigned)
**SHA-256:** `bcaaecf2237cbebed222f1d76d15f64731384f6b6a4e8248eeeb4542e18132ac`
