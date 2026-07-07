# Ghost Intel 98 — Host Info clearnet resolve + settings-sync fix — Design

**Date:** 2026-07-07
**Status:** Approved for planning (pending spec review)
**Author:** Obsidian Circuit (from GhostExodus field report — GeoINT CCTV / host resolution)

## Overview

GhostExodus hit confusion and a real bug while trying to view Tor-blocked South
Korea CCTV cameras. A four-agent code trace found three distinct things:

1. **UX/guidance confusion (no code bug):** CCTV *stream playback* and host
   *resolution* are separate subsystems with opposite defaults. `geoint.cctvOverTor`
   (default OFF) already routes camera streams over **clearnet** when off — that is
   the fix for Tor-blocked cameras, and it works today. `geoint.cctvResolveHosts`
   (default ON) governs the Tor-only DoH/RDAP recon. The operator pointed GhostExodus
   at the Q web-search clearnet toggle (`ai.webSearchClearnet`), which is unrelated.
2. **A real state bug:** the "resolved a host but says Host Resolution is turned off"
   contradiction — the renderer message keys off a stale cached setting while the
   resolver reads the fresh on-disk value; there is no main→renderer settings sync.
3. **A deliberately-unimplemented feature:** host resolution has no clearnet mode.

Operator decisions (2026-07-07): **add an opt-in clearnet host-resolution mode**
(off by default, explicit real-IP warning — same safety bar as the web-search
clearnet fallback), and take the **full fix** for the state bug (authoritative-result
message + auto-run gap + clearer copy + a `settings:changed` push + kill the
whole-block clobber).

Target release: **v3.35.0** (adds a user-facing opt-in feature).

## Global Constraints

- **Charter — clearnet egress is opt-in, off by default, warned.** The new clearnet
  resolve path must mirror the web-search clearnet contract: a setting that defaults
  **false**, a one-time explicit real-IP-exposure acknowledgement before the first
  clearnet lookup, and a persistent in-panel indicator whenever a lookup used
  clearnet. The Tor-only path stays the default and is never silently bypassed.
- **The `resolve-disabled` and Tor-only invariants stay intact for the default.** When
  clearnet resolve is OFF, behavior is exactly today's: Tor-only, fail-closed, no
  clearnet lookup. Nothing about the default egress posture changes.
- **No telemetry.** Settings-sync broadcasts settings to the app's own renderer only
  (loopback IPC); nothing leaves the machine.
- **Determinism / house style** preserved. Commit author `onna-bugeisha-dev-team
  <dev@onna-bugeisha.org>`, no AI trailers, `--no-verify`
  with `-c` overrides, explicit-path adds, never stage the known-dirty files.
- **Version → 3.35.0.** Update README, `RELEASE_NOTES_v3.35.0.md`, profile README (6 spots).

---

## Workstream 1 — Fix the "resolved but says off" contradiction

**Goal.** The Host Info panel's "turned off" message must reflect what the resolver
*actually did*, not a possibly-stale cached setting.

**Current state (root cause).** `HostInfoView.tsx:11,25` drives the message off
`useSettings(s => s.settings?.geoint.cctvResolveHosts ?? true)` — a renderer cache
hydrated once at boot (`App.tsx` `loadSettings()`) with no refresh channel. The main
resolver reads the fresh on-disk value every call (`register.ts:1696` →
`settingsStore.read()`), and the gate returns `errors:['resolve-disabled']` when off
(`gate.ts:30-39`) *without resolving*. So the two can diverge: main resolves, renderer
still shows "off." The renderer also never handles the `resolve-disabled` marker
(`gate.ts:36` produces it, no renderer reference), and would render it as the
confusing "Couldn't fully resolve via Tor (resolve-disabled)." (`HostInfoView.tsx:38`).

**Design.**
- Drive the "turned off" message off the **authoritative result**: after a run, if
  `info?.errors.includes('resolve-disabled')`, show "Host resolution is turned off in
  Settings → GeoINT." The cached setting is used only as a *pre-run hint* (before any
  `info` exists), so a stale cache can never contradict a completed resolve.
- Remove `resolve-disabled` from the generic "Couldn't fully resolve via Tor (…)" error
  join so it never surfaces as a Tor failure.
