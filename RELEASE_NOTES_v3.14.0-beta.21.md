# Ghost Intel 98 — v3.14.0-beta.21 (BETA)

> ⚠️ BETA — for functional testing.

EyeSpy bulk-import upgrade for GhostExodus's large categorized feed sets.

## New

### EyeSpy — import a nested Country → Region → City camera tree
The feed importer now understands a **nested geo-tree JSON**, the common "scraped-by-country" dump
shape:

```json
{ "United Kingdom": { "England": { "London": ["https://…/cam1.mp4", "https://…/cam2.mp4"] } } }
```

Every leaf URL is filed under the Country/State/City from its path (depth is flexible — 1–4+ levels),
so a whole multi-thousand-feed dump imports **fully categorized in one shot** instead of landing flat
and "Ungeocoded." Verified on a real 1,644-feed, 65-country list: 100% categorized by country + city.
Flat JSON arrays and header CSVs are unchanged.

### Documented import format
New **`docs/EYESPY_IMPORT_FORMAT.md`** spells out every accepted shape (flat JSON array of objects,
nested geo tree, header CSV, plain URL list), the field aliases, and the gotchas (CSV needs a header
and commas). The EyeSpy **Import…** button tooltip now points to it. For a fresh scrape, a flat JSON
array of `{url,label,country,region,city,lat,lon}` is the sweet spot — real names, full categorization,
and map pins.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.21.exe -Algorithm SHA256
```

SHA-256: `458ed585b4438d495088c7be4c637417550aca288adaf0de0571fd37d20fe1ca`
Size: 532742700 bytes (508.1 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- 1071 tests green; typecheck clean.
- To re-import an existing library cleanly, use **Purge all…** in EyeSpy first (import adds, de-duped
  by URL; it doesn't replace).
- Same `Ghost Intel 98` app id as beta.12+, so it upgrades in place. Uninstall any old
  **Dead Cyber Society 98** install alongside it to avoid testing a stale build.
- Everything from beta.20 carries forward.
