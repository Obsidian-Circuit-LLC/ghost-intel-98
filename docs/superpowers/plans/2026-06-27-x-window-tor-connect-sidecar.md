# X window + Searchlight Connect-Tor + sidecar bundling — Implementation Plan

> **For agentic workers:** implement task-by-task. Each task ends green (typecheck + its tests) and commits.

**Goal:** (A) Give Searchlight a "Connect Tor" affordance so a Tor-mode sweep stops failing every row with TOR_UNAVAILABLE; (B) register the already-built X collector window so it is launchable; (C) bundle the twscrape sidecar into the packaged app via electron-builder.

**Architecture:** Ghost Intel 98 — Electron 33 / React 18 / TS-strict / vitest / electron-vite / electron-builder. Renderer talks to main only through `window.api.*` (preload bridge over typed IPC channels in `src/shared/ipc-contracts.ts`).

## Global Constraints (copy verbatim, every task)

- **No new network egress.** Searchlight Tor uses the existing bundled bgconn Tor (`getBgTor()`); X uses its existing sidecar. Add NO new hosts/sockets.
- **X quarantine is sacred.** X main-process code must NOT import any Tor/Telegram/bgconn/socmint transport. Registering the X *renderer* window must not create a main-process import edge from `src/main/x/**` to those. The import-graph sentinel test (`test/x-*sentinel*` / quarantine test) MUST stay green.
- **Fail-closed, never silent clearnet.** The Connect-Tor work must not weaken Searchlight's no-silent-fallback invariant: Tor mode still refuses (TOR_UNAVAILABLE) when Tor isn't ready; the button only lets the user *start* Tor explicitly.
- **No commit trailers** (no Co-Authored-By / Claude / Signed-off). Commit as the repo persona.
- **TS strict, no `any` leaks.** Full `pnpm typecheck` clean after each task.
- **Never weaken a test to make it pass.**

---

## Task 1: Searchlight Tor connector (main + IPC + preload)

**Files:**
- Create: `src/main/searchlight/tor-connect.ts`
- Create: `test/searchlight-tor-connect.test.ts`
- Modify: `src/shared/ipc-contracts.ts` (add 2 channels + 2 typed-map entries)
- Modify: `src/main/ipc/register.ts` (wire 2 handlers using the connector)
- Modify: `src/preload/index.ts` and `src/preload/api.d.ts` (expose the 2 channels)

**Interfaces — Produces:**
```ts
// src/main/searchlight/tor-connect.ts
export type TorConnState = 'off' | 'connecting' | 'ready';
export interface TorLike { isBootstrapped(): boolean; start(): Promise<void>; }
export interface TorConnector {
  status(): TorConnState;
  connect(): Promise<{ state: TorConnState; error?: string }>;
}
export function makeTorConnector(getTor: () => TorLike | null): TorConnector;
```

