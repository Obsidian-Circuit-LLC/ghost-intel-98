# GhostExodus Feedback — Searchlight Sweep Persistence + SOCMINT UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two live-casework blockers (Searchlight sweep results vanishing on tab switch; SOCMINT "Start Monitor" appearing dead) and remove their root-cause footguns (mount-local view state; free-text Case ID) by adding a real-case picker and a cross-launch to the existing X window.

**Architecture:** Renderer-only changes plus one new renderer state field. Load-bearing logic goes into pure, node-testable helpers (matching the codebase's `x-collect-request.ts` / `start-monitor-request.ts` pattern); the `.tsx` shells stay thin because the renderer is not headlessly testable. No main-process, IPC, or egress changes — `window.api.cases.list()`, `window.api.socmint.*`, and `window.api.searchlight.*` all already exist.

**Tech Stack:** Electron + React + Zustand (renderer), Vitest (node env, `test/` dir), TypeScript strict.

## Global Constraints

- **No new network egress; no telemetry/phone-home.** X stays clearnet-quarantine in its own window; SOCMINT stays Tor-routed. The cross-launch button opens the existing `x` module — it does not embed it (operator decision 2026-07-01).
- **Commits:** persona `Dezirae-Stark <213370007+Dezirae-Stark@users.noreply.github.com>`. **Never** emit `Co-Authored-By:` / `Signed-off-by:` / `Claude-Session:` trailers in author, committer, or message body.
- **XSS floor:** every user-controlled string (case titles, channel labels) rendered as React text children only — never `dangerouslySetInnerHTML`, never `new RegExp(userInput)`. Run the commit security-review gate on the final diff before merge.
- **Determinism:** any sort in a helper must be a total, stable order (no locale-dependent compare on the primary key; tie-break to a stable field).
- **ADHD-UI standing constraint (end user GhostExodus):** low-friction one-click actions, immediate *visible* feedback, plain language, one clear next action. A disabled button whose only "why" is a hover tooltip violates this — the reason must be on-screen.
- **Merge/version-bump/publish only on explicit operator approval.** This plan builds + verifies; it does not publish a release.
- **Do not touch** the three pre-existing dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`).

---

## File Structure

**New files:**
- `src/renderer/modules/searchlight/sweep-stream.ts` — mount-independent sweep result/done stream manager (factory with injected deps → node-testable).
- `src/renderer/modules/socmint/start-monitor-block.ts` — pure `describeStartMonitorBlock()` returning the plain-language reason Start Monitor is blocked (or `''`).
- `src/renderer/modules/socmint/case-options.ts` — pure `buildCaseOptions()` shaping `CaseSummary[]` into picker options.
- `src/renderer/modules/socmint/x-launch-spec.ts` — pure `xLaunchSpec()` returning the `useWindows.open` spec for the X window.
- `test/searchlight-store-selection.test.ts`
- `test/searchlight-sweep-stream.test.ts`
- `test/socmint-start-monitor-block.test.ts`
- `test/socmint-case-options.test.ts`
- `test/x-launch-spec.test.ts`

**Modified files:**
- `src/renderer/modules/searchlight/store.ts` — add `selectedJobId` + `setSelectedJobId`.
- `src/renderer/modules/searchlight/panels/SweepPanel.tsx` — read `selectedJobId` from store; launch via the stream manager; drop the mount-scoped subscription and mount-local `activeJobId`.
- `src/renderer/modules/socmint/SocmintModule.tsx` — visible block-reason under Start Monitor; case picker; X cross-launch button.
- `package.json`, `README.md`, `RELEASE_NOTES_v3.25.0.md` — release task.

---

## Task 1: Searchlight — persist the selected sweep job across tab switches

**Root cause:** `SweepPanel` holds `activeJobId` in local `useState` (`SweepPanel.tsx:109`). `SearchlightModule` conditionally renders `tab === 'sweep' ? <SweepPanel/> : …` (`SearchlightModule.tsx:82`), so leaving the tab unmounts the panel and wipes `activeJobId`. The results are still in the zustand store (`activeCase.searches`); only the *pointer* to which job to show is lost, so the panel falls to "No sweep yet…" (`SweepPanel.tsx:709`). Fix: move the selected-job pointer into the store (module-level singleton → survives unmount).

**Files:**
- Modify: `src/renderer/modules/searchlight/store.ts` (add field + action near `activeCaseId`, lines 42-53 / 141)
- Modify: `src/renderer/modules/searchlight/panels/SweepPanel.tsx:109` (and readers at `:196-199`, launch at `:288`)
- Test: `test/searchlight-store-selection.test.ts`

**Interfaces:**
- Produces: `SearchlightState.selectedJobId: string | null`; `SearchlightState.setSelectedJobId(id: string | null): void`. `setSelectedJobId` is pure view-state — it MUST NOT call `scheduleSave` (no persistence, safe under node tests where `window` is undefined).

- [ ] **Step 1: Write the failing test**

```ts
// test/searchlight-store-selection.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchlightStore } from '../src/renderer/modules/searchlight/store';

describe('searchlight store — selectedJobId', () => {
  beforeEach(() => {
    useSearchlightStore.setState({ cases: [], activeCaseId: null, selectedJobId: null });
  });

  it('defaults to null', () => {
    expect(useSearchlightStore.getState().selectedJobId).toBeNull();
  });

  it('setSelectedJobId updates the field without throwing (no persistence side-effect)', () => {
    useSearchlightStore.getState().setSelectedJobId('job-123');
    expect(useSearchlightStore.getState().selectedJobId).toBe('job-123');
    useSearchlightStore.getState().setSelectedJobId(null);
    expect(useSearchlightStore.getState().selectedJobId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/searchlight-store-selection.test.ts`
Expected: FAIL — `setSelectedJobId is not a function` (and `selectedJobId` absent from the typed state).

- [ ] **Step 3: Implement in the store**

In `src/renderer/modules/searchlight/store.ts`, add to the `SearchlightState` interface (near line 44, beside `activeCaseId`):

```ts
  // Selected sweep job for the Sweep panel (survives tab-switch unmounts).
  selectedJobId: string | null;
  setSelectedJobId(id: string | null): void;
```

And in the store body (near line 141, beside `setActiveCaseId`):

```ts
  selectedJobId: null,
  setSelectedJobId: (id) => set({ selectedJobId: id }),
```

Also add `selectedJobId: null` to the initial state object literal (beside `activeCaseId: null` at line 101-102).

- [ ] **Step 4: Wire SweepPanel to the store pointer**

In `src/renderer/modules/searchlight/panels/SweepPanel.tsx`:

Replace the local declaration (line 109) `const [activeJobId, setActiveJobId] = useState<string | null>(null);` with a store-backed pointer:

```ts
  const selectedJobId = useSearchlightStore((s) => s.selectedJobId);
  const setSelectedJobId = useSearchlightStore((s) => s.setSelectedJobId);
  const activeJobId = selectedJobId;
```

Replace the two `setActiveJobId(...)` call sites: at launch (line 288) use `setSelectedJobId(jobId);`. Remove `setResultBucket('all')`'s neighbor only if it referenced the old setter — it does not.

After the `activeCase` derivation (near line 101), add an effect that restores the pointer to the most recent job when nothing is selected (covers a fresh mount after app restart, where `selectedJobId` is null but `searches` were hydrated from disk):

```ts
  // Restore the last sweep into view when returning to the tab with no active selection.
  useEffect(() => {
    if (selectedJobId) return;
    const last = activeCase?.searches[activeCase.searches.length - 1];
    if (last) setSelectedJobId(last.id);
  }, [selectedJobId, activeCase, setSelectedJobId]);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/searchlight-store-selection.test.ts`
Expected: PASS (3 assertions).
Run: `pnpm typecheck`
Expected: no errors in `store.ts` / `SweepPanel.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/searchlight/store.ts src/renderer/modules/searchlight/panels/SweepPanel.tsx test/searchlight-store-selection.test.ts
git commit -m "fix(searchlight): keep the selected sweep in view across tab switches"
```

---

## Task 2: Searchlight — keep a running sweep filling the store while the tab is away

**Root cause (deeper edge):** the result/done subscription lives in a `SweepPanel` effect keyed on mount (`SweepPanel.tsx:234-258`); its cleanup unsubscribes on unmount (`:252`). So while the user is on another tab during a *running* sweep, streamed results are dropped — over Tor with 1,400+ sites this loses real data. Fix: move the stream wiring into a module-level manager started at launch and stopped on finish/cancel, independent of which panel is mounted. The store mutations remain the single source of truth.

**Files:**
- Create: `src/renderer/modules/searchlight/sweep-stream.ts`
- Modify: `src/renderer/modules/searchlight/panels/SweepPanel.tsx` (remove the mount-scoped subscription effect at `:234-258`; call the manager from `handleLaunch` `:262-290` and `handleCancel` `:292-296`)
- Test: `test/searchlight-sweep-stream.test.ts`

**Interfaces:**
- Consumes: `SearchlightState.appendSweepResult`, `SearchlightState.finishSweepJob` (existing).
- Produces:
  ```ts
  export interface SweepStreamDeps {
    onSweepResult(cb: (r: SweepResult) => void): () => void;
    onSweepDone(cb: (f: { jobId: string; status: string }) => void): () => void;
    appendResult(caseId: string, jobId: string, r: SweepResult): void;
    finishJob(caseId: string, jobId: string, status: 'completed' | 'cancelled'): void;
  }
  export interface SweepStreamManager {
    start(caseId: string, jobId: string): void;   // idempotent per jobId
    stop(jobId: string): void;
    active(): string[];
  }
  export function createSweepStreamManager(deps: SweepStreamDeps): SweepStreamManager;
  ```
  A default singleton wired to `window.api.searchlight` + the store is exported as `sweepStream`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchlight-sweep-stream.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createSweepStreamManager } from '../src/renderer/modules/searchlight/sweep-stream';

function fakeDeps() {
  let resultCb: ((r: any) => void) | null = null;
  let doneCb: ((f: any) => void) | null = null;
  const offResult = vi.fn();
  const offDone = vi.fn();
  return {
    emitResult: (r: any) => resultCb?.(r),
    emitDone: (f: any) => doneCb?.(f),
    offResult,
    offDone,
    appended: [] as any[],
    finished: [] as any[],
    deps: {
      onSweepResult(cb: any) { resultCb = cb; return offResult; },
      onSweepDone(cb: any) { doneCb = cb; return offDone; },
      appendResult(caseId: string, jobId: string, r: any) { this._a.push({ caseId, jobId, r }); },
      finishJob(caseId: string, jobId: string, status: string) { this._f.push({ caseId, jobId, status }); },
      _a: [] as any[],
      _f: [] as any[],
    },
  };
}

describe('sweep stream manager', () => {
  it('routes only matching-jobId results into the store while active', () => {
    const f = fakeDeps();
    const mgr = createSweepStreamManager(f.deps as any);
    mgr.start('case-1', 'job-A');
    f.emitResult({ jobId: 'job-A', id: 'r1' });
    f.emitResult({ jobId: 'job-OTHER', id: 'r2' }); // ignored
    expect((f.deps as any)._a).toEqual([{ caseId: 'case-1', jobId: 'job-A', r: { jobId: 'job-A', id: 'r1' } }]);
    expect(mgr.active()).toContain('job-A');
  });

  it('finishes and auto-detaches on the done event for that job', () => {
    const f = fakeDeps();
    const mgr = createSweepStreamManager(f.deps as any);
    mgr.start('case-1', 'job-A');
    f.emitDone({ jobId: 'job-A', status: 'completed' });
    expect((f.deps as any)._f).toEqual([{ caseId: 'case-1', jobId: 'job-A', status: 'completed' }]);
    expect(mgr.active()).not.toContain('job-A');
    expect(f.offResult).toHaveBeenCalled();
    expect(f.offDone).toHaveBeenCalled();
  });

  it('stop() unsubscribes and drops the job', () => {
    const f = fakeDeps();
    const mgr = createSweepStreamManager(f.deps as any);
    mgr.start('case-1', 'job-A');
    mgr.stop('job-A');
    expect(mgr.active()).toEqual([]);
    f.emitResult({ jobId: 'job-A', id: 'r1' }); // no longer routed
    expect((f.deps as any)._a).toEqual([]);
  });

  it('start() is idempotent per jobId (no double subscription)', () => {
    const f = fakeDeps();
    const mgr = createSweepStreamManager(f.deps as any);
    mgr.start('case-1', 'job-A');
    mgr.start('case-1', 'job-A');
    expect(mgr.active()).toEqual(['job-A']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/searchlight-sweep-stream.test.ts`
Expected: FAIL — module `sweep-stream` not found.

- [ ] **Step 3: Implement the manager**

```ts
// src/renderer/modules/searchlight/sweep-stream.ts
/**
 * Mount-independent sweep stream manager. Subscriptions live here, not in a panel
 * effect, so a running sweep keeps filling the store while the Sweep tab is unmounted.
 */
import type { SweepResult } from '@shared/searchlight/types';
import { useSearchlightStore } from './store';

export interface SweepStreamDeps {
  onSweepResult(cb: (r: SweepResult) => void): () => void;
  onSweepDone(cb: (f: { jobId: string; status: string }) => void): () => void;
  appendResult(caseId: string, jobId: string, r: SweepResult): void;
  finishJob(caseId: string, jobId: string, status: 'completed' | 'cancelled'): void;
}

export interface SweepStreamManager {
  start(caseId: string, jobId: string): void;
  stop(jobId: string): void;
  active(): string[];
}

export function createSweepStreamManager(deps: SweepStreamDeps): SweepStreamManager {
  const jobs = new Map<string, { caseId: string; offResult: () => void; offDone: () => void }>();

  return {
    start(caseId, jobId) {
      if (jobs.has(jobId)) return; // idempotent
      const offResult = deps.onSweepResult((r) => {
        if (r.jobId !== jobId) return;
        deps.appendResult(caseId, jobId, r);
      });
      const offDone = deps.onSweepDone((f) => {
        if (f.jobId !== jobId) return;
        const status = f.status === 'cancelled' ? 'cancelled' : 'completed';
        deps.finishJob(caseId, jobId, status);
        this.stop(jobId);
      });
      jobs.set(jobId, { caseId, offResult, offDone });
    },
    stop(jobId) {
      const entry = jobs.get(jobId);
      if (!entry) return;
      entry.offResult();
      entry.offDone();
      jobs.delete(jobId);
    },
    active() {
      return [...jobs.keys()];
    },
  };
}

/** Default singleton wired to the real IPC surface + the renderer store. */
export const sweepStream: SweepStreamManager = createSweepStreamManager({
  onSweepResult: (cb) => window.api.searchlight.onSweepResult(cb),
  onSweepDone: (cb) => window.api.searchlight.onSweepDone(cb),
  appendResult: (caseId, jobId, r) => useSearchlightStore.getState().appendSweepResult(caseId, jobId, r),
  finishJob: (caseId, jobId, status) => useSearchlightStore.getState().finishSweepJob(caseId, jobId, status),
});
```

- [ ] **Step 4: Rewire SweepPanel to the manager**

In `src/renderer/modules/searchlight/panels/SweepPanel.tsx`:

Add the import near the other local imports (beside line 28):

```ts
import { sweepStream } from '../sweep-stream';
```

**Delete** the entire mount-scoped subscription effect (lines 234-258, the `useEffect` block commented "Sweep subscription (per active job)").

In `handleLaunch` (after `store.addSearchJob(activeCaseId, job);` at line 287), start the stream and select the job:

```ts
    store.addSearchJob(activeCaseId, job);
    sweepStream.start(activeCaseId, jobId);
    setSelectedJobId(jobId);
    setResultBucket('all');
```

In `handleCancel` (line 292-296), stop the stream after cancelling:

```ts
  const handleCancel = useCallback(async () => {
    if (!activeJobId || !activeCaseId) return;
    await window.api.searchlight.cancelSweep(activeJobId);
    store.finishSweepJob(activeCaseId, activeJobId, 'cancelled');
    sweepStream.stop(activeJobId);
  }, [activeJobId, activeCaseId, store]);
```

Note: on returning to the Sweep tab mid-sweep, the store already holds every result the manager routed while away; the restore effect from Task 1 re-points the view. No re-subscription needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/searchlight-sweep-stream.test.ts`
Expected: PASS (4 tests).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/searchlight/sweep-stream.ts src/renderer/modules/searchlight/panels/SweepPanel.tsx test/searchlight-sweep-stream.test.ts
git commit -m "fix(searchlight): stream sweep results into the store independent of the mounted tab"
```

---

## Task 3: SOCMINT — make the reason Start Monitor is blocked visible

**Root cause:** `Start Monitor` is disabled via `canStartMonitor(...)` (`SocmintModule.tsx:476`) with the "why" only in a hover `title` (`:479-487`). Against the ADHD-UI constraint, a dead button with an invisible reason reads as "the app won't let me." Fix: a pure `describeStartMonitorBlock()` returns a plain-language reason (including the common case: a channel typed into the Add form but never added), rendered as on-screen text.

**Files:**
- Create: `src/renderer/modules/socmint/start-monitor-block.ts`
- Modify: `src/renderer/modules/socmint/SocmintModule.tsx` (pass `hasPendingChannelInput` into `ChannelsPanel`; render the reason under the button near `:488-498`)
- Test: `test/socmint-start-monitor-block.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StartMonitorBlockParams {
    networkEnabled: boolean;
    caseId: string;
    burnerId: string;
    channelCount: number;
    hasPendingChannelInput: boolean; // Add-Channel form has an un-added channel id
    isWhatsApp: boolean;
  }
  export function describeStartMonitorBlock(p: StartMonitorBlockParams): string; // '' when nothing blocks
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/socmint-start-monitor-block.test.ts
import { describe, it, expect } from 'vitest';
import { describeStartMonitorBlock } from '../src/renderer/modules/socmint/start-monitor-block';

const base = {
  networkEnabled: true, caseId: 'c1', burnerId: 'tg-burner-1',
  channelCount: 1, hasPendingChannelInput: false, isWhatsApp: false,
};

describe('describeStartMonitorBlock', () => {
  it('returns empty when everything is satisfied', () => {
    expect(describeStartMonitorBlock(base)).toBe('');
  });
  it('flags disabled network first', () => {
    expect(describeStartMonitorBlock({ ...base, networkEnabled: false }))
      .toMatch(/network is off/i);
  });
  it('flags a missing case', () => {
    expect(describeStartMonitorBlock({ ...base, caseId: '' })).toMatch(/select a case/i);
  });
  it('gives the specific hint when a channel was typed but not added', () => {
    expect(describeStartMonitorBlock({ ...base, channelCount: 0, hasPendingChannelInput: true }))
      .toMatch(/click .*add channel/i);
  });
  it('asks for a channel when none exist and nothing is pending', () => {
    expect(describeStartMonitorBlock({ ...base, channelCount: 0, hasPendingChannelInput: false }))
      .toMatch(/add at least one channel/i);
  });
  it('uses "group" wording for WhatsApp', () => {
    expect(describeStartMonitorBlock({ ...base, channelCount: 0, hasPendingChannelInput: false, isWhatsApp: true }))
      .toMatch(/add at least one group/i);
  });
  it('flags a missing burner id last', () => {
    expect(describeStartMonitorBlock({ ...base, burnerId: '  ' })).toMatch(/burner id/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/socmint-start-monitor-block.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/renderer/modules/socmint/start-monitor-block.ts
/**
 * Plain-language reason the Start Monitor button is blocked, for on-screen display.
 * Returns '' when nothing blocks. Order mirrors canStartMonitor's checks so the message
 * always names the next thing the operator must do (one clear next action).
 */
export interface StartMonitorBlockParams {
  networkEnabled: boolean;
  caseId: string;
  burnerId: string;
  channelCount: number;
  hasPendingChannelInput: boolean;
  isWhatsApp: boolean;
}

export function describeStartMonitorBlock(p: StartMonitorBlockParams): string {
  const noun = p.isWhatsApp ? 'group' : 'channel';
  if (!p.networkEnabled) return 'SOCMINT network is off — enable it in Settings › SOCMINT.';
  if (!p.caseId.trim()) return 'Select a case first.';
  if (p.channelCount === 0 && p.hasPendingChannelInput) {
    return `You've typed a ${noun} but haven't added it yet — click "Add ${p.isWhatsApp ? 'Group' : 'Channel'}" above first.`;
  }
  if (p.channelCount === 0) return `Add at least one ${noun} above before starting.`;
  if (!p.burnerId.trim()) {
    return `Enter the Burner ID you configured in ${p.isWhatsApp ? 'WA Setup' : 'Settings › SOCMINT'}.`;
  }
  return '';
}
```

- [ ] **Step 4: Render the reason in SocmintModule**

In `src/renderer/modules/socmint/SocmintModule.tsx`:

Import the helper (beside line 60-64 import block):

```ts
import { describeStartMonitorBlock } from './start-monitor-block';
```

Extend `ChannelsPanelProps` (near line 305) with `newChannelId` is already passed; add nothing new there — compute the hint inside `ChannelsPanel` from props it already has (`newChannelId`, `channels.length`, `networkEnabled`, `caseId`, `burnerId`, `platform`). Inside `ChannelsPanel`, just before the `return`, add:

```ts
  const blockReason = describeStartMonitorBlock({
    networkEnabled,
    caseId,
    burnerId,
    channelCount: channels.length,
    hasPendingChannelInput: newChannelId.trim().length > 0,
    isWhatsApp,
  });
```

In the Monitor `<section>` (the `activeJobId === null` branch, near the disabled button at `:473-490`), replace the network-only note (`:491-493`) with an always-on reason line so the operator always sees the next step:

```tsx
            {blockReason !== '' && (
              <p className="sm-monitor-hint" role="status">{blockReason}</p>
            )}
            {monitorMessage !== '' && (
              <p className="sm-monitor-error" role="alert">{monitorMessage}</p>
            )}
```

(Keep `canStartMonitor(...)` on the button's `disabled` — the message is additive, not a gate change. `blockReason === ''` exactly when `canStartMonitor` is satisfiable, so the hint disappears when the button is live.)

Add a muted style in `src/renderer/modules/socmint/socmint.css` (beside `.sm-monitor-error`):

```css
.sm-monitor-hint { margin: 6px 0 0; font-size: 12px; color: #9fb0c8; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/socmint-start-monitor-block.test.ts`
Expected: PASS (7 tests).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/socmint/start-monitor-block.ts src/renderer/modules/socmint/SocmintModule.tsx src/renderer/modules/socmint/socmint.css test/socmint-start-monitor-block.test.ts
git commit -m "fix(socmint): show the reason Start Monitor is blocked instead of a silent disabled button"
```

---

## Task 4: SOCMINT — real-case picker (removes the free-text phantom-case footgun)

**Root cause:** the Case ID is free text with no validation; `caseDir(caseId)` (`src/main/storage/paths.ts:19`) just joins the string and `secureWriteFile` mkdir-p's it (`src/main/storage/secure-fs.ts:90`), so a typo/wrong id silently reads and writes a phantom case directory disconnected from the real case. GhostExodus had to dig in Case Manager for the id (feedback images 1-2). Fix: a dropdown of real cases from `window.api.cases.list()` whose option value is the real `CaseId`. Keep a manual-entry escape hatch for advanced use.

**Files:**
- Create: `src/renderer/modules/socmint/case-options.ts`
- Modify: `src/renderer/modules/socmint/SocmintModule.tsx` (the case bar at `:849-865`)
- Test: `test/socmint-case-options.test.ts`

**Interfaces:**
- Consumes: `window.api.cases.list(): Promise<CaseSummary[]>` (`src/preload/api.d.ts:132`); `CaseSummary` = `{ id, title, reference, category?, … }` (`src/shared/types.ts:12`).
- Produces:
  ```ts
  export interface CaseOption { value: string; label: string; category: string; }
  export function buildCaseOptions(cases: Pick<CaseSummary,'id'|'title'|'reference'|'category'>[]): CaseOption[];
  ```
  Deterministic order: by `category` (empty → `'Uncategorized'`) then `title`, tie-broken by `id`; label = `title` plus ` — ${reference}` when reference is non-empty.

- [ ] **Step 1: Write the failing test**

```ts
// test/socmint-case-options.test.ts
import { describe, it, expect } from 'vitest';
import { buildCaseOptions } from '../src/renderer/modules/socmint/case-options';

describe('buildCaseOptions', () => {
  it('shapes id→value and title(+reference)→label', () => {
    const out = buildCaseOptions([{ id: 'c1', title: 'Charles Davis', reference: 'Upwork 0001', category: 'Upwork' }]);
    expect(out).toEqual([{ value: 'c1', label: 'Charles Davis — Upwork 0001', category: 'Upwork' }]);
  });
  it('omits the reference suffix when empty', () => {
    const out = buildCaseOptions([{ id: 'c1', title: 'No Ref', reference: '', category: 'Agency' }]);
    expect(out[0].label).toBe('No Ref');
  });
  it('buckets missing category as Uncategorized', () => {
    const out = buildCaseOptions([{ id: 'c1', title: 'X', reference: '', category: undefined }]);
    expect(out[0].category).toBe('Uncategorized');
  });
  it('sorts by category, then title, then id — deterministically', () => {
    const out = buildCaseOptions([
      { id: 'b', title: 'Zulu', reference: '', category: 'Agency' },
      { id: 'a', title: 'Alpha', reference: '', category: 'Agency' },
      { id: 'c', title: 'Mike', reference: '', category: 'Bravo' },
    ]);
    expect(out.map((o) => o.value)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/socmint-case-options.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/renderer/modules/socmint/case-options.ts
import type { CaseSummary } from '@shared/types';

export interface CaseOption { value: string; label: string; category: string; }

/** Shape real cases into picker options with a deterministic, locale-independent order. */
export function buildCaseOptions(
  cases: Pick<CaseSummary, 'id' | 'title' | 'reference' | 'category'>[],
): CaseOption[] {
  return cases
    .map((c) => ({
      value: c.id,
      label: c.reference ? `${c.title} — ${c.reference}` : c.title,
      category: c.category && c.category.trim() ? c.category : 'Uncategorized',
    }))
    .sort((a, b) =>
      a.category < b.category ? -1 : a.category > b.category ? 1
      : a.label < b.label ? -1 : a.label > b.label ? 1
      : a.value < b.value ? -1 : a.value > b.value ? 1 : 0,
    );
}
```

- [ ] **Step 4: Wire the picker into SocmintModule**

In `src/renderer/modules/socmint/SocmintModule.tsx`:

Import (beside line 60-64):

```ts
import { buildCaseOptions, type CaseOption } from './case-options';
```

Add state + load effect near the other case state (beside `:670-679`):

```ts
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);
  const [manualEntry, setManualEntry] = useState(false);

  useEffect(() => {
    if (propCaseId !== undefined) return; // launched from a case → no picker
    let cancelled = false;
    void window.api.cases.list()
      .then((list) => { if (!cancelled) setCaseOptions(buildCaseOptions(list)); })
      .catch((err) => console.warn('[SOCMINT] cases.list:', err));
    return () => { cancelled = true; };
  }, [propCaseId]);
```

Replace the case bar (lines 849-865) with a picker-first bar (dropdown selects a real case id immediately — one click, no separate Load; manual entry remains as an opt-in fallback):

```tsx
      {/* Case selector — dropdown of real cases (value = real CaseId, no phantom-case footgun).
          Manual entry stays available for advanced/edge use. */}
      {propCaseId === undefined && (
        <div className="sm-case-bar">
          <label htmlFor="sm-case-pick" className="sm-label">Case</label>
          {!manualEntry ? (
            <>
              <select
                id="sm-case-pick"
                className="sm-input"
                value={caseId}
                onChange={(e) => { setCaseId(e.target.value); setCaseIdInput(e.target.value); }}
              >
                <option value="">Select a case…</option>
                {caseOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.category} › {o.label}</option>
                ))}
              </select>
              <button className="sm-btn" onClick={() => setManualEntry(true)}>Enter ID…</button>
            </>
          ) : (
            <>
              <input
                id="sm-case-id"
                className="sm-input"
                value={caseIdInput}
                onChange={(e) => setCaseIdInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCaseId(); }}
                placeholder="Enter case ID…"
              />
              <button className="sm-btn" onClick={handleApplyCaseId}>Load</button>
              <button className="sm-btn" onClick={() => setManualEntry(false)}>Pick from list</button>
            </>
          )}
        </div>
      )}
```

`option` labels are React text children — case titles are auto-escaped (XSS floor satisfied). No new IPC.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/socmint-case-options.test.ts`
Expected: PASS (4 tests).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/socmint/case-options.ts src/renderer/modules/socmint/SocmintModule.tsx test/socmint-case-options.test.ts
git commit -m "feat(socmint): pick a case from a dropdown of real cases instead of typing a raw ID"
```

---

## Task 5: SOCMINT — "X / Twitter ↗" cross-launch button (quarantine preserved)

**Decision (operator, 2026-07-01):** X stays clearnet-quarantine in its own window; SOCMINT gets a button that *opens* the existing `x` module (it does not embed it), so the Tor/clearnet boundary is untouched. The X module is registered as `key: 'x', title: 'X / Twitter'` (`src/renderer/modules/register-builtins.tsx:232`); windows open via `useWindows.getState().open(spec)` (`src/renderer/state/store.ts:67,84`).

**Files:**
- Create: `src/renderer/modules/socmint/x-launch-spec.ts`
- Modify: `src/renderer/modules/socmint/SocmintModule.tsx` (platform bar `:867-883`)
- Test: `test/x-launch-spec.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface XLaunchSpec { module: 'x'; title: 'X / Twitter'; props?: { caseId: string }; }
  export function xLaunchSpec(caseId?: string): XLaunchSpec;
  ```
  `props` is present only when `caseId` is a non-empty trimmed string (so the X window opens focused on the same case when one is loaded, and omits it otherwise — matching `XCollectorAdapter`'s optional `caseId`).

- [ ] **Step 1: Write the failing test**

```ts
// test/x-launch-spec.test.ts
import { describe, it, expect } from 'vitest';
import { xLaunchSpec } from '../src/renderer/modules/socmint/x-launch-spec';

describe('xLaunchSpec', () => {
  it('targets the x module with a stable title', () => {
    const s = xLaunchSpec();
    expect(s.module).toBe('x');
    expect(s.title).toBe('X / Twitter');
    expect(s.props).toBeUndefined();
  });
  it('carries caseId when one is loaded', () => {
    expect(xLaunchSpec('case-1').props).toEqual({ caseId: 'case-1' });
  });
  it('omits props for blank/whitespace caseId', () => {
    expect(xLaunchSpec('   ').props).toBeUndefined();
    expect(xLaunchSpec('').props).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/x-launch-spec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/renderer/modules/socmint/x-launch-spec.ts
/**
 * Spec for opening the SEPARATE X / Twitter window from SOCMINT. X is clearnet-quarantine;
 * SOCMINT is Tor-routed. This opens the existing 'x' module — it never embeds it — so the
 * quarantine boundary stays intact (operator decision 2026-07-01).
 */
export interface XLaunchSpec { module: 'x'; title: 'X / Twitter'; props?: { caseId: string }; }

export function xLaunchSpec(caseId?: string): XLaunchSpec {
  const id = caseId?.trim();
  return id ? { module: 'x', title: 'X / Twitter', props: { caseId: id } }
            : { module: 'x', title: 'X / Twitter' };
}
```

- [ ] **Step 4: Add the button to the platform bar**

In `src/renderer/modules/socmint/SocmintModule.tsx`:

Import (beside line 56-58):

```ts
import { useSettings, useWindows } from '../../state/store'; // extend the existing useSettings import line
import { xLaunchSpec } from './x-launch-spec';
```

(If `useSettings` is imported alone on line 57 `import { useSettings } from '../../state/store';`, change it to `import { useSettings, useWindows } from '../../state/store';`.)

In the platform bar (after the WhatsApp button, line 876-882), add a visually distinct cross-launch button — it is NOT a platform toggle, so it does not call `setPlatform`:

```tsx
        <button
          className="sm-platform-btn sm-platform-xlaunch"
          onClick={() => useWindows.getState().open(xLaunchSpec(caseId))}
          title="Opens the separate X / Twitter collector (clearnet — not routed through Tor)"
        >
          X / Twitter ↗
        </button>
```

Add a style making it read as a launcher, not a selected platform, in `socmint.css` (beside `.sm-platform-btn`):

```css
.sm-platform-xlaunch { margin-left: auto; font-style: italic; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/x-launch-spec.test.ts`
Expected: PASS (3 tests).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/socmint/x-launch-spec.ts src/renderer/modules/socmint/SocmintModule.tsx src/renderer/modules/socmint/socmint.css test/x-launch-spec.test.ts
git commit -m "feat(socmint): add an X / Twitter cross-launch button (clearnet window kept separate)"
```

---

## Task 6: Release — version bump, docs, full verification

**Files:**
- Modify: `package.json` (`"version": "3.24.2"` → `"3.25.0"`)
- Modify: `README.md` (Status entry, install line, test count)
- Create: `RELEASE_NOTES_v3.25.0.md`

**This task does NOT publish.** Building the installer and publishing the GitHub release is an operator-approved step, taken only after the operator confirms.

- [ ] **Step 1: Bump the version**

Edit `package.json`: `"version": "3.25.0",`.

- [ ] **Step 2: Full test + typecheck sweep**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm test`
Expected: all suites pass, including the 5 new files (18 new tests: 3 + 4 + 7 + 4 + 3 minus the overlap; count reported by vitest is authoritative — record the real total).

- [ ] **Step 3: Write release notes**

Create `RELEASE_NOTES_v3.25.0.md` describing: Searchlight sweeps survive tab switches and keep collecting while you're on another tab; SOCMINT tells you exactly why Start Monitor is blocked; SOCMINT case picker (choose a real case, no more typing IDs); an X / Twitter launcher inside SOCMINT (opens the separate clearnet window). Record the real vitest total from Step 2. Leave the installer SHA-256/size lines as `TBD — filled at build time` (they are only known after the operator-approved build).

- [ ] **Step 4: Update README**

Update the Status line to v3.25.0 with the four fixes summarized, the install line to `GhostIntel98-Setup-3.25.0.exe`, and the test count to the real vitest total.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md RELEASE_NOTES_v3.25.0.md
git commit -m "release(v3.25.0): searchlight sweep persistence + SOCMINT case picker/UX + X cross-launch"
```

---

## Verification (whole-branch, before proposing merge)

- `pnpm typecheck` clean; `pnpm test` fully green; record the real total.
- Run the commit security-review gate on the full branch diff (renderer XSS focus: case titles in `<option>`, block-reason text, X launcher). Confirm 0 Critical/High/Medium.
- Confirm no egress/telemetry added: `git diff main -- src/main` is empty (all changes are renderer + docs); no new `window.api.*` channels introduced.
- Manual smoke (operator/GhostExodus, post-build): (1) launch a sweep, switch to Graph and back → results still shown; switch away mid-sweep and back → count kept climbing. (2) SOCMINT: pick a case from the dropdown; before adding a channel, the Start Monitor area names the next step; add a channel, enter burner → button goes live. (3) Click "X / Twitter ↗" → the separate X window opens (clearnet), SOCMINT stays on Telegram/WhatsApp.
- Charter: X quarantine intact (no embed); commits carry the `Dezirae-Stark` persona with no AI trailers.

## Self-Review notes (author)

- **Coverage:** four feedback items → Task 1+2 (Searchlight session loss), Task 3 (Start Monitor "won't start"), Task 4 (case list/picker), Task 5 (X interface). Task 6 ships them.
- **Type consistency:** `selectedJobId`/`setSelectedJobId` used identically in Tasks 1-2; `SweepStreamManager` shape matches its consumer in Task 2 Step 4; `CaseOption` produced in Task 4 Step 3 matches its use in Step 4; `xLaunchSpec` return type matches `useWindows.open`'s `Omit<WindowSpec,'id'>` (module/title/props subset).
- **No placeholders** except the installer SHA/size in Task 6, which are genuinely unknowable until the operator-approved build (explicitly marked).
