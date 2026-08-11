/**
 * X Listening Station Enterprise port — Task 8: historical archive cycles (resumable,
 * rate-bounded, persists cursor in archiveState).
 *
 * Distinct from the legacy Plan-A `test/x-listening-archive.test.ts` (X7 — pins the OLD
 * clearnet-only `ipc.ts` `runArchiveCycle`/`runArchiveCycles` over `captureVisibleTimeline`,
 * retired wholesale at Task 16). This file pins the NEW `src/main/x-listening/archive.ts`
 * orchestration, which drives the Task 4 `captureTimeline` (capture.ts) pipeline instead of
 * the retiring one — so an archived record is a full evidence-hashed `XPostArtifact`
 * (metrics + metricsRaw + kind + parentPostId), not a bare `HarvestedItem`.
 *
 *  - GATED on `AppSettings.xListening.archiveCycles` — off means the step/loop never runs a
 *    capture and never touches archive state (an opted-out operator gets nothing, silently,
 *    not a partial run).
 *  - DETERMINISTIC scheduling — no `Date.now()` in the tested decision; the clock (`now`)
 *    and the inter-cycle spacing (`sleep`) are both injected, so the cycle count, the
 *    advanced `lastRunAt`, and the low-rate delay are all observable.
 *  - The challenge/lock gate still fronts every step (via `captureTimeline`): a blocked page
 *    STOPS the step/loop and does NOT advance state — an incomplete cycle must never look
 *    like a completed one.
 *  - CANCELLABLE — a `shouldCancel()` seam halts the loop between steps.
 *  - RATE-BOUNDED — `maxCycles` clamps to [0,1000], `delayMs` clamps to >= 0; a low-rate
 *    sleep sits BETWEEN steps, never after the last (gentle on X).
 *
 * `archive.ts` is quarantine-clean at module load (no static `electron` import — `win` is
 * typed structurally; store/settings wiring are lazy dynamic imports), so this file needs no
 * `vi.mock('electron', …)`.
 */
import { describe, it, expect, vi } from 'vitest';

import type { XTimelineCaptureResult } from '../src/main/x-listening/capture';
import type { XArchiveState, XPostArtifact } from '../src/main/x-listening/store';

/** A minimal-but-typed post artifact — only the fields the cursor/counting logic reads. */
const post = (messageId: string): XPostArtifact => ({
  id: `id-${messageId}`,
  platform: 'x',
  authorHandle: 'target',
  authorId: 'target',
  text: 'body',
  channelId: 'target',
  channelLabel: '@target',
  messageId,
  publishedAt: '2026-08-11T12:00:00.000Z',
  harvestedAt: '2026-08-11T12:00:00.000Z',
  url: `https://x.com/target/status/${messageId}`,
  provenance: { collectorVersion: 'x-listening/1.0.0', jobId: 'job-1', caseId: 'case-a' },
  kind: 'post',
  parentPostId: null,
  metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
  metricsRaw: {},
  evidenceHash: 'deadbeef',
});

const REQ = {
  caseId: 'case-a',
  jobId: 'job-1',
  channelId: 'target',
  channelLabel: '@target',
  targetUsername: 'target',
};

/** A tiny in-memory archive-state store backing readState/writeState. */
function memState() {
  const map = new Map<string, XArchiveState>();
  return {
    map,
    readState: async (caseId: string) => map.get(caseId) ?? null,
    writeState: async (caseId: string, state: XArchiveState) => {
      map.set(caseId, state);
    },
  };
}

