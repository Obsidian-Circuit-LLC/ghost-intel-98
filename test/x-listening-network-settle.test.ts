// @vitest-environment node
/**
 * The follower/following scrape must give X time to render, and must say what it is doing.
 *
 * THE BUG THIS EXISTS TO CATCH (GhostExodus, every release since the port: "Extract Followers /
 * Following / Both is unresponsive").
 *
 * `captureNetwork` is the ONLY capture path in this module with no pacing whatsoever. The timeline
 * loop awaits `delayPerPassMs` between passes; the comment loop settles `COMMENT_THREAD_SETTLE_MS`
 * after navigating; `verifyPost` settles `VERIFY_POST_SETTLE_MS`. `XNetworkCaptureDeps` has no
 * `delay` member at all — so the scrape opened `/followers`, read the page in the same tick, and
 * scrolled and re-read as fast as the IPC round-trip allowed.
 *
 * HIS source paces it: `loadURL` → `sleep(3500)` → `assertSignedInPage` → install the collector →
 * per pass `sleep(delay)` where delay is `scrollDelayMs` clamped to [500, 5000] (main.cjs:2347+).
 *
 * The consequence is not a slow scrape, it is an EMPTY one that reports success: every read lands
 * on an unhydrated page, `seen.size` never grows, `stagnant` reaches `stagnationLimit` (default 7)
 * in milliseconds, and the run returns `{ blocked: false, observed: 0, reachedEnd: true }`. The
 * caller has nothing to report because nothing failed. That is the silence he has been describing.
 *
 * Every existing test missed it because the fake page returns its rows in the first read. A real
 * SPA does not.
 */
import { describe, expect, it } from 'vitest';
import { captureNetwork, NETWORK_SETTLE_MS, type XNetworkCaptureDeps } from '../src/main/x-listening/capture';

function fakeWindow() {
  const w = { destroyed: false, isDestroyed: () => w.destroyed, destroy: () => { w.destroyed = true; } };
  return w as unknown as Electron.BrowserWindow & { destroyed: boolean };
}

function row(username: string) {
  return { username, displayName: username, bio: '', url: `https://x.com/${username}`, avatar: '' };
}

/**
 * A page that behaves like X: nothing is in the DOM until it has had time to render. `elapsed` is
 * virtual — advanced only by the production code awaiting its `delay` seam, so the test is instant
 * and deterministic.
 */
function hydratingPage(opts: { readyAfterMs: number; rows: string[] }) {
  const state = { elapsed: 0, reads: 0, installed: 0, progress: [] as Array<{ current: number; total: number; message: string }> };
  const deps: XNetworkCaptureDeps = {
    loadClearnetEnabled: async () => false,
    resolveGate: async () => ({ blocked: false }),
    openWindow: async () => fakeWindow(),
    runCapture: async () => [],
    guard: async (_w, capture) => ({ blocked: false, result: await capture() }),
    scroll: async () => undefined,
    assertSignedIn: async () => ({ blocked: false }),
    delay: async (ms: number) => { state.elapsed += ms; },
    installCollector: async () => { state.installed += 1; },
    readCollector: async () => {
      state.reads += 1;
      const ready = state.elapsed >= opts.readyAfterMs;
      const rows = ready ? opts.rows.map(row) : [];
      return {
        rows,
        count: rows.length,
        // An UNHYDRATED page reports scrollHeight ≈ innerHeight, so `reachedEnd` is true before
        // anything has rendered — the trap the leading-empty guard exists for.
        scrollTop: 0,
        scrollHeight: ready ? 9000 : 800,
        innerHeight: 800,
      };
    },
    onProgress: (p) => { state.progress.push(p); },
    readNetwork: async () => [],
    saveNetwork: async () => opts.rows.length,
    readScanState: async () => null,
    saveScanState: async () => undefined,
    appendNetworkEvents: async () => undefined,
    recordRun: async () => undefined,
    loadCollectionSettings: async () => ({
      followerBasePasses: 8, followingBasePasses: 8, networkStagnationLimit: 7, delayPerPassMs: 1100,
    }) as never,
    now: () => '2026-09-06T12:00:00.000Z',
  } as never;
  return { deps, state };
}

const REQ = { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers' as const };

describe('the scrape waits for X to render before deciding the list is empty', () => {
  it('settles after opening the page, the way his scrapeRelationshipRows does', async () => {
    // Rows appear only once the settle has elapsed. With no settle every read is empty.
    const { deps, state } = hydratingPage({ readyAfterMs: NETWORK_SETTLE_MS, rows: ['carol', 'dave'] });
    const res = await captureNetwork(REQ, deps);

    expect(res.blocked).toBe(false);
    expect(res.observed, 'a hydrating page must not be reported as an empty follower list').toBe(2);
    expect(state.elapsed).toBeGreaterThanOrEqual(NETWORK_SETTLE_MS);
  });

  it('paces the scroll loop so X can lazy-load the next batch', async () => {
    // Rows arrive well after the initial settle — only per-pass pacing gets there.
    const { deps, state } = hydratingPage({ readyAfterMs: NETWORK_SETTLE_MS + 3000, rows: ['erin'] });
    const res = await captureNetwork(REQ, deps);

    expect(res.observed).toBe(1);
    expect(state.elapsed, 'each pass must await the campaign scroll delay').toBeGreaterThan(NETWORK_SETTLE_MS);
  });

  it('does not count leading empty reads toward the stable-end early stop', async () => {
    // The timeline loop already guards this ("don't let a slow-rendering SPA's LEADING empty reads
    // trip the stable-end early-stop"). The network loop did not, so 7 empty reads ended the scan.
    const { deps } = hydratingPage({ readyAfterMs: NETWORK_SETTLE_MS + 6600, rows: ['frank'] });
    const res = await captureNetwork(REQ, deps);
    expect(res.observed, 'six empty passes must not end the scan before anything renders').toBe(1);
  });
});

describe('the scan reports what it is doing', () => {
  it('emits per-pass progress carrying the running unique count', async () => {
    const { deps, state } = hydratingPage({ readyAfterMs: NETWORK_SETTLE_MS, rows: ['carol', 'dave'] });
    await captureNetwork(REQ, deps);

    expect(state.progress.length, 'a scan that reports nothing is indistinguishable from a dead button').toBeGreaterThan(0);
    const last = state.progress.at(-1)!;
    expect(last.total).toBeGreaterThan(0);
    expect(last.message).toMatch(/alice/);
    expect(last.message, 'the running count is how he can see it working').toMatch(/\d+\s+unique/i);
  });

  it('a scan that genuinely finds nothing still says so, without claiming a block', async () => {
    const { deps, state } = hydratingPage({ readyAfterMs: Number.MAX_SAFE_INTEGER, rows: [] });
    const res = await captureNetwork(REQ, deps);

    expect(res.blocked).toBe(false);
    expect(res.observed).toBe(0);
    expect(state.progress.at(-1)!.message).toMatch(/0 unique/i);
  });
});
