/**
 * X7 — Low-rate archive cycles.
 *
 * A bounded, cancellable low-rate archive loop that repeatedly runs the X3/X4
 * visible-timeline capture and advances a resumable `XArchiveState`, ported from
 * the quarantine incremental-archive path (`electron/main.cjs:757-848`,
 * `runArchiveCycle` + `restartArchiveTimer`) but hardened for Ghost Intel:
 *
 *  - GATED on `AppSettings.xListening.archiveCycles` — off means the loop never
 *    runs a capture and never touches archive state (honest: an opted-out operator
 *    gets nothing, silently, not a partial run).
 *  - DETERMINISTIC scheduling — no `Date.now()` in the tested decision. The clock
 *    (`now`) and the inter-cycle spacing (`sleep`) are BOTH injected, so the cycle
 *    count, the advanced `lastRunAt`, and the low-rate delay are all observable.
 *  - The challenge-refusal gate still fronts every cycle (via `captureVisibleTimeline`):
 *    a rate-limit / verification interstitial STOPS the loop and does NOT advance
 *    state — an incomplete cycle must not look like a completed one.
 *  - CANCELLABLE — a `shouldCancel()` seam halts the loop between cycles.
 *
 * These tests drive the orchestration directly (electron minimally mocked so
 * importing ipc.ts is side-effect free), the same seam-injection style X4 used.
 */
import { describe, it, expect, vi } from 'vitest';

import type {
  TimelineCaptureResult,
  CaptureRequest,
} from '../src/main/x-listening/ipc';
import type { XArchiveState } from '../src/main/x-listening/store';
import type { XHarvestedItem } from '../src/main/x-listening/extract';

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
}));

// A minimal stand-in item — only the fields the archive cursor/append logic reads.
const item = (messageId: string): XHarvestedItem =>
  ({
    id: `id-${messageId}`,
    platform: 'x',
    messageId,
    channelId: 'target',
    text: 'body',
    kind: 'post',
    verified: false,
    captureProvenance: 'visible-capture',
    media: [],
    metrics: {
      replies: { raw: '', value: 0, approx: false },
      reposts: { raw: '', value: 0, approx: false },
      likes: { raw: '', value: 0, approx: false },
      views: { raw: '', value: 0, approx: false },
    },
  }) as unknown as XHarvestedItem;

const REQ = {
  caseId: 'case-a',
  jobId: 'job-1',
  channelId: 'target',
  channelLabel: '@target',
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

describe('runArchiveCycle: a single low-rate cycle', () => {
  it('off-toggle → no capture, no state write, ran:false', async () => {
    const { runArchiveCycle } = await import('../src/main/x-listening/ipc');
    const store = memState();
    const capture = vi.fn(
      async (): Promise<TimelineCaptureResult> => ({
        blocked: false,
        added: 3,
        skipped: 0,
        items: [item('9')],
      }),
    );
    const res = await runArchiveCycle({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => false,
      capture,
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-06T12:00:00.000Z',
    });
    expect(res.ran).toBe(false);
    expect(res.added).toBe(0);
    expect(capture).not.toHaveBeenCalled();
    expect(store.map.size).toBe(0); // state untouched
  });

  it('on-toggle → capture runs, items counted, state advances (clock injected)', async () => {
    const { runArchiveCycle } = await import('../src/main/x-listening/ipc');
    const store = memState();
    const capture = async (): Promise<TimelineCaptureResult> => ({
      blocked: false,
      added: 2,
      skipped: 1,
      items: [item('100'), item('101')],
    });
    const res = await runArchiveCycle({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => true,
      capture,
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-06T12:00:00.000Z',
    });
    expect(res.ran).toBe(true);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(1);
    // state advanced: first cycle, clock stamped, cursor = last captured messageId
    expect(res.state.cycles).toBe(1);
    expect(res.state.lastRunAt).toBe('2026-08-06T12:00:00.000Z');
    expect(res.state.cursor).toBe('101');
    // and persisted
    expect(store.map.get('case-a')).toEqual(res.state);
  });

  it('a second cycle builds on prior state (cycles increments, cursor moves)', async () => {
    const { runArchiveCycle } = await import('../src/main/x-listening/ipc');
    const store = memState();
    store.map.set('case-a', { cursor: '50', cycles: 4, lastRunAt: '2026-08-06T00:00:00.000Z' });
    const res = await runArchiveCycle({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => true,
      capture: async () => ({ blocked: false, added: 1, skipped: 0, items: [item('77')] }),
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-06T13:00:00.000Z',
    });
    expect(res.state.cycles).toBe(5);
    expect(res.state.cursor).toBe('77');
    expect(res.state.lastRunAt).toBe('2026-08-06T13:00:00.000Z');
  });

  it('a cycle that captures nothing still completes, keeping the prior cursor', async () => {
    const { runArchiveCycle } = await import('../src/main/x-listening/ipc');
    const store = memState();
    store.map.set('case-a', { cursor: '50', cycles: 2, lastRunAt: '2026-08-06T00:00:00.000Z' });
    const res = await runArchiveCycle({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => true,
      capture: async () => ({ blocked: false, added: 0, skipped: 0, items: [] }),
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-06T14:00:00.000Z',
    });
    expect(res.ran).toBe(true);
    expect(res.state.cycles).toBe(3);
    expect(res.state.cursor).toBe('50'); // no new items → cursor held (honest)
  });

  it('challenge blocks the cycle → ran:false, blocked:true, state NOT advanced', async () => {
    const { runArchiveCycle } = await import('../src/main/x-listening/ipc');
    const store = memState();
    store.map.set('case-a', { cursor: '50', cycles: 2, lastRunAt: '2026-08-06T00:00:00.000Z' });
    const res = await runArchiveCycle({} as unknown as Electron.BrowserWindow, REQ, {
      isEnabled: async () => true,
      capture: async () => ({
        blocked: true,
        reason: 'X presented a verification challenge or temporary limit.',
        added: 0,
        skipped: 0,
        items: [],
      }),
      readState: store.readState,
      writeState: store.writeState,
      now: () => '2026-08-06T15:00:00.000Z',
    });
    expect(res.ran).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.reason).toMatch(/verification|limit/i);
    // an incomplete cycle must NOT look completed
    expect(store.map.get('case-a')).toEqual({
      cursor: '50',
      cycles: 2,
      lastRunAt: '2026-08-06T00:00:00.000Z',
    });
  });
});