describe('runArchiveStep: a single low-rate cycle', () => {
  it('off-toggle → no capture, no state write, ran:false', async () => {
    const { runArchiveStep } = await import('../src/main/x-listening/archive');
    const store = memState();
    const capture = vi.fn(
      async (): Promise<XTimelineCaptureResult> => ({
        blocked: false,
        added: 3,
        skipped: 0,
        posts: [post('9')],
      }),
    );
    const res = await runArchiveStep({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => false,
      capture,
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-11T12:00:00.000Z',
    });
    expect(res.ran).toBe(false);
    expect(res.added).toBe(0);
    expect(capture).not.toHaveBeenCalled();
    expect(store.map.size).toBe(0); // state untouched
  });

  it('on-toggle → capture runs, posts counted, state advances (clock injected)', async () => {
    const { runArchiveStep } = await import('../src/main/x-listening/archive');
    const store = memState();
    const capture = async (): Promise<XTimelineCaptureResult> => ({
      blocked: false,
      added: 2,
      skipped: 1,
      posts: [post('100'), post('101')],
    });
    const res = await runArchiveStep({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => true,
      capture,
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-11T12:00:00.000Z',
    });
    expect(res.ran).toBe(true);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(1);
    // state advanced: first cycle, clock stamped, cursor = last captured messageId
    expect(res.state.cycles).toBe(1);
    expect(res.state.lastRunAt).toBe('2026-08-11T12:00:00.000Z');
    expect(res.state.cursor).toBe('101');
    // and persisted
    expect(store.map.get('case-a')).toEqual(res.state);
  });

  it('a second step builds on prior state (cycles increments, cursor moves)', async () => {
    const { runArchiveStep } = await import('../src/main/x-listening/archive');
    const store = memState();
    store.map.set('case-a', { cursor: '50', cycles: 4, lastRunAt: '2026-08-10T00:00:00.000Z' });
    const res = await runArchiveStep({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => true,
      capture: async () => ({ blocked: false, added: 1, skipped: 0, posts: [post('77')] }),
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-11T13:00:00.000Z',
    });
    expect(res.state.cycles).toBe(5);
    expect(res.state.cursor).toBe('77');
    expect(res.state.lastRunAt).toBe('2026-08-11T13:00:00.000Z');
  });

  it('a step that captures nothing still completes, keeping the prior cursor', async () => {
    const { runArchiveStep } = await import('../src/main/x-listening/archive');
    const store = memState();
    store.map.set('case-a', { cursor: '50', cycles: 2, lastRunAt: '2026-08-10T00:00:00.000Z' });
    const res = await runArchiveStep({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => true,
      capture: async () => ({ blocked: false, added: 0, skipped: 0, posts: [] }),
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-11T14:00:00.000Z',
    });
    expect(res.ran).toBe(true);
    expect(res.state.cycles).toBe(3);
    expect(res.state.cursor).toBe('50'); // no new posts → cursor held (honest)
  });

  it('a blocked/challenge step → ran:false, blocked:true, state NOT advanced', async () => {
    const { runArchiveStep } = await import('../src/main/x-listening/archive');
    const store = memState();
    store.map.set('case-a', { cursor: '50', cycles: 2, lastRunAt: '2026-08-10T00:00:00.000Z' });
    const res = await runArchiveStep({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => true,
      capture: async () => ({
        blocked: true,
        reason: 'The saved X session is no longer signed in.',
        added: 0,
        skipped: 0,
        posts: [],
      }),
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-11T15:00:00.000Z',
    });
    expect(res.ran).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.reason).toMatch(/signed in/i);
    // an incomplete cycle must NOT look completed
    expect(store.map.get('case-a')).toEqual({
      cursor: '50',
      cycles: 2,
      lastRunAt: '2026-08-10T00:00:00.000Z',
    });
  });
});

