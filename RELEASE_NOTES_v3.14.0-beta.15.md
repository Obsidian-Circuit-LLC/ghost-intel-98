# Ghost Intel 98 — v3.14.0-beta.15 (BETA)

> ⚠️ BETA — for functional testing.

## What's new
- **Boot splash caption shortened** to "Starting…" — the splash art already shows the Ghost Intel 98
  name at center, so the loader caption no longer repeats it.

Otherwise identical to beta.14.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.15.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: __SIZE__

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- 1064 tests green; typecheck clean.
