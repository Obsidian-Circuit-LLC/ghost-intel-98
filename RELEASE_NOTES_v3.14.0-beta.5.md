# Dead Cyber Society 98 — v3.14.0-beta.5 (BETA)

> ⚠️ **BETA — for functional testing.** Everything from v3.14.0-beta.4 carries forward (the EyeSpy finder +
> curated 3×3 wall). This build is a small, targeted **GeoINT map fix**. The stable channel remains the last
> non-beta line; the Tor P2P chat is still **pending external audit + FIPS build**.

## What's fixed

**GeoINT map — no more flashing box or drag catch.** Two reported glitches on the GeoINT map shared one
root cause:

- a **"ghost box" flashing in the centre** of the map, and
- a **hitch/"catch" when click-dragging** to pan.

The event list feeding the map was rebuilt as a fresh array on every render, so the map's marker layer
cleared and rebuilt itself on every pan frame, and the "recenter on the focused event" step lived inside
that rebuild — which fired a recenter → re-render → rebuild → recenter **loop**. That loop re-opened the
focused event's popup over and over at the recentered (centre) spot (the flashing box) and yanked the map
mid-drag (the catch).

The fix memoizes the event list so a pan no longer rebuilds the markers, and moves the recenter into its
own step that only runs when the focused event actually changes — breaking the loop. **No change** to
GeoINT's data, sources, or network gate; this is purely render wiring. Panning is now smooth and the
centre stays clean.

## How to test (in-house)

1. Install on Windows (**More info → Run anyway** — unsigned; verify the SHA-256 below first).
2. **GeoINT:** open GeoINT with the network on and a tile server set, focus an event from the list, then
   **click-drag to pan** — confirm there's no flashing box in the centre and the pan is smooth (no catch).
3. Re-confirm beta.4 items (EyeSpy finder + wall; the app launches; chat invite-accept; Piper clean).

## Known limitations

- **Windows x64 only**, **unsigned** — SmartScreen will warn.
- Tor P2P chat crypto is formally modeled but **external audit + FIPS build are still pending**.
- Long video files attached to **encrypted** cases still buffer fully before playing; unencrypted stream fine.

## Verification

`typecheck` clean · **712 automated tests** green (the GeoINT egress/popup suites included; this fix is
render-wiring, so it adds no new unit tests — the map behaviour is confirmed by **your** interactive run,
not CI). `pnpm build` succeeds.

---

**Artifact:** `DCS98-Setup-3.14.0-beta.5.exe` (ARTIFACT_BYTES bytes ≈ ARTIFACT_MB MB, NSIS, x64, unsigned; Tor + Piper + offline AI models bundled)
**SHA-256:** `ARTIFACT_SHA256`
