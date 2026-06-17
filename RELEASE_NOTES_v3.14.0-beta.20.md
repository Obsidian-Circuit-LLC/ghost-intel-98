# Ghost Intel 98 — v3.14.0-beta.20 (BETA)

> ⚠️ BETA — for functional testing.

Small follow-up to beta.19: a EyeSpy right-click-menu fix from GhostExodus's field test.

## Fix

### EyeSpy — feed right-click menu stays on-screen
Right-clicking a camera feed low in the (long) left-hand list opened the context menu downward from
the cursor, pushing its bottom items — **Set location…** and **Delete** — below the window edge where
they couldn't be reached. The menu now clamps fully into the window (the standard flip up/left), so
every option is reachable no matter where you right-click.

(The Edit-feed → Delete path still works too.)

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.20.exe -Algorithm SHA256
```

SHA-256: `20f9141d4fafa30fc058fd7a8b6d68741e99e3c7eb63b39d7f32172cfb6645ee`
Size: 532741988 bytes (508.1 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- 1065 tests green; typecheck clean.
- Same `Ghost Intel 98` app id as beta.12+, so it upgrades in place. If you still have the old
  **Dead Cyber Society 98** install alongside it, uninstall that to avoid testing a stale build.
- Everything from beta.19 carries forward (GeoINT layout/popups, EyeSpy add-feed, Mail copy/paste).
