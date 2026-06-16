# Ghost Intel 98 — v3.14.0-beta.12 (BETA)

> ⚠️ BETA — for functional testing.

## What's new

### Renamed: Ghost Intel 98
The application has been renamed to **Ghost Intel 98**. This is a product-identity change only — no
feature changes from beta.11.

- New display name, window title, splash/lock/welcome screens, installer, and Start-menu shortcut.
- New app identity (`com.ghostintel.ghostintel98`); the installer is **`GhostIntel98-Setup-…exe`**.
- **Your data carries forward automatically.** On first launch the app migrates your existing data
  directory to the new location, so all cases, settings, sticky notes, and the encrypted vault are
  preserved. (The old directory is left untouched as a safety net.)

Because the app identity changed, this installs **alongside** the previous build rather than upgrading
it in place — your data still migrates over. You can uninstall the old entry once you've confirmed the
new one works.

Everything else is identical to beta.11 (GeoINT globe polish + space background, EyeSpy fit-to-screen /
YouTube feeds / fixed Add-new-feed, Mail Reply + in-app chime + user-replaceable chime).

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.12.exe -Algorithm SHA256
```

SHA-256: `756d1a7636a5fd039dcf8ed8e99c1a304102018dd5705ada428fdbd0b31dd4eb`
Size: 532,510,128 bytes (507.8 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- 1064 tests green; typecheck clean.
