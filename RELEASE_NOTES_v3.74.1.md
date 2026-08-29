# Ghost Intel 98 — v3.74.1

**Hotfix: GeoINT crashing on open with "Style is not done loading".**

Install this one over v3.74.0. GeoINT was unusable and I broke it.

## What happened

In v3.73.0 I changed how GeoINT draws events. They used to be one HTML element per event, which was costing you CPU; they're now drawn by the graphics card, which is much faster and lets the map show far more of them.

The old way could be set up at any moment. The new way can only be set up *after* the map has finished loading its style — and I didn't wait for that. So on opening GeoINT, the map sometimes wasn't ready yet, the setup threw an error, and the whole module fell over into its error screen.

**And why Reset didn't rescue it:** that setup ran every time, even when there were no events to draw. So purging the cache and tiles changed nothing — the next open failed in exactly the same place. A crash that survives its own recovery button is worse than the crash, and that one's on me.

## Fixed

The map is now only touched once it's ready, and the events are re-applied automatically when it finishes loading — and again whenever the basemap or the tile setting changes, which also wipes the map's layers. If the map ever refuses the call, the events wait for the next opportunity instead of taking the module down.

That last part matters beyond this bug: GeoINT should not be able to crash out of a map hiccup at all.

There's a footnote worth saying plainly — this is the same class of failure that was hotfixed for the satellite layer back in v3.17.1, and that layer has guarded against it ever since. I put the events in without the same guard. The four tests now covering it all fail against v3.74.0, so it can't come back quietly.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.74.1.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `8c1b514f1f99557a10c6fe9048be8fc7081137b4c11e9fd140b7c4b72bbead20`
- **Size:** `945,016,554 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.74.1**.

> If GeoINT still shows the error screen after installing, hit **Reset GeoINT (purge cache + tiles) & reload** once — it will actually work now — and if it doesn't, send me the error details panel again. That stack trace is what pinned this in one look.