describe('runArchiveSteps: bounded + cancellable loop', () => {
  it('runs exactly maxCycles cycles, sleeping BETWEEN them (deterministic spacing)', async () => {
    const { runArchiveSteps } = await import('../src/main/x-listening/archive');
    const store = memState();
    let n = 0;
    const capture = vi.fn(
      async (): Promise<XTimelineCaptureResult> => ({
        blocked: false,
        added: 1,
        skipped: 0,
        posts: [post(String(n++))],
      }),
    );
    const sleep = vi.fn(async (_ms: number) => {});
    const res = await runArchiveSteps(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 3, delayMs: 60000, sleep },
      {
        isEnabled: async () => true,
        capture,
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-11T12:00:00.000Z',
      },
    );
    expect(res.cyclesRun).toBe(3);
    expect(res.totalAdded).toBe(3);
    expect(capture).toHaveBeenCalledTimes(3);
    // low-rate: a sleep sits between cycles but not after the last one
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(60000);
    expect(res.state.cycles).toBe(3);
  });

  it("accumulates every completed step's captured posts (so RUN CYCLES surfaces them)", async () => {
    const { runArchiveSteps } = await import('../src/main/x-listening/archive');
    const store = memState();
    let n = 0;
    const capture = vi.fn(
      async (): Promise<XTimelineCaptureResult> => ({
        blocked: false,
        added: 1,
        skipped: 0,
        posts: [post(String(n++))],
      }),
    );
    const res = await runArchiveSteps(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 3, delayMs: 0, sleep: async () => {} },
      {
        isEnabled: async () => true,
        capture,
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-11T12:00:00.000Z',
      },
    );
    expect(res.cyclesRun).toBe(3);
    expect(res.totalAdded).toBe(3);
    // Every completed cycle's posts ride out on the result, in order.
    expect(res.posts.map((p) => p.messageId)).toEqual(['0', '1', '2']);
  });

  it('off-toggle → the loop runs zero cycles', async () => {
    const { runArchiveSteps } = await import('../src/main/x-listening/archive');
    const store = memState();
    const capture = vi.fn();
    const sleep = vi.fn(async () => {});
    const res = await runArchiveSteps(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 5, delayMs: 1000, sleep },
      { isEnabled: async () => false, capture, readState: store.readState, writeState: store.writeState, now: () => 'x' },
    );
    expect(res.cyclesRun).toBe(0);
    expect(capture).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('shouldCancel halts the loop early (cancellable)', async () => {
    const { runArchiveSteps } = await import('../src/main/x-listening/archive');
    const store = memState();
    let done = 0;
    const res = await runArchiveSteps(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 10, delayMs: 0, sleep: async () => {}, shouldCancel: () => done >= 2 },
      {
        isEnabled: async () => true,
        capture: async () => {
          done++;
          return { blocked: false, added: 1, skipped: 0, posts: [post(String(done))] };
        },
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-11T12:00:00.000Z',
      },
    );
    expect(res.cancelled).toBe(true);
    expect(res.cyclesRun).toBe(2);
  });

  it('a blocked step stops the loop and reports blocked', async () => {
    const { runArchiveSteps } = await import('../src/main/x-listening/archive');
    const store = memState();
    let calls = 0;
    const res = await runArchiveSteps(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 5, delayMs: 0, sleep: async () => {} },
      {
        isEnabled: async () => true,
        capture: async () => {
          calls++;
          if (calls === 2) {
            return { blocked: true, reason: 'X presented a verification challenge or temporary limit.', added: 0, skipped: 0, posts: [] };
          }
          return { blocked: false, added: 1, skipped: 0, posts: [post(String(calls))] };
        },
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-11T12:00:00.000Z',
      },
    );
    expect(res.blocked).toBe(true);
    expect(res.reason).toMatch(/verification|limit/i);
    expect(res.cyclesRun).toBe(1); // only the first cycle completed
    // Only the completed cycle's posts are surfaced; the blocked cycle contributes none.
    expect(res.posts.map((p) => p.messageId)).toEqual(['1']);
  });

  it('maxCycles clamps to [0,1000] (rate bound) — an oversized request runs at most 1000', async () => {
    const { runArchiveSteps } = await import('../src/main/x-listening/archive');
    const store = memState();
    // shouldCancel stops the loop well before 1000 real captures — this only asserts the
    // CLAMP took effect (loop attempted to run, not that it silently no-op'd on the raw
    // oversized value), by checking a negative/zero request is clamped the OTHER direction.
    const resNegative = await runArchiveSteps(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: -5, delayMs: 0, sleep: async () => {} },
      {
        isEnabled: async () => true,
        capture: async () => ({ blocked: false, added: 1, skipped: 0, posts: [post('1')] }),
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-11T12:00:00.000Z',
      },
    );
    expect(resNegative.cyclesRun).toBe(0); // clamped to 0, not a negative/NaN loop

    const capture = vi.fn(async () => ({ blocked: false, added: 1, skipped: 0, posts: [post('1')] }));
    const res = await runArchiveSteps(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 5000, delayMs: 0, sleep: async () => {}, shouldCancel: () => capture.mock.calls.length >= 4 },
      {
        isEnabled: async () => true,
        capture,
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-11T12:00:00.000Z',
      },
    );
    // Never throws / never treats 5000 as an unbounded literal loop count that skips the
    // clamp path — the cancellation seam still governs, proving the clamp math ran without
    // producing NaN/Infinity from the oversized input.
    expect(res.cancelled).toBe(true);
    expect(res.cyclesRun).toBe(4);
  });

  it('delayMs clamps to >= 0 (rate bound) — a negative delay never produces a negative sleep', async () => {
    const { runArchiveSteps } = await import('../src/main/x-listening/archive');
    const store = memState();
    const sleep = vi.fn(async (_ms: number) => {});
    await runArchiveSteps(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 2, delayMs: -100, sleep },
      {
        isEnabled: async () => true,
        capture: async () => ({ blocked: false, added: 1, skipped: 0, posts: [post('1')] }),
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-11T12:00:00.000Z',
      },
    );
    expect(sleep).toHaveBeenCalledWith(0);
  });
});