- **Auto-run gap:** `<details open={defaultOpen}>` does not fire `onToggle` on mount, so
  the standalone Host Info (`HostInfoModule` mounts with `defaultOpen`) may never
  resolve until the user manually collapses/expands. Add a mount `useEffect` that runs
  the lookup when `defaultOpen && !opened` (letting main be authoritative on the gate),
  mirroring the existing `onToggle` guard.

**Tests.** `test/hostinfo-view.test.tsx` (jsdom) — when the resolve result carries
`resolve-disabled`, the panel shows the "turned off" message even if the cached
setting reads `true` (the divergence case); a normal result shows the data and never
the "turned off" or the "(resolve-disabled)" text; `defaultOpen` triggers a lookup on
mount.

---

## Workstream 2 — Settings sync: kill the renderer/main divergence

**Goal.** The renderer's settings cache must not silently lag the authoritative
on-disk value, and partial writes must not clobber fresh disk state from a stale cache.

**Current state.** No `settings:changed` channel exists (`ipc-contracts.ts` settings
surface is `read`/`update`/`pickWallpaper` only). Main-side `settingsStore.update()`
calls (`register.ts:1166,1171,1674,1915`, `local-ai.ts:125`) mutate disk without
telling the renderer. `patchGeo` (`GeoIntModule.tsx:471`) and `patchNews`
(`NewsFeedControls.tsx:80-93`) re-send the **entire** reconstructed `geoint` block from
the possibly-stale cache, so an unrelated tile/news write can persist a stale
`cctvResolveHosts`/`cctvOverTor` back to disk.

**Design.**
- **`settings:changed` push.** Add a main→renderer broadcast: after any
  `settingsStore.update()`/`save`, `webContents.send('settings:changed', merged)` to
  all windows. Renderer subscribes in the settings store (`state/store.ts`) and
  replaces its cached `settings` with the pushed value. Add the channel to
  `ipc-contracts.ts` + a preload `onSettingsChanged(cb)` binding + `api.d.ts`. This
  makes the renderer cache eventually-authoritative and removes the divergence class.
- **Stop the whole-block clobber.** Change `patchGeo`/`patchNews` to send only the
  specific changed sub-field(s) rather than the reconstructed full `geoint` block, so a
  partial write can't overwrite fields it didn't touch. Verify `settingsStore.update`
  deep-merges an incoming partial `geoint` onto the current on-disk block (it must, for
  a partial patch to be safe — confirm in the plan; if it shallow-replaces, the
  `settings:changed` sync alone keeps the cache fresh enough that the reconstructed
  block is accurate, and the partial-send becomes an additional guard).

**Tests.** `test/settings-sync.test.ts` — a `settings:changed` payload updates the
renderer store cache; `test/geoint-patch-partial.test.tsx` — `patchGeo` toggling
`cctvOverTor` sends a patch that does NOT include a `cctvResolveHosts` value it might
clobber (or sends only the changed key). Assert the divergence scenario from WS1 can no
longer arise: after a main-side change + `settings:changed`, the renderer cache matches.

---

## Workstream 3 — Opt-in clearnet host resolution

**Goal.** Let the operator enable clearnet DoH/RDAP resolution when they accept the
real-IP exposure — off by default, warned, clearly indicated.

**Current state.** `resolve.ts` is fetch-injected (`resolveHost(streamUrl, {fetchJson,
now})`), always wired to `torFetchJson` (`index.ts:58`). The gate (`gate.ts`) only
knows a boolean `resolveEnabled()`. There is no clearnet fetch path.

**Design.**
- **New setting** `geoint.cctvResolveClearnet: boolean` (default **false**) in
  `types.ts` geoint block + default. Plus `geoint.cctvResolveClearnetAck: boolean`
  (default false) for the one-time acknowledgement (mirror `ai.linkClearnetAcknowledged`).
- **Clearnet fetch** `clearnetFetchJson(url)` in `hostinfo/index.ts` — a plain
  `fetch`/https GET (no Tor SOCKS), same JSON contract as `torFetchJson`, throwing on
  non-200/blocked. It is only ever selected when the setting is on.
