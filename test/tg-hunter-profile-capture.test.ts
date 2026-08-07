/**
 * Task TG3-wire — Telegram visible-profile CAPTURE + persistence (honesty-critical).
 *
 * tg-hunter-profile.test.ts pins the PURE profile normalizer + the static payload. This
 * suite pins the freshly-WIRED capture orchestrator and its encrypted `profiles` artifact
 * store — the halves that make profile capture reachable (collector method → store →
 * ipc → preload → renderer, seam-proven in tg-hunter-seam.test.tsx):
 *
 *  1. `captureProfile` SETTLES (async-SPA render wait) BEFORE the static scrape, routes
 *     through the challenge/lock gate (a locked / signed-out page yields NOTHING), reports
 *     ONLY what was captured (0 or 1 panel), and NEVER fabricates an account-creation date.
 *  2. `store.profiles.saveMany` batch-upserts, deduped by (handle, displayName, context).
 *
 * extract.ts + collector.ts + store.ts are quarantine-clean: this file imports them
 * WITHOUT mocking electron, proving none pulls in the electron graph at load.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  normalizeProfile,
  TG_ACCOUNT_CREATION_LABEL,
  type RawProfile,
} from '../src/main/socmint/telegram-hunter/extract';
import {
  captureProfile,
  type TgProfileCaptureRequest,
  type TgProfileCaptureDeps,
} from '../src/main/socmint/telegram-hunter/collector';
import {
  makeTgHunterStore,
  type TgHunterStoreDeps,
} from '../src/main/socmint/telegram-hunter/store';
import type { TgProfile } from '../src/main/socmint/telegram-hunter/extract';

const CAP_AT = '2026-08-07T12:00:00.000Z';

const rawProfile = (o: Partial<RawProfile> = {}): RawProfile => ({
  displayName: 'Alice Ops',
  username: '@alice_op',
  phone: '',
  bio: 'Operator. Signal only.',
  status: 'last seen recently',
  links: ['https://t.me/alice_op'],
  context: 'Operators Group',
  profileUrl: 'https://t.me/alice_op',
  avatar: 'data:image/png;base64,BBBB',
  ...o,
});

const WIN = {} as unknown as Electron.BrowserWindow;
const REQ: TgProfileCaptureRequest = { caseId: 'case-a' };

function pdeps(over: Partial<TgProfileCaptureDeps> = {}): Partial<TgProfileCaptureDeps> {
  return {
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    settle: async () => {},
    runCapture: async () => rawProfile(),
    resolveMedia: async (_win, url) => (url.startsWith('data:') ? url : null),
    captureMedia: true,
    saveProfiles: async (_caseId, profiles) => ({ added: profiles.length, total: profiles.length }),
    now: () => CAP_AT,
    ...over,
  };
}

describe('captureProfile: settle + gate + no fabricated creation date', () => {
  it('SETTLES before the static scrape (async-SPA under-capture race)', async () => {
    const order: string[] = [];
    const settle = vi.fn(async () => { order.push('settle'); });
    const runCapture = vi.fn(async () => { order.push('scrape'); return rawProfile(); });
    await captureProfile(WIN, REQ, pdeps({ settle, runCapture }));
    expect(settle).toHaveBeenCalledWith(WIN);
    expect(order).toEqual(['settle', 'scrape']);
  });

  it('a challenge/lock gate blocks → NOTHING scraped, NOTHING persisted', async () => {
    const runCapture = vi.fn(async () => rawProfile());
    const saveProfiles = vi.fn(async () => ({ added: 0, total: 0 }));
    const res = await captureProfile(
      WIN,
      REQ,
      pdeps({ guard: async () => ({ blocked: true, reason: 'Telegram is locked.' }), runCapture, saveProfiles }),
    );
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('Telegram is locked.');
    expect(runCapture).not.toHaveBeenCalled();
    expect(saveProfiles).not.toHaveBeenCalled();
    expect(res.profiles).toEqual([]);
    expect(res.captured).toBe(0);
  });

  it('captures 0 profiles when no panel is open (runCapture → null) — honest, not an error', async () => {
    const saveProfiles = vi.fn(async (_c: string, p: TgProfile[]) => ({ added: 0, total: p.length }));
    const res = await captureProfile(WIN, REQ, pdeps({ runCapture: async () => null, saveProfiles }));
    expect(res.blocked).toBe(false);
    expect(res.captured).toBe(0);
    expect(res.profiles).toEqual([]);
    // still routed to the store (with an empty batch) — never a thrown "no profile" error
    expect(saveProfiles).toHaveBeenCalledWith('case-a', []);
  });

  it('captures ONE visible profile, honesty-stamped, with a NULL account-creation date', async () => {
    const res = await captureProfile(WIN, REQ, pdeps());
    expect(res.blocked).toBe(false);
    expect(res.captured).toBe(1);
    expect(res.profiles).toHaveLength(1);
    const p = res.profiles[0];
    expect(p.handle).toBe('@alice_op');
    expect(p.displayName).toBe('Alice Ops');
    expect(p.capturedAt).toBe(CAP_AT);
    // the honesty invariant: creation date is ALWAYS null + fixed label, never fabricated
    expect(p.accountCreationDate).toBeNull();
    expect(p.accountCreationLabel).toBe(TG_ACCOUNT_CREATION_LABEL);
    // no fabricated totals/counts leaked onto the result
    expect(res).not.toHaveProperty('total');
  });

  it('captureMedia:false → NO media resolution runs and NO profile avatar is stored, even a data: one', async () => {
    const resolveMedia = vi.fn(async () => 'data:image/png;base64,ZZZZ');
    const res = await captureProfile(
      WIN,
      REQ,
      pdeps({ runCapture: async () => rawProfile({ avatar: 'data:image/png;base64,BBBB' }), resolveMedia, captureMedia: false }),
    );
    expect(res.captured).toBe(1);
    expect(resolveMedia).not.toHaveBeenCalled();
    expect(res.profiles[0].avatar).toBeUndefined();
  });

  it('captureMedia:true → a remote profile avatar IS resolved host-restricted to a data: thumbnail', async () => {
    const resolveMedia = vi.fn(async (_win: unknown, url: string) =>
      url.startsWith('https://web.telegram.org/') ? 'data:image/png;base64,RESOLVED' : null,
    );
    const res = await captureProfile(
      WIN,
      REQ,
      pdeps({ runCapture: async () => rawProfile({ avatar: 'https://web.telegram.org/a/x.jpg' }), resolveMedia, captureMedia: true }),
    );
    expect(resolveMedia).toHaveBeenCalledTimes(1);
    expect(res.profiles[0].avatar).toBe('data:image/png;base64,RESOLVED');
    expect(res.profiles[0].avatar ?? '').not.toMatch(/^https?:/);
  });

  it('drops an unresolved remote avatar (data: only) — no beacon field is stored', async () => {
    const res = await captureProfile(
      WIN,
      REQ,
      pdeps({ runCapture: async () => rawProfile({ avatar: 'https://web.telegram.org/a/x.jpg' }), resolveMedia: async () => null }),
    );
    expect(res.profiles[0].avatar).toBeUndefined();
    expect(res.profiles[0].avatar ?? '').not.toMatch(/^https?:/);
  });

  it('persists via the injected profiles store and surfaces the added count', async () => {
    const saved: TgProfile[] = [];
    const res = await captureProfile(
      WIN,
      REQ,
      pdeps({ saveProfiles: async (_c, profiles) => { saved.push(...profiles); return { added: profiles.length, total: profiles.length }; } }),
    );
    expect(res.added).toBe(1);
    expect(saved.map((p) => p.handle)).toEqual(['@alice_op']);
  });
});

// ---- store: profiles.saveMany batch upsert (added/total, deduped) --------

function memDeps(): TgHunterStoreDeps {
  const store = new Map<string, string>();
  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: ${p}`);
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    return e;
  };
  return {
    readFile: async (p) => {
      if (!store.has(p)) throw enoent(p);
      return Buffer.from(store.get(p)!, 'utf8');
    },
    writeFile: async (p, d) => { store.set(p, d); },
    membersPath: (caseId) => `tg/${caseId}/tg-members.json`,
    profilesPath: (caseId) => `tg/${caseId}/tg-profiles.json`,
    keywordWatchPath: (caseId) => `tg/${caseId}/tg-keyword-watch.json`,
    importsPath: (caseId) => `tg/${caseId}/tg-imports.json`,
    dedupPath: (caseId) => `tg/${caseId}/tg-dedup.json`,
  };
}

const prof = (o: Partial<RawProfile> = {}): TgProfile =>
  normalizeProfile(rawProfile(o), { capturedAt: CAP_AT });

describe('profiles.saveMany: batch upsert reports added + total, dedups', () => {
  it('adds new profiles, dedups re-seen ones, and reports honest counts', async () => {
    const s = makeTgHunterStore(memDeps());
    const a = prof({ username: '@a', displayName: 'Alice', context: 'grp' });
    const b = prof({ username: '@b', displayName: '', context: 'grp' });

    const first = await s.profiles.saveMany('case-a', [a, b]);
    expect(first).toEqual({ added: 2, total: 2 });

    const c = prof({ username: '@c', displayName: 'Carol', context: 'grp' });
    const second = await s.profiles.saveMany('case-a', [a, c]);
    expect(second).toEqual({ added: 1, total: 3 });

    const got = await s.profiles.read('case-a');
    expect(got.map((p) => p.handle)).toEqual(['@a', '@b', '@c']);
    // the creation date stays null through persistence — never fabricated on the way to disk
    expect(got.every((p) => p.accountCreationDate === null)).toBe(true);
  });
});
