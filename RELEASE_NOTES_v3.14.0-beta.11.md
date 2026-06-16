# Dead Cyber Society 98 — v3.14.0-beta.11 (BETA)

> ⚠️ BETA — for functional testing. Field-feedback batch from dogfooding beta.10: GeoINT globe
> polish, EyeSpy fit/YouTube/add-feed fixes, and a Mail chime that finally fires from the app
> (and is now yours to swap out).

## What's new

### GeoINT — globe polish
- **Outer-space background** behind the 3D globe — a starfield + faint nebula, fully offline (no
  asset, no network). The in-sphere dark is unchanged.
- **Map popups restyled** to a translucent-dark card with white text; the close ✕ no longer overlaps
  the title.
- **Responsive layout** — the 3-column command-center no longer clips the left controls on a window
  that isn't maximized.

### EyeSpy — CCTV wall
- **Fit-to-screen** — camera tiles and the double-click expanded view now fill the frame (centered,
  contained) instead of letterboxing in the top-left, at any column count.
- **YouTube camera feeds** — add a YouTube live/video URL as a camera (sandboxed youtube-nocookie
  embed; host-checked so a spoofed host can't be framed).
- **"Add new feed" fixed** — the wall's add tile now places the new feed onto the wall (the slot you
  clicked, or appended) and selects it, instead of targeting the last-selected slot.

### Mail
- **Reply** — the message toolbar finally has a Reply button (alongside Forward): seeds a compose to
  the sender with a `Re:` subject and the original quoted.
- **The chime fires from inside the app** on new mail again (it was being silenced whenever the
  background poller was on). De-duped so one email won't double-chime.
- **Your chime, your jingle** — the "You've got mail" sound is now user-replaceable. **Settings →
  Sound → Change chime (open sounds folder)** opens a folder; drop in your own `.wav` (same filename)
  and it takes effect on the next mail. Default chime refreshed.

### Confirmed working (no change)
- DialTerm local shell — reported working 100% in beta.10.

## Verify the download (unsigned)

```powershell
Get-FileHash .\DCS98-Setup-3.14.0-beta.11.exe -Algorithm SHA256
```

SHA-256: `343eac5a1dedc29beb0b9fdcf4ee5c884aeedf1238a114f45aae586a7fcf2060`
Size: 533,046,457 bytes (508.4 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- The globe space background is confirmed rendering correctly on the build.
- Code hygiene on `main` after this build: the now-dead Leaflet map fallback (`MapPane` + the
  `leaflet` dependency) was removed — the 3D globe has been the only map since beta.10, so this is a
  no-op for the installer's behaviour.
- 1064 tests green; typecheck clean.