- **Gate extension.** `resolveHostInfoGated` gains the resolve mode. When
  `cctvResolveHosts` is off → `resolve-disabled` as today. When on: if
  `cctvResolveClearnet` is off → inject `torFetchJson` (today's Tor-only path);
  if on → inject `clearnetFetchJson`, and tag the result so the UI can show it used
  clearnet (e.g. an `errors`/`via` marker `resolved-via-clearnet`, non-error, or a
  dedicated `HostInfo.via: 'tor' | 'clearnet'` field). The service/facade passes the
  chosen fetch down; `resolve.ts` stays fetch-agnostic.
- **Mode:** clearnet resolve is a direct opt-in (when on, resolution uses clearnet),
  not a silent fallback — the user explicitly chose clearnet, matching the web-search
  `mode:'first'` posture. (A Tor-first-then-clearnet fallback is deliberately NOT the
  default behavior; keep it simple and explicit. If the operator later wants a fallback
  mode, it's an additive enum — out of scope here.)
- **UI:**
  - Settings → GeoINT: a new checkbox "Resolve camera hosts over CLEARNET (⚠ exposes
    your real IP to DoH/RDAP and reveals which hosts you probe — off by default)",
    disabled unless `cctvResolveHosts` is on. First enable pops the one-time ack
    modal (reuse the web-search/link ack pattern); `cctvResolveClearnetAck` records it.
  - Host Info panel: when a lookup used clearnet, show a persistent inline warning
    ("resolved over CLEARNET — real IP exposed") alongside the result, so it's never
    silent.

**Tests.** `test/hostinfo-gate-clearnet.test.ts` — gate injects `torFetchJson` when
`cctvResolveClearnet` off, `clearnetFetchJson` when on, and still returns
`resolve-disabled` (never touching either fetch) when `cctvResolveHosts` off;
`test/hostinfo-clearnet-marker.test.tsx` — a clearnet result renders the real-IP
warning; a Tor result does not. Settings render/ack test for the new checkbox + gating.

---

## Workstream 4 — Clarify the two-toggle UX

**Goal.** Users should not conflate stream-Tor with resolution-Tor (the confusion that
started this).

**Design (copy only, no logic).**
- Settings → GeoINT: tighten the two labels so the split is obvious — `cctvOverTor`:
  "Route camera **streams** through Tor (off = streams load over clearnet — use this
  for cameras that block Tor)"; `cctvResolveHosts`: "Resolve camera **hosts** (recon:
  IP/PTR/RDAP) — Tor-only unless clearnet resolve is enabled below."
- Optionally a one-line hint in the GeoINT CCTV area pointing at the stream toggle when
  a stream fails to load with `cctvOverTor` on. (Keep minimal; YAGNI beyond the labels.)

**Tests.** Covered by the settings render test (labels present); no logic tests.

---

## Cross-cutting

- **Sequencing.** WS1 (message-off-result) and WS2 (settings-sync) are complementary —
  both reduce the divergence; do WS2's `settings:changed` first so WS1's cache-hint is
  reliable, but they're independently testable. WS3 depends on the gate/service shape;
  WS4 is copy-only.
- **IPC added:** `settings:changed` (main→renderer push) only. Host resolution reuses
  the existing `hostinfo` resolve channel (the gate chooses the fetch internally).
- **Settings added:** `geoint.cctvResolveClearnet`, `geoint.cctvResolveClearnetAck`
  (both in the already-deep-merged `geoint` block → merge-survival test).

## Verification

- `pnpm typecheck` (both configs) + full `pnpm test` green incl. the new suites.
- Build Windows installer; grep packaged `app.asar` for `cctvResolveClearnet`,
  `settings:changed`, `resolved-via-clearnet`/the clearnet marker, `clearnetFetchJson`.
- **Charter re-check:** with `cctvResolveClearnet` OFF (default), a netns/no-egress
  style check confirms host resolution still egresses ONLY over Tor (no clearnet
  socket). With it ON, the clearnet DoH/RDAP path is the only new egress, it is
  ack-gated, and the panel shows the real-IP warning.
- Windows smoke (operator-gated): turn `cctvOverTor` off → South Korea cameras load;
  the "resolved but says off" contradiction is gone; enabling clearnet resolve shows
  the ack + the in-panel real-IP warning; a setting changed in one surface reflects in
  another without a restart.

## Out of scope (YAGNI)

- A Tor-first-then-clearnet *fallback* mode for resolution (explicit opt-in only for now).
- Broadening clearnet egress to any other tool.
- Reworking the whole settings store beyond the `settings:changed` push + partial patches.