describe('runArchiveCycles: bounded + cancellable loop', () => {
  it('runs exactly maxCycles cycles, sleeping BETWEEN them (deterministic spacing)', async () => {
    const { runArchiveCycles } = await import('../src/main/x-listening/ipc');
    const store = memState();
    let n = 0;
    const capture = vi.fn(
      async (): Promise<TimelineCaptureResult> => ({
        blocked: false,
        added: 1,
        skipped: 0,
        items: [item(String(n++))],
      }),
    );
    const sleep = vi.fn(async (_ms: number) => {});
    const res = await runArchiveCycles(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 3, delayMs: 60000, sleep },
      {
        isEnabled: async () => true,
        capture,
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-06T12:00:00.000Z',
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

  it('accumulates every completed cycle\'s captured items (so RUN CYCLES can surface them like RUN ONE CYCLE)', async () => {
    const { runArchiveCycles } = await import('../src/main/x-listening/ipc');
    const store = memState();
    let n = 0;
    const capture = vi.fn(
      async (): Promise<TimelineCaptureResult> => ({
        blocked: false,
        added: 1,
        skipped: 0,
        items: [item(String(n++))],
      }),
    );
    const res = await runArchiveCycles(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 3, delayMs: 0, sleep: async () => {} },
      {
        isEnabled: async () => true,
        capture,
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    expect(res.cyclesRun).toBe(3);
    expect(res.totalAdded).toBe(3);
    // Every completed cycle's items ride out on the result, in order.
    expect(res.items.map((i) => i.messageId)).toEqual(['0', '1', '2']);
  });

  it('off-toggle → the loop runs zero cycles', async () => {
    const { runArchiveCycles } = await import('../src/main/x-listening/ipc');
    const store = memState();
    const capture = vi.fn();
    const sleep = vi.fn(async () => {});
    const res = await runArchiveCycles(
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
    const { runArchiveCycles } = await import('../src/main/x-listening/ipc');
    const store = memState();
    let done = 0;
    const res = await runArchiveCycles(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 10, delayMs: 0, sleep: async () => {}, shouldCancel: () => done >= 2 },
      {
        isEnabled: async () => true,
        capture: async () => {
          done++;
          return { blocked: false, added: 1, skipped: 0, items: [item(String(done))] };
        },
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    expect(res.cancelled).toBe(true);
    expect(res.cyclesRun).toBe(2);
  });

  it('a blocked cycle stops the loop and reports blocked', async () => {
    const { runArchiveCycles } = await import('../src/main/x-listening/ipc');
    const store = memState();
    let calls = 0;
    const res = await runArchiveCycles(
      {} as unknown as Electron.BrowserWindow,
      REQ,
      { maxCycles: 5, delayMs: 0, sleep: async () => {} },
      {
        isEnabled: async () => true,
        capture: async () => {
          calls++;
          if (calls === 2) {
            return { blocked: true, reason: 'rate limit exceeded', added: 0, skipped: 0, items: [] };
          }
          return { blocked: false, added: 1, skipped: 0, items: [item(String(calls))] };
        },
        readState: store.readState,
        writeState: store.writeState,
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    expect(res.blocked).toBe(true);
    expect(res.reason).toMatch(/rate limit/i);
    expect(res.cyclesRun).toBe(1); // only the first cycle completed
    // Only the completed cycle's items are surfaced; the blocked cycle contributes none.
    expect(res.items.map((i) => i.messageId)).toEqual(['1']);
  });
});
