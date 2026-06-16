# Ghost Intel 98 — v3.14.0-beta.17 (BETA)

> ⚠️ BETA — for functional testing.

## Fixes

- **Boot splash** — the scrolling loading bar was sitting on top of the "Intelligence Workstation"
  subtitle. It now drops into the dark band below the text.
- **GeoINT command rail** — the right-hand command rail's controls (stream ✕, the HLS dropdown, Add
  stream) were being hidden under the scrollbar. The rail now reserves the scrollbar's space.
- **"You've got mail" chime now actually works on new mail.** The background mail checker existed but
  there was **no switch to turn it on**, so the chime never fired when the Mail window was closed.
  There's now a **Settings → Mail → "Check for new mail in the background"** toggle. Turn it on (and
  keep **Sound → Enable sounds** on) and Ghost Intel 98 will chime + toast when new mail arrives, even
  with the Mail window closed.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.17.exe -Algorithm SHA256
```

SHA-256: `dc4783923dc30566c1c3094a34feba816aaed5e271d9711e1847b169e10cba35`
Size: 533058938 bytes (508.4 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- 1064 tests green; typecheck clean.
