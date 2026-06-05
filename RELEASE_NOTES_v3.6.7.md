# Dead Cyber Society 98 — v3.6.7

**A real in-app exit, and a roomier GeoINT menu.**

## What's new

- **Shut Down (in-app exit).** The Access (Start) menu now has a **Shut Down…** entry at the bottom
  (with a "Close Dead Cyber Society 98?" confirm). Until now the only way out was the native
  title-bar **X** — and a Win98-style shell trains you to reach for **Start → Shut Down**, so there
  was effectively no discoverable way to quit from inside the app. Shut Down quits cleanly through a
  new `system:quit` IPC → `app.quit()`, which runs the existing pre-quit cleanup (drains SSH
  sessions, cancels in-flight AI streams) rather than hard-killing the process.
- **Roomier GeoINT menu.** The GeoINT left column was a touch too narrow — the View row
  (2D Map / Satellite / Street View / Labels) and longer event titles were clipping. Widened the
  track 340px → 380px so the controls get breathing room without eating much of the map.

## Details

- The main window still uses the native OS frame, so the title-bar controls remain — Shut Down is an
  additional, discoverable exit, not a replacement.
- The quit path is plumbed end-to-end through the typed IPC contract
  (`ipc-contracts` → preload → main handler), so the renderer can't reach `app.quit()` by any path
  other than the allowlisted channel.

## Verification

- `typecheck` clean · build clean · **254 tests** still pass (this is a UI + IPC change; the
  project's renderer has no component-test harness, so the Shut Down entry was confirmed visually in
  the running app and the quit channel is typechecked across all three layers).
- The widened GeoINT track is a CSS-only change to the existing left-column grid.

## Notes

- No new network egress; no change to encryption-at-rest or the no-cloud guarantees.
- **Unsigned** build — SmartScreen will warn; **More info -> Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.7.exe` (124,480,955 bytes ≈ 119 MB, NSIS, x64, unsigned)
**SHA-256:** `58464fcd10bb1bf66d24b55851191b55f3d36f8fb162070bbe59de12cb32026f`