Behavior (idempotent — shares one in-flight start promise so concurrent connects don't double-spawn; `BgconnTor.start()` already no-ops if `this.proc` is set, but the connector still tracks in-flight to report `'connecting'` accurately):
- `status()`: `getTor()?.isBootstrapped()` → `'ready'`; else in-flight start → `'connecting'`; else `'off'`.
- `connect()`: no tor instance → `{state:'off', error:'Tor is unavailable'}`. Already bootstrapped → `{state:'ready'}`. Otherwise start (reuse in-flight promise), await it; then return `{state:'ready'}` if `isBootstrapped()` else `{state:'connecting'}` (another path owns the bootstrap); on throw → `{state:'off', error: <message>}`.

- [ ] **Step 1: failing test** — `test/searchlight-tor-connect.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { makeTorConnector, type TorLike } from '../src/main/searchlight/tor-connect';

function fakeTor(over: Partial<TorLike> = {}): TorLike {
  return { isBootstrapped: () => false, start: async () => {}, ...over };
}

describe('searchlight tor-connect', () => {
  it('reports off when tor is null', () => {
    const c = makeTorConnector(() => null);
    expect(c.status()).toBe('off');
  });
  it('reports ready when bootstrapped', () => {
    const c = makeTorConnector(() => fakeTor({ isBootstrapped: () => true }));
    expect(c.status()).toBe('ready');
  });
  it('connect returns off+error when tor unavailable', async () => {
    const c = makeTorConnector(() => null);
    expect(await c.connect()).toEqual({ state: 'off', error: 'Tor is unavailable' });
  });
  it('connect starts tor once and resolves ready', async () => {
    let bs = false;
    const start = vi.fn(async () => { bs = true; });
    const tor = fakeTor({ start, get isBootstrapped() { return () => bs; } } as Partial<TorLike>);
    const c = makeTorConnector(() => tor);
    const r = await c.connect();
    expect(r.state).toBe('ready');
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('concurrent connects share one start (no double-spawn)', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => { resolve = r; });
    let bs = false;
    const start = vi.fn(async () => { await gate; bs = true; });
    const tor: TorLike = { isBootstrapped: () => bs, start };
    const c = makeTorConnector(() => tor);
    const p1 = c.connect(); const p2 = c.connect();
    expect(c.status()).toBe('connecting');
    resolve();
    await Promise.all([p1, p2]);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('connect returns off+error when start throws', async () => {
    const tor: TorLike = { isBootstrapped: () => false, start: async () => { throw new Error('boom'); } };
    const c = makeTorConnector(() => tor);
    expect(await c.connect()).toEqual({ state: 'off', error: 'boom' });
  });
});
```
- [ ] **Step 2:** run `pnpm test test/searchlight-tor-connect.test.ts` → FAIL (module missing).
- [ ] **Step 3:** implement `src/main/searchlight/tor-connect.ts` to the interface above.
- [ ] **Step 4:** `pnpm test test/searchlight-tor-connect.test.ts` → PASS.
- [ ] **Step 5: IPC contracts** — in `src/shared/ipc-contracts.ts`, inside the `searchlight:` channels object add:
  `torStatus: 'searchlight:torStatus',` and `connectTor: 'searchlight:connectTor',`
  and in the typed handler map add:
  `[channels.searchlight.torStatus]: { args: []; returns: { state: 'off' | 'connecting' | 'ready' } };`
  `[channels.searchlight.connectTor]: { args: []; returns: { state: 'off' | 'connecting' | 'ready'; error?: string } };`
- [ ] **Step 6: handlers** — in `src/main/ipc/register.ts`, near the existing `searchlightSocksPort()` (~line 1336), construct one module-scoped connector:
  `const slTorConnector = makeTorConnector(() => { const t = getBgTor(); return t ? { isBootstrapped: () => t.isBootstrapped(), start: () => t.start() } : null; });`
  (import `makeTorConnector` from `../searchlight/tor-connect`.) Then:
  `safeHandle(channels.searchlight.torStatus, async () => ({ state: slTorConnector.status() }));`
  `safeHandle(channels.searchlight.connectTor, async () => slTorConnector.connect());`
- [ ] **Step 7: preload** — in `src/preload/index.ts` `searchlight:` block add:
  `torStatus: () => ipcRenderer.invoke(channels.searchlight.torStatus),`
  `connectTor: () => ipcRenderer.invoke(channels.searchlight.connectTor),`
  and mirror the types in `src/preload/api.d.ts` `searchlight:` interface:
  `torStatus(): Promise<{ state: 'off' | 'connecting' | 'ready' }>;`
  `connectTor(): Promise<{ state: 'off' | 'connecting' | 'ready'; error?: string }>;`
- [ ] **Step 8:** `pnpm typecheck` clean; commit `feat(searchlight): tor-connect state machine + torStatus/connectTor IPC`.

---

## Task 2: Searchlight SweepPanel — Connect-Tor button + notice

**Files:**
- Modify: `src/renderer/modules/searchlight/panels/SweepPanel.tsx`
- Modify: `src/renderer/modules/searchlight/searchlight.css` (notice/button styling, reuse existing `sl-sweep-net-notice` look)

**Consumes:** `window.api.searchlight.torStatus()` / `.connectTor()` from Task 1.

Behavior:
- Add state `const [torState, setTorState] = useState<'off'|'connecting'|'ready'|'unknown'>('unknown');`
- On mount, and whenever `directMode` flips to Tor (`!directMode`) with `networkEnabled`, query `torStatus()` and set state. While `torState === 'connecting'`, poll `torStatus()` every 2s until it leaves `connecting` (clear the interval on unmount / state change — no leaked timers).
- Render, **only when** `networkEnabled && !directMode && torState !== 'ready'`, a notice block (mirror `sl-sweep-net-notice`) inside the toolbar near the existing network-off notice:
  - text: `Tor is not connected — a Tor sweep will report "TOR NOT READY" for every site.`
  - a button `Connect Tor` (class `sl-sweep-btn`), disabled while `torState === 'connecting'` (label becomes `Starting Tor… (~30–60s)`), onClick → `setTorState('connecting')` then `const r = await window.api.searchlight.connectTor(); setTorState(r.state === 'ready' ? 'ready' : r.state)` and if `r.error` show it in the notice (use a local `torErr` state).
  - a hint: `…or tick "Direct (clearnet)" to sweep without Tor.`
- Do NOT block Launch on torState (keep existing disabled logic). The notice + button is advisory and actionable; the existing TOR_UNAVAILABLE behavior is unchanged when the user launches anyway.

This panel is **not headlessly testable** (no DOM test harness here). Verify by `pnpm typecheck` + manual smoke (documented in the task report). Keep all logic in the component; no new dependency.

- [ ] Step 1: add state + effect (status query + bounded poll w/ cleanup).
- [ ] Step 2: add the notice + button JSX guarded by `networkEnabled && !directMode && torState !== 'ready'`.
- [ ] Step 3: add minimal CSS (reuse existing tokens; a `.sl-sweep-tor-notice` mirroring `.sl-sweep-net-notice` + inline button).
- [ ] Step 4: `pnpm typecheck` clean; commit `feat(searchlight): Connect-Tor button + not-connected notice in Sweep`.

---

## Task 3: Register the X / Twitter collector window

**Files:**
- Modify: `src/renderer/modules/register-builtins.tsx`
- Create: `test/x-module-registered.test.ts`

The component `src/renderer/modules/x/XCollectorModule.tsx` (`export function XCollectorModule({ caseId }: { caseId?: string })`) already exists; it is just not registered.

- [ ] **Step 1: failing test** — `test/x-module-registered.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';
import { getModule } from '../src/renderer/state/registry';

describe('X collector module registration', () => {
  beforeAll(() => { registerBuiltins(); });
  it('registers an openable "x" window', () => {
    const m = getModule('x');
    expect(m).toBeTruthy();
    expect(m?.title).toMatch(/X|Twitter/i);
    expect(typeof m?.component).toBe('function');
  });
});
```
  (If the test environment cannot import the TSX/registry cleanly, mirror the existing module-registration test in `test/` — find one referencing `registerBuiltins` or `getModule` and copy its setup exactly. If none exists and JSX import fails under vitest, instead assert via a node-safe check that `register-builtins.tsx` contains a `registerModule({ key: 'x'` line — but PREFER the real registry assertion.)
- [ ] **Step 2:** run it → FAIL (no 'x' module).
- [ ] **Step 3:** in `register-builtins.tsx`: import `{ XCollectorModule }` from `./x/XCollectorModule`; add an adapter mirroring `SocmintAdapter`:
  `function XCollectorAdapter({ spec }: { spec: WindowSpec }): JSX.Element { return <XCollectorModule caseId={spec.props?.['caseId'] as string | undefined} />; }`
  and in `registerBuiltins()` after the `socmint` line add:
  `registerModule({ key: 'x', title: 'X / Twitter', glyph: '✖', component: XCollectorAdapter, builtin: true, defaultWidth: 900, defaultHeight: 640 });`
- [ ] **Step 4:** run test → PASS; `pnpm typecheck` clean.
- [ ] **Step 5:** commit `feat(x): register the X/Twitter collector as a launchable window`.

---

## Task 4: Bundle the twscrape sidecar into the packaged app

**Files:**
- Modify: `package.json` (`build` config)

The sidecar binaries live at `resources/twscrape-runner/<platform>/twscrape-runner/<bin>` and are gitignored (operator build gate). The build venv/vendor/work dirs also live under `resources/twscrape-runner/` and MUST NOT be bundled. `extraResources` currently omits twscrape-runner entirely, so a built binary never ships.

Add a **filtered** extraResources entry that copies ONLY the per-platform binary tree, excluding build artefacts:
```jsonc
{
  "from": "resources/twscrape-runner",
  "to": "twscrape-runner",
  "filter": [
    "**/*",
    "!.venv-build/**", "!vendor/**", "!.build-work/**",
    "!__pycache__/**", "!*.spec", "!requirements*.txt"
  ]
}
```
Add it to the **top-level** `extraResources` array (after the `searchlight` entry). This bundles whatever platform dirs exist (`linux-x64/…`) and silently ships nothing extra on a platform with no built binary. The runtime path resolver (`src/main/x/sidecar-client.ts` `productionSidecarPath()` → `process.resourcesPath/twscrape-runner/<plat>/twscrape-runner/<bin>`) already matches `to: "twscrape-runner"`.

- [ ] **Step 1:** add the filtered entry to `package.json` top-level `build.extraResources`.
- [ ] **Step 2:** validate JSON: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`.
- [ ] **Step 3:** sanity — confirm `resources/twscrape-runner/linux-x64/twscrape-runner/twscrape-runner` exists and its sha256 == the `linux` pin in `src/main/x/sidecar-client.ts` (`6437f928145d0669e68bf73b0239d7e921cc2910e086564b4e36104e5ee97374`).
- [ ] **Step 4:** commit `build(x): bundle twscrape sidecar binary tree (excluding build artefacts)`.

**Honest limit (record in the report):** the Windows `.exe` sidecar CANNOT be built from Linux (PyInstaller has no cross-compilation). A Windows installer built here ships the X window but it reports "sidecar not installed" until `scripts/build-twscrape-runner.bat` is run on Windows and its SHA pinned into `win32` of `PINNED_SHA256`. Only a Linux package bundles a working sidecar today.

---

## Verification (whole-branch, after all tasks)

- `pnpm typecheck` clean; `pnpm test` fully green (1,972 existing + new suites). The X quarantine / import-graph sentinel test MUST be green.
- Confirm no main-process import edge from `src/main/x/**` to Tor/Telegram/bgconn/socmint was introduced.
- Confirm Searchlight's no-silent-clearnet invariant intact (Tor mode still TOR_UNAVAILABLE when not ready; the button only starts Tor explicitly).
