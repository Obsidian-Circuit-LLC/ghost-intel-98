# Ghost Intel 98 — v3.14.0-beta.18 (BETA)

> ⚠️ BETA — for functional testing.

## Fixes

### "You've got mail" chime — root cause found and fixed
The default chime shipped since beta.12 was a **192 kHz WAVE_FORMAT_EXTENSIBLE** file, which the
renderer's audio element couldn't load — so the chime was silent **everywhere** (the Settings test
button *and* real new mail). It's now re-encoded to standard **44.1 kHz 16-bit PCM** (same voice).

- Installs that already saved the old broken default are **repaired automatically** on launch (only an
  unmodified default is replaced — a chime you set yourself is never touched).
- To hear it on new mail: keep **Settings → Sound → Enable sounds** on, and turn on **Settings → Mail
  → "Check for new mail in the background"** (added in beta.17) so it fires even with the Mail window
  closed. The Settings → Sound **Test "You've got mail" chime** button should now play.

### GeoINT command rail no longer clipped by the scrollbar
The Win98 scrollbar draws over the rail's right padding, so its right-edge controls (stream ✕, the HLS
dropdown, Add stream) were hidden. The rail now pads the right enough to clear the scrollbar.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.18.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: __SIZE__

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- 1064 tests green; typecheck clean.
