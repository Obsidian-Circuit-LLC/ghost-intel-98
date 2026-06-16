# Ghost Intel 98 — v3.14.0-beta.13 (BETA)

> ⚠️ BETA — for functional testing.

## What's new

### New brand art
- **New app icon** — the framed "Ghost Intel 98 · Intelligence Workstation" hooded-operator mark
  (window icon, installer/Start-menu icon, and the in-app Start-button icon).
- **New logo** — the full Ghost Intel 98 window-art logo (Settings → About, Welcome, Help, DialTerm,
  Access menu).

No code/feature changes from beta.12 (the Ghost Intel 98 rename). Icons/logo only.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.13.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: `__SIZE__`

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- The boot splash screen still carries the prior art (it's a separate wide 1280×853 asset). Send a
  splash image if you want it refreshed to match.
- 1064 tests green; typecheck clean.
