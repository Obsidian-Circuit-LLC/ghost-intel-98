# Ghost Intel 98 — v3.14.4

**EyeSpy import fix: `stream_url` key + nested coordinates.** A bug fix so coordinate-bearing CCTV
scrapes import natively. Main-process parser change only — no UI, IPC, crypto, or data-format change;
the Win98 look is untouched.

## The problem

Catalogued CCTV lists in the common "scraped-by-country" dump shape — `Country → Region → City →
[cameras]`, where each camera is `{ "stream_url": "…", "coordinates": { "latitude": …, "longitude": … } }`
— imported **zero** cameras. The importer recognized the stream URL only under `url`/`URL`/`src`/`stream`
(not `stream_url`), so every leaf was dropped before it could be filed under the location tree. And
coordinates living in a nested `coordinates` block were never read, so even a fixed URL would carry no
map location.

## What changed

- **`stream_url` is now an accepted URL key**, alongside `url` / `URL` / `src` / `stream`.
- **Coordinates are read from a nested `coordinates` object** (`{ latitude, longitude }`) as a
  fallback. Flat top-level `lat`/`lon` still win when both are present.

Both apply to all JSON shapes (flat array, single object, and the nested geo tree).

## Why it matters

Beyond fixing import, this lands the latitude/longitude into the stream store — the prerequisite for
the upcoming **CCTV-pins-on-the-GeoINT-map** feature, which reads those coordinates to drop camera
pins.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.4.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: __SIZE__ bytes (__SIZE_MB__)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin) and
upgrades any prior `Ghost Intel 98` build in place.

## Notes
- TDD'd against the exact scrape shape; verified end-to-end against real files (0 → 2,555 cameras,
  2,469 with coordinates). 1076 tests green; typecheck clean.
- Parser change in `src/main/services/feed-import.ts`; `docs/EYESPY_IMPORT_FORMAT.md` updated.
- Same `Ghost Intel 98` app id, so it upgrades in place.
- Everything from v3.14.0 (first stable line) carries forward.
