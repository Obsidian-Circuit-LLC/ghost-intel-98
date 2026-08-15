/**
 * Ghost Social Media Manager (hardened GI98 port) — Phase 3: publishing + scheduled queue +
 * THE AUTO-POST ARM GATE + profile stats, and their IPC seam. SAFETY-CRITICAL.
 *
 * A. PublishingService (pure over injected window/clipboard/clock/arm-gate/clickPublish seams):
 *    - THE ARM GATE (G7, constraint 3 — the mandatory safety test): with `isAutoPostArmed()`
 *      FALSE, `autoPublish` NEVER invokes the injected `clickPublish` seam, opens NO window, and
 *      returns `blocked_disarmed`; with TRUE, a prepared post DOES click Publish and returns
 *      `published`. Enforced in MAIN, so a renderer bug can't publish while disarmed.
 *    - `publish` (manual Composer) PREPARES only — fills the composer and stops; NEVER clicks.
 * B. Scheduler (his v2.5 tick, deterministic — injected clock/uuid): a DUE job while disarmed is
 *    left ready (never published, no history); armed, it auto-publishes per destination and
 *    aggregates the final status + history; `runNow` always routes through the MAIN arm gate.
 * C. ProfileStatsService: opens a HIDDEN same-partition window, scrapes via the adapter, and
 *    ALWAYS closes the window — even when the adapter script throws.
 * D. Phase-3 IPC: every channel is registered AND rejects an UNTRUSTED sender frame first.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-ghost-social-phase3-test');
vi.mock('electron', () => ({
  app: { getPath: () => DATA },
  session: { fromPartition: () => ({}) },
  shell: { openExternal: async () => undefined },
  clipboard: { readText: () => '', writeText: () => undefined },
  BrowserWindow: class {},
  WebContentsView: class {},
  dialog: { showSaveDialog: async () => ({ canceled: true }) },
}));
vi.mock('../src/main/services/vault', () => ({
  isEnabledCached: () => false,
  isUnlocked: () => true,
  shouldEncrypt: () => false,
  hasMagicPrefix: () => false,
  isEncrypted: () => false,
  encryptBuffer: (b: Buffer) => b,
  decryptBuffer: (b: Buffer) => b,
}));

import { channels } from '../src/shared/ipc-contracts';
import {
  makePublishingService,
  clickPublishScript,
  type PublishingDeps,
  type PublishWindow,
  type PublishWc,
} from '../src/main/ghost-social/publishing';
import { makeScheduler, JobQueue, type SchedulerDeps } from '../src/main/ghost-social/queue';
import { makeProfileStatsService, type StatsDeps, type StatsWindow } from '../src/main/ghost-social/stats';
import { registerGhostSocialPublishingIpc } from '../src/main/ghost-social/publishing-ipc';
import { assertTrustedSender } from '../src/main/capture/capture-window';
import type { AccountLike, GhostState } from '../src/shared/ghost-social/types';
import { defaultGhostState } from '../src/main/ghost-social/store';

// ── fake publishing seams ─────────────────────────────────────────────────────
function fakeWc(overrides: Partial<PublishWc> = {}): PublishWc {
  return {
    loadURL: vi.fn(async () => undefined),
    getURL: vi.fn(() => 'https://x.com/compose/post'),
    executeJavaScript: vi.fn(async () => true), // focus/insert/verify all "succeed"
    focus: vi.fn(),
    paste: vi.fn(),
    insertText: vi.fn(),
    isDestroyed: vi.fn(() => false),
    ...overrides,
  };
}
function fakeWindow(wc: PublishWc): PublishWindow & { _destroyed: boolean } {
  const w = {
    webContents: wc,
    _destroyed: false,
    show: vi.fn(),
    destroy: vi.fn(function (this: { _destroyed: boolean }) {
      this._destroyed = true;
    }),
    isDestroyed(this: { _destroyed: boolean }) {
      return this._destroyed;
    },
  };
  return w as unknown as PublishWindow & { _destroyed: boolean };
}

const X_ACCOUNT: AccountLike = { id: 'a1', platform: 'x', name: 'X acct', url: 'https://x.com/' };

function pubDeps(
  armed: boolean,
  clickPublish = vi.fn(async () => true),
  createWindow?: PublishingDeps['createWindow'],
): { deps: PublishingDeps; clickPublish: ReturnType<typeof vi.fn>; created: PublishWindow[] } {
  const created: PublishWindow[] = [];
  const deps: PublishingDeps = {
    partitionFor: (c, a) => `persist:ghost-${c}-${a}`,
    createWindow:
      createWindow ??
      (() => {
        const w = fakeWindow(fakeWc());
        created.push(w);
        return w;
      }),
    clipboard: { readText: () => '', writeText: () => undefined },
    sleep: async () => undefined, // no real delays in tests
    isAutoPostArmed: async () => armed,
    clickPublish,
  };
  return { deps, clickPublish, created };
}

describe('ghost-social publishing — THE AUTO-POST ARM GATE (G7, safety-critical)', () => {
  it('DISARMED: autoPublish never clicks Publish, opens no window, returns blocked_disarmed', async () => {
    const { deps, clickPublish, created } = pubDeps(false);
    const svc = makePublishingService(deps);
    const r = await svc.autoPublish('c1', X_ACCOUNT, { text: 'hello world' });
    expect(r.status).toBe('blocked_disarmed');
    expect(clickPublish).not.toHaveBeenCalled(); // the injected clickPublish seam was NEVER called
    expect(created).toHaveLength(0); // no live account window was ever opened while disarmed
  });

  it('ARMED: autoPublish prepares then clicks Publish once and returns published', async () => {
    const { deps, clickPublish, created } = pubDeps(true);
    const svc = makePublishingService(deps);
    const r = await svc.autoPublish('c1', X_ACCOUNT, { text: 'hello world' });
    expect(r.status).toBe('published');
    expect(clickPublish).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    // Hidden auto-publish window is torn down after (finally).
    expect((created[0] as unknown as { _destroyed: boolean })._destroyed).toBe(true);
  });

  it('ARMED but no enabled Publish button ⇒ failed (not published), window still closed', async () => {
    const click = vi.fn(async () => false);
    const { deps, created } = pubDeps(true, click);
    const svc = makePublishingService(deps);
    const r = await svc.autoPublish('c1', X_ACCOUNT, { text: 'hello world' });
    expect(r.status).toBe('failed');
    expect((created[0] as unknown as { _destroyed: boolean })._destroyed).toBe(true);
  });

  it('autoPublish enforces his content guards BEFORE the gate matters (messenger/text/media)', async () => {
    const { deps, clickPublish } = pubDeps(true);
    const svc = makePublishingService(deps);
    expect((await svc.autoPublish('c1', { ...X_ACCOUNT, platform: 'messenger' }, { text: 'x' })).status).toBe(
      'unsupported',
    );
    expect((await svc.autoPublish('c1', X_ACCOUNT, { text: '   ' })).status).toBe('unsupported');
    expect(
      (await svc.autoPublish('c1', { ...X_ACCOUNT, platform: 'instagram' }, { text: 'x' })).status,
    ).toBe('unsupported'); // instagram requires media for an auto-post
    expect(clickPublish).not.toHaveBeenCalled();
  });
});

describe('ghost-social publishing — manual publish is PREPARE-ONLY', () => {
  it('publish fills the composer, shows the window, and NEVER clicks Publish', async () => {
    const wc = fakeWc();
    const win = fakeWindow(wc);
    const { deps, clickPublish } = pubDeps(true, vi.fn(async () => true), () => win);
    const svc = makePublishingService(deps);
    const r = await svc.publish('c1', X_ACCOUNT, { text: 'draft tweet' });
    expect(r.status).toBe('prepared');
    expect(win.show).toHaveBeenCalledTimes(1); // shown for human review
    expect(clickPublish).not.toHaveBeenCalled(); // prepare-only: the human clicks Publish
    expect(/Publish\/Post button/i.test(r.message)).toBe(true);
  });

  it('clickPublishScript is his verbatim per-platform Publish-button clicker', () => {
    const s = clickPublishScript('x');
    expect(s).toContain('data-testid="tweetButton"');
    expect(clickPublishScript('bluesky')).toContain('Publish');
  });
});

// ── scheduler ─────────────────────────────────────────────────────────────────
function schedState(scheduledFor: string): GhostState {
  const s = defaultGhostState();
  s.campaigns[0].accounts = [
    {
      id: 'a1',
      platform: 'x',
      name: 'X acct',
      url: 'https://x.com/',
      enabled: true,
      capabilities: { text: true, image: true, video: true, messages: true, comments: true },
    },
  ];
  s.scheduledPosts = [
    {
      id: 'job1',
      campaignId: 'campaign-default',
      text: 'scheduled tweet',
      scheduledFor,
      destinationAccountIds: ['a1'],
      status: 'scheduled',
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    },
  ];
  return s;
}

function schedDeps(
  initial: GhostState,
  opts: { armed: boolean; now: number; autoPublish?: SchedulerDeps['autoPublish'] },
): { deps: SchedulerDeps; state: { current: GhostState }; autoPublish: ReturnType<typeof vi.fn> } {
  const state = { current: initial };
  const autoPublish =
    (opts.autoPublish as ReturnType<typeof vi.fn>) ??
    vi.fn(async () =>
      opts.armed
        ? { status: 'published' as const, message: 'sent' }
        : { status: 'blocked_disarmed' as const, message: 'disarmed' },
    );
  const deps: SchedulerDeps = {
    getState: async () => state.current,
    saveState: async (s) => {
      state.current = s as GhostState;
      return state.current;
    },
    autoPublish,
    isArmed: async () => opts.armed,
    now: () => opts.now,
    uuid: () => 'fixed-uuid',
  };
  return { deps, state, autoPublish };
}

describe('ghost-social scheduler — the v2.5 due-tick, arm-gated & deterministic', () => {
  const DUE = '2026-08-15T00:00:00.000Z';
  const NOW = Date.parse('2026-08-15T01:00:00.000Z'); // one hour after due

  it('DISARMED: a due tick publishes nothing and leaves the job scheduled (ready)', async () => {
    const { deps, state, autoPublish } = schedDeps(schedState(DUE), { armed: false, now: NOW });
    const sched = makeScheduler(deps);
    const res = await sched.processDue();
    expect(res.ran).toBe(false);
    expect(res.disarmed).toBe(true);
    expect(autoPublish).not.toHaveBeenCalled(); // background tick short-circuits while disarmed
    expect(state.current.scheduledPosts![0].status).toBe('scheduled'); // still ready
    expect(state.current.postHistory).toHaveLength(0);
  });

  it('ARMED: a due tick auto-publishes the job and records complete + history', async () => {
    const { deps, state, autoPublish } = schedDeps(schedState(DUE), { armed: true, now: NOW });
    const sched = makeScheduler(deps);
    const res = await sched.processDue();
    expect(res.ran).toBe(true);
    expect(autoPublish).toHaveBeenCalledTimes(1);
    expect(state.current.scheduledPosts![0].status).toBe('complete');
    expect(state.current.scheduledPosts![0].results!['a1'].status).toBe('published');
    expect(state.current.postHistory).toHaveLength(1);
    expect(state.current.postHistory[0].id).toBe('fixed-uuid'); // deterministic id
  });

  it('a NOT-yet-due job is not run even when armed', async () => {
    const future = '2026-08-16T00:00:00.000Z';
    const { deps, autoPublish } = schedDeps(schedState(future), { armed: true, now: NOW });
    const sched = makeScheduler(deps);
    const res = await sched.processDue();
    expect(res.ran).toBe(false);
    expect(autoPublish).not.toHaveBeenCalled();
  });

  it('runNow always routes through the MAIN arm gate: a disarmed autoPublish leaves the job ready', async () => {
    // Even if the scheduler is asked to run explicitly, the authoritative gate lives in autoPublish:
    // a blocked_disarmed result must NOT mark the job failed — it stays scheduled (waiting to arm).
    const autoPublish = vi.fn(async () => ({ status: 'blocked_disarmed' as const, message: 'disarmed' }));
    const { deps, state } = schedDeps(schedState(DUE), { armed: true, now: NOW, autoPublish });
    const sched = makeScheduler(deps);
    const res = await sched.runNow('job1');
    expect(autoPublish).toHaveBeenCalledTimes(1);
    expect(res.ran).toBe(false);
    expect(res.disarmed).toBe(true);
    expect(state.current.scheduledPosts![0].status).toBe('scheduled');
    expect(state.current.postHistory).toHaveLength(0);
  });

  it('armed runNow with a mix of destinations aggregates partial', async () => {
    const s = schedState(DUE);
    s.campaigns[0].accounts.push({
      id: 'a2',
      platform: 'bluesky',
      name: 'bsky',
      url: 'https://bsky.app/',
      enabled: true,
      capabilities: { text: true, image: true, video: true, messages: true, comments: true },
    });
    s.scheduledPosts![0].destinationAccountIds = ['a1', 'a2'];
    const autoPublish = vi.fn(async (_c: string, account: AccountLike) =>
      account.id === 'a1'
        ? { status: 'published' as const, message: 'ok' }
        : { status: 'failed' as const, message: 'no button' },
    );
    const { deps, state } = schedDeps(s, { armed: true, now: NOW, autoPublish });
    const sched = makeScheduler(deps);
    await sched.runNow('job1');
    expect(state.current.scheduledPosts![0].status).toBe('partial');
  });

  it('JobQueue tracks a job through running → complete deterministically', async () => {
    const q = new JobQueue({ now: () => Date.parse('2026-08-15T00:00:00.000Z'), uuid: () => 'j-1' });
    const { job, result } = await q.run('publish', { accountId: 'a1', platform: 'x' }, async () => 42);
    expect(result).toBe(42);
    expect(job.status).toBe('complete');
    expect(job.id).toBe('j-1');
    expect(q.list()[0].status).toBe('complete');
  });

  it('JobQueue marks a throwing job failed and rethrows', async () => {
    const q = new JobQueue({ now: () => 0, uuid: () => 'j-2' });
    await expect(
      q.run('publish', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(q.list()[0].status).toBe('failed');
    expect(q.list()[0].error).toBe('boom');
  });
});

// ── profile stats ─────────────────────────────────────────────────────────────
function fakeStatsWindow(exec: (script: string) => Promise<unknown>): StatsWindow & { _destroyed: boolean } {
  const w = {
    _destroyed: false,
    webContents: {
      loadURL: vi.fn(async () => undefined),
      getURL: vi.fn(() => 'https://x.com/someuser'),
      executeJavaScript: vi.fn(exec),
    },
    destroy: vi.fn(function (this: { _destroyed: boolean }) {
      this._destroyed = true;
    }),
    isDestroyed(this: { _destroyed: boolean }) {
      return this._destroyed;
    },
  };
  return w as unknown as StatsWindow & { _destroyed: boolean };
}

function statsDeps(win: StatsWindow): { deps: StatsDeps; created: StatsWindow[] } {
  const created: StatsWindow[] = [];
  const deps: StatsDeps = {
    partitionFor: (c, a) => `persist:ghost-${c}-${a}`,
    createWindow: () => {
      created.push(win);
      return win;
    },
    sleep: async () => undefined,
  };
  return { deps, created };
}

describe('ghost-social profile stats — hidden window ALWAYS closed', () => {
  const ACCT: AccountLike = { id: 'a1', platform: 'x', name: 'X', url: 'https://x.com/', username: 'someuser' };

  it('reads follower/following via the adapter and closes the hidden window', async () => {
    const win = fakeStatsWindow(async () => ({ followers: '1,234', following: '56' }));
    const { deps, created } = statsDeps(win);
    const svc = makeProfileStatsService(deps);
    const stats = await svc.refresh('c1', ACCT);
    expect(stats.followers).toBe(1234);
    expect(stats.following).toBe(56);
    expect((created[0] as unknown as { _destroyed: boolean })._destroyed).toBe(true);
  });

  it('closes the hidden window even when the adapter script THROWS (finally)', async () => {
    const win = fakeStatsWindow(async () => {
      throw new Error('adapter blew up');
    });
    const { deps, created } = statsDeps(win);
    const svc = makeProfileStatsService(deps);
    const stats = await svc.refresh('c1', ACCT);
    expect(stats.status).toBe('error');
    expect((created[0] as unknown as { _destroyed: boolean })._destroyed).toBe(true); // ALWAYS closed
  });
});

// ── Phase-3 IPC hardening ──────────────────────────────────────────────────────
const UNTRUSTED = { senderFrame: { url: 'https://x.com/' } } as unknown as Electron.IpcMainInvokeEvent;

describe('ghost-social Phase-3 IPC — registration + sender hardening', () => {
  function collect(): Map<string, (e: Electron.IpcMainInvokeEvent, ...a: unknown[]) => unknown> {
    const map = new Map<string, (e: Electron.IpcMainInvokeEvent, ...a: unknown[]) => unknown>();
    registerGhostSocialPublishingIpc({
      handle: (ch, fn) => map.set(ch, fn),
      getWindow: () => null,
    });
    return map;
  }

  it('registers every Phase-3 channel', () => {
    const h = collect();
    for (const ch of [
      channels.ghostSocial.publishPrepare,
      channels.ghostSocial.armGet,
      channels.ghostSocial.armSet,
      channels.ghostSocial.scheduledRunNow,
      channels.ghostSocial.scheduledProcessDue,
      channels.ghostSocial.statsRefresh,
    ]) {
      expect(h.has(ch)).toBe(true);
    }
  });

  it('every Phase-3 handler rejects an untrusted sender frame first', async () => {
    const h = collect();
    for (const [channel, fn] of h) {
      await expect(Promise.resolve().then(() => fn(UNTRUSTED)), `channel ${channel}`).rejects.toThrow(
        /untrusted sender/i,
      );
    }
  });

  it('assertTrustedSender is the real guard (sanity)', () => {
    expect(() => assertTrustedSender(UNTRUSTED)).toThrow(/untrusted sender/i);
  });
});
