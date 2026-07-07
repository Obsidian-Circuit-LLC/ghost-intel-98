# Host Info Clearnet Resolve + Settings-Sync Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "resolved a host but says Host Resolution is off" contradiction, stop the renderer settings cache from lagging main, and add an opt-in clearnet host-resolution mode (off by default, warned) — from GhostExodus's GeoINT/CCTV field report.

**Architecture:** Renderer + main. The state bug is fixed by driving the Host Info message off the resolver's actual result and by adding a `settings:changed` main→renderer push. The clearnet feature is a fetch swap the resolve handler chooses from a new opt-in setting; `resolve.ts` is already fetch-injected.

**Tech Stack:** Electron 33 + React 18 + TypeScript, zustand, 98.css, vitest/jsdom.

## Global Constraints

- **Charter — clearnet egress opt-in, off by default, warned.** `geoint.cctvResolveClearnet` defaults **false**; first enable requires an explicit real-IP-exposure acknowledgement; whenever a lookup uses clearnet the panel shows a persistent "resolved over CLEARNET — real IP exposed" indicator. The Tor-only default path is unchanged and never silently bypassed.
- **No telemetry.** `settings:changed` is a loopback main→renderer push of the app's own settings; nothing egresses.
- **No `resolve-disabled` / Tor-only regression** when clearnet resolve is OFF (default): identical to today (Tor-only, fail-closed).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; NO AI trailers; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; explicit-path adds only; NEVER stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`.
- **Tests:** `pnpm test` (vitest), `pnpm typecheck` (both configs).
- **Version → 3.35.0.**

## File Structure

**Modified:**
- `src/renderer/modules/hostinfo/HostInfoView.tsx` (Task 1 message+auto-run; Task 6 clearnet warning)
- `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/renderer/state/store.ts`, `src/renderer/App.tsx`, `src/main/ipc/register.ts`, `src/main/services/local-ai.ts` (Task 2 settings:changed)
- `src/renderer/modules/geoint/GeoIntModule.tsx`, `src/renderer/modules/geoint/NewsFeedControls.tsx` (Task 3 partial patch)
- `src/shared/types.ts` (Task 4 settings)
- `src/main/services/hostinfo/index.ts`, `src/shared/post-mvp-types.ts`, `src/main/ipc/register.ts` (Task 5 clearnet fetch + via)
- `src/renderer/modules/settings/SettingsModule.tsx` (Task 6 checkbox+ack+labels)

**New:** `src/main/services/settings-notify.ts` (Task 2).
**Tests:** `test/hostinfo-view.test.tsx`, `test/settings-sync.test.ts`, `test/geoint-patch-partial.test.tsx`, `test/settings-clearnet-resolve-merge.test.ts`, `test/hostinfo-clearnet.test.ts`, `test/settings-clearnet-resolve-ui.test.tsx`.

**Sequencing:** Task 4 (settings fields) before Tasks 5 & 6. Otherwise independent; order 1→6.

---

### Task 1: Fix the "resolved but says off" contradiction + auto-run gap

**Files:** Modify `src/renderer/modules/hostinfo/HostInfoView.tsx`; Test `test/hostinfo-view.test.tsx`.

**Interfaces:** Consumes `useHostInfo(url)` → `{ info, loading, run }`; `HostInfo.errors: string[]` (may include `'resolve-disabled'`).

- [ ] **Step 1: Failing test** `test/hostinfo-view.test.tsx` (jsdom + @testing-library/react; mock `window.api.hostinfo.resolve` and `useSettings`). Cases:
  - Divergence: `useSettings` cache returns `cctvResolveHosts: true`, but `hostinfo.resolve` resolves to `{ host:'x', ips:[], errors:['resolve-disabled'], resolvedAt:'t' }` → after run, the panel shows "Host resolution is turned off in Settings → GeoINT." and NOT "Couldn't fully resolve via Tor (resolve-disabled)".
  - Normal: result with `ips:['1.2.3.4'], errors:[]` → shows the IP, no "turned off", no "(resolve-disabled)".
  - Auto-run: rendering with `defaultOpen` triggers `window.api.hostinfo.resolve` on mount (once).

- [ ] **Step 2: Run → FAIL** (`pnpm test hostinfo-view`).

- [ ] **Step 3: Implement.** In `HostInfoView.tsx`:
  - Compute `const resolveDisabled = info != null && info.errors.includes('resolve-disabled');`.
  - The "turned off" branch condition becomes: show it when `resolveDisabled` OR (no `info` yet AND `!resolveHosts` cached hint). I.e. drive it off the authoritative result once a result exists; use the cached `resolveHosts` only as a pre-run hint:
    ```tsx
    {(info ? resolveDisabled : !resolveHosts) ? (
      <div style={{ marginTop: 4, opacity: 0.8 }}>Host resolution is turned off in Settings → GeoINT.</div>
    ) : torNotReady ? ( ... ) : info ? ( ... ) : ( ... )}
    ```
  - In the `info` data branch, exclude `resolve-disabled` from the generic error join:
    ```tsx
    {info.errors.filter((e) => e !== 'resolve-disabled').length > 0 &&
      <div style={{ color: '#a33' }}>Couldn't fully resolve via Tor ({info.errors.filter((e) => e !== 'resolve-disabled').join(', ')}).</div>}
    ```
  - Auto-run on mount for `defaultOpen` (the `<details open>` case never fires `onToggle`): add
    ```tsx
    React.useEffect(() => {
      if (defaultOpen && !opened) { setOpened(true); run(); }
    }, [defaultOpen]); // eslint-disable-line react-hooks/exhaustive-deps
    ```
    (Let main be authoritative on the gate — do not condition the auto-run on the possibly-stale cached `resolveHosts`; a disabled result returns `resolve-disabled` and renders the "turned off" message via the branch above.)

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `fix(hostinfo): drive "resolution off" message off the actual result + auto-run on open`.

---

### Task 2: `settings:changed` main→renderer push

**Files:** Create `src/main/services/settings-notify.ts`; Modify `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/renderer/state/store.ts`, `src/renderer/App.tsx`, `src/main/ipc/register.ts`, `src/main/services/local-ai.ts`; Test `test/settings-sync.test.ts`.

**Interfaces:** Produces channel `settings:changed`; `notifySettingsChanged(next: AppSettings): void`; preload `window.api.settings.onChanged(cb): () => void`.

- [ ] **Step 1: Failing test** `test/settings-sync.test.ts` — unit-test the renderer store reaction: simulate an `onChanged` callback delivering a new `AppSettings` and assert `useSettings.getState().settings` equals it. (Mock `window.api.settings.onChanged` to capture the callback; call it; assert the store updated. Follow an existing store test's harness.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
  - `ipc-contracts.ts` settings block: add `changed: 'settings:changed'` alongside `read`/`update`/`pickWallpaper`.
  - `src/main/services/settings-notify.ts`:
    ```ts
    import type { AppSettings } from '../../shared/types';
    import { channels } from '../../shared/ipc-contracts';
    import { getWindow } from '<the same window accessor chat.ts imports>'; // grep: how chat.ts gets getWindow
    export function notifySettingsChanged(next: AppSettings): void {
      getWindow()?.webContents.send(channels.settings.changed, next);
    }
    ```
    (Grep `src/main/services/chat.ts` for its `getWindow` import and reuse the same accessor.)
  - `register.ts`: in the `settings.update` handler, after the store update, call `notifySettingsChanged(next)`. At each MAIN-side `settingsStore.update(...)` call site (register.ts:1166, 1171, 1674, 1915), capture the returned value and `notifySettingsChanged(it)`.
  - `local-ai.ts:125`: same — `notifySettingsChanged` after its `settingsStore.update`.
  - `preload/index.ts` settings block: `onChanged: (cb: (s: AppSettings) => void) => { const h = (_e: unknown, s: AppSettings) => cb(s); ipcRenderer.on(channels.settings.changed, h); return () => ipcRenderer.removeListener(channels.settings.changed, h); }`.
  - `api.d.ts`: add `onChanged(cb: (s: AppSettings) => void): () => void` to the settings interface.
  - `state/store.ts` `useSettings`: no structural change needed, but expose the setter usage; the subscription lives in `App.tsx`.
  - `App.tsx` (near line 42 `void loadSettings()`): register once — `useEffect(() => window.api.settings.onChanged((s) => useSettings.setState({ settings: s })), [])`. (Return the disposer for cleanup.)

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `fix(settings): push settings:changed to the renderer so its cache can't lag disk`.

---

### Task 3: Stop the whole-block clobber in patchGeo / patchNews

**Files:** Modify `src/renderer/modules/geoint/GeoIntModule.tsx`, `src/renderer/modules/geoint/NewsFeedControls.tsx`; Test `test/geoint-patch-partial.test.tsx`.

**Rationale:** `settingsStore.update` deep-merges (`mergeSettings(cur, patch)`, `geoint: {...cur.geoint, ...patch.geoint}`, json-fs.ts:915,935), so sending ONLY the changed sub-field is safe and cannot overwrite siblings — whereas re-sending the whole reconstructed block from a stale cache can.

- [ ] **Step 1: Failing test** `test/geoint-patch-partial.test.tsx` — render the control that toggles `cctvOverTor` (or invoke `patchGeo`); assert the `patch` payload's `geoint` object contains ONLY the changed key (e.g. `cctvOverTor`) and does NOT include `cctvResolveHosts`/`newsStreams` reconstructed from cache. Same for `NewsFeedControls` add/remove: the patch carries only `newsStreams`/`newsStreamIndex`, not the whole block.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In `GeoIntModule.tsx` `patchGeo` (line ~471) and `NewsFeedControls.tsx` `patchNews` (lines ~80-93): change each `patch({ geoint: { ...reconstructed-whole-block } })` to send only the field(s) that changed, e.g. `patch({ geoint: { cctvOverTor: value } })` / `patch({ geoint: { newsStreams, newsStreamIndex } })`. Do NOT spread the cached `g` block. (mergeSettings preserves the rest.)

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `fix(geoint): send partial settings patches so a stale cache can't clobber sibling fields`.

---

### Task 4: New clearnet-resolve settings

**Files:** Modify `src/shared/types.ts`; Test `test/settings-clearnet-resolve-merge.test.ts`.

**Interfaces:** Produces `geoint.cctvResolveClearnet: boolean` (default false), `geoint.cctvResolveClearnetAck: boolean` (default false).

- [ ] **Step 1: Failing test** `test/settings-clearnet-resolve-merge.test.ts` — `mergeSettings(defaultSettings, { geoint: { networkEnabled: true } } as any)` yields `geoint.cctvResolveClearnet === false` and `cctvResolveClearnetAck === false` (a partial/old geoint block does not drop the new fields — the geoint deep-merge fills them from defaults). Also: an on-disk block that omits them reads as the defaults.

- [ ] **Step 2: Run → FAIL** (fields don't exist).

- [ ] **Step 3: Implement.** In `types.ts` geoint interface (after `cctvResolveHosts`, line ~482):
  ```ts
  /** When true, CCTV *host resolution* is performed over CLEARNET instead of Tor — opt-in, off by
   *  default. Only consulted when cctvResolveHosts is on. A clearnet DoH/RDAP lookup exposes the
   *  operator's real IP to Cloudflare/rdap.org and reveals which cameras are being investigated;
   *  the UI requires an explicit acknowledgement (cctvResolveClearnetAck) before first enabling it
   *  and shows a persistent warning whenever a lookup used clearnet. */
  cctvResolveClearnet: boolean;
  /** One-time acknowledgement that clearnet resolution exposes the real IP (mirrors the link/web-search
   *  clearnet consent). Set true when the user confirms the warning; gates re-prompting. */
  cctvResolveClearnetAck: boolean;
  ```
  In `defaultSettings.geoint` (line ~696-697): add `cctvResolveClearnet: false, cctvResolveClearnetAck: false`. (No new `mergeSettings` line — the `geoint` block is already deep-merged at json-fs.ts:935.)

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(settings): cctvResolveClearnet opt-in + ack fields (off by default)`.

---

### Task 5: Clearnet fetch path + `via` marker

**Files:** Modify `src/main/services/hostinfo/index.ts`, `src/shared/post-mvp-types.ts`, `src/main/ipc/register.ts`; Test `test/hostinfo-clearnet.test.ts`.

**Interfaces:** Produces `clearnetFetchJson(url)`; `HostInfo.via?: 'tor' | 'clearnet'`; `hostInfoService.resolve(url, { force?, via? })`. Consumes Task 4 settings.

- [ ] **Step 1: Failing test** `test/hostinfo-clearnet.test.ts` (node) — using `makeHostInfoService` with an injected `resolveHost` spy: `resolve(url, { via:'clearnet' })` calls the resolver with the clearnet fetch and stamps `info.via === 'clearnet'`; `via:'tor'` (default) stamps `'tor'`. Also a `resolve.ts`-level test: injecting a fake `fetchJson` still returns the parsed info (via is set by the service, not the resolver). Do NOT make a real network call.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
  - `post-mvp-types.ts` `HostInfo` (line ~405): add `via?: 'tor' | 'clearnet';` (which egress path this result was resolved over; absent on cached/pre-existing/disabled results).
  - `index.ts`: add
    ```ts
    /** Clearnet JSON GET — the OPT-IN recon egress (settings.geoint.cctvResolveClearnet). Leaks the
     *  real IP by design; only selected when the user enabled + acknowledged clearnet resolution. */
    export async function clearnetFetchJson(url: string): Promise<unknown> {
      const resp = await fetch(url, { headers: { Accept: 'application/dns-json' } });
      if (!resp.ok) throw new Error(`hostinfo clearnet lookup ${resp.status}`);
      return resp.json();
    }
    ```
  - Change `makeHostInfoService` so `resolve(streamUrl, opts)` accepts `opts.via?: 'tor'|'clearnet'` (default `'tor'`), threads it to `deps.resolveHost(streamUrl, via)`, and stamps the result: `const info = { ...(await deps.resolveHost(host, via)) , via }` — but only stamp `via` on a freshly-resolved result, not a `resolve-disabled`/cache path. (Cache stores the stamped info; a `force` refresh re-resolves via the current setting.)
  - Update the `hostInfoService` singleton's `resolveHost` dep to pick the fetch by via: `resolveHost: (streamUrl, via) => resolveHostImpl(streamUrl, { fetchJson: via === 'clearnet' ? clearnetFetchJson : torFetchJson, now: () => new Date().toISOString() })`.
  - `register.ts` hostinfo handler (1692-1701): read settings once; pass via:
    ```ts
    const settings = await settingsStore.read();
    return resolveHostInfoGated({
      resolveEnabled: async () => hostResolveEnabledFrom(settings),
      resolve: (u, o) => hostInfoService.resolve(u, { ...o, via: settings.geoint.cctvResolveClearnet ? 'clearnet' : 'tor' }),
      hostOf: (u) => hostFromStreamUrl(u)?.host ?? '',
      now: () => new Date().toISOString()
    }, url, { force });
    ```
    (`gate.ts` is unchanged — via is threaded through the `resolve` dep, and the disabled path still never touches either fetch.)

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(hostinfo): opt-in clearnet resolve path + via marker (Tor stays default)`.

---

### Task 6: Settings checkbox + ack + clearnet warning + clarified labels

**Files:** Modify `src/renderer/modules/settings/SettingsModule.tsx`, `src/renderer/modules/hostinfo/HostInfoView.tsx`; Test `test/settings-clearnet-resolve-ui.test.tsx`.

**Interfaces:** Consumes Task 4 settings + Task 5 `HostInfo.via`. Uses `confirmDialog` (already imported, SettingsModule.tsx:13).

- [ ] **Step 1: Failing test** `test/settings-clearnet-resolve-ui.test.tsx` — (a) the clearnet-resolve checkbox is DISABLED when `cctvResolveHosts` is off; (b) enabling it when ack is false calls `confirmDialog` and only patches `cctvResolveClearnet: true` (+ `cctvResolveClearnetAck: true`) if confirmed; declining leaves it off; (c) `HostInfoView` renders the "resolved over CLEARNET — real IP exposed" warning when `info.via === 'clearnet'` and NOT when `via === 'tor'`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
  - SettingsModule GeoINT section (near the `cctvResolveHosts` checkbox, line ~754): add a clearnet-resolve checkbox, disabled unless `cctvResolveHosts`:
    ```tsx
    <label style={{ opacity: s.geoint.cctvResolveHosts ? 1 : 0.5 }}>
      <input type="checkbox" disabled={!s.geoint.cctvResolveHosts}
        checked={s.geoint.cctvResolveClearnet}
        onChange={async (e) => {
          if (e.target.checked && !s.geoint.cctvResolveClearnetAck) {
            const ok = await confirmDialog('⚠ Resolving camera hosts over CLEARNET exposes your real IP to Cloudflare DoH and rdap.org, and reveals which cameras you investigate. Enable anyway?', 'Enable clearnet resolve');
            if (!ok) return;
            await patch({ geoint: { cctvResolveClearnet: true, cctvResolveClearnetAck: true } });
          } else {
            await patch({ geoint: { cctvResolveClearnet: e.target.checked } });
          }
        }} />
      Resolve camera hosts over CLEARNET (⚠ exposes your real IP — off by default)
    </label>
    ```
    (Partial patch per Task 3's rule — only the changed keys.)
  - Clarify the two existing GeoINT labels (Task/WS4 copy): `cctvOverTor` label → "Route camera **streams** through Tor (off = clearnet — use for cameras that block Tor)"; `cctvResolveHosts` label → "Resolve camera **hosts** (IP/PTR/RDAP recon) — Tor-only unless clearnet resolve is enabled below."
  - `HostInfoView.tsx` data branch: when `info.via === 'clearnet'`, add
    ```tsx
    {info.via === 'clearnet' && <div style={{ color: '#a33' }}>Resolved over CLEARNET — real IP exposed.</div>}
    ```

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(geoint): clearnet-resolve toggle + ack + real-IP warning; clarify stream-vs-host Tor labels`.

---

## Post-tasks (controller, after all 6 green + whole-branch review)

- [ ] Bump `package.json` → `3.35.0`.
- [ ] `RELEASE_NOTES_v3.35.0.md`; update `README.md` (status/changelog/version/test count).
- [ ] Full `pnpm test` + `pnpm typecheck` (controller re-run).
- [ ] `pnpm package:win`; grep packaged `app.asar` for `cctvResolveClearnet`, `settings:changed`, `clearnetFetchJson`, and the `via`/clearnet-warning string.
- [ ] Charter re-check: with `cctvResolveClearnet` OFF (default), host resolution egress is Tor-only (no clearnet socket); ON = the ack-gated clearnet path + visible warning is the only new egress.
- [ ] Merge; GitHub release (gh-api + curl); profile README 6-spot update; push.

## Self-Review

- **Spec coverage:** WS1→T1, WS2→T2+T3, WS3→T4+T5+T6, WS4→T6. All covered.
- **Type consistency:** `HostInfo.via` defined T5, consumed T6; `cctvResolveClearnet`/`Ack` defined T4, consumed T5 (handler) + T6 (UI); `settings:changed` channel + `onChanged` match across contract/preload/api.d.ts/store (T2).
- **Placeholder scan:** the one grep-directive (chat.ts `getWindow` import) is a real reuse pointer, not a placeholder. No TODO/TBD.
- **Sequencing:** T4 before T5/T6 stated in Global + File Structure.
- **Charter:** clearnet path is default-off, ack-gated, visibly warned; Tor-only default proven unchanged by the merge-survival + gate tests.
