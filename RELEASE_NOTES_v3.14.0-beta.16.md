# Ghost Intel 98 — v3.14.0-beta.16 (BETA)

> ⚠️ BETA — for functional testing.

## What's new

### Copyright-safe brand art
All theme images have been redrawn to use the custom **Ghost Intel 98 "G" hexagon** mark instead of
the Microsoft Windows flag (to avoid a potential trademark issue):

- **Default wallpaper**
- **Boot splash** — and the **login/lock screen** now shares this same "Welcome" splash as its backdrop
- **App logo** (About / Welcome / Help / DialTerm / Access menu)
- **App icon** (window, installer, Start-button — `.ico` 16→256)

No code/feature changes beyond wiring the lock screen to the splash backdrop.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.16.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: __SIZE__

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- 1064 tests green; typecheck clean.
