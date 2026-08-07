/**
 * Task TG2 — Telegram member intelligence (visible group/channel members).
 *
 * Plan B ports GhostExodus's Telegram Hunter member scan onto the Plan-A hardened
 * window + the encrypted per-tool `members` artifact store. These tests pin the
 * honesty-critical guarantees on PURE functions plus the settle-before-scrape seam —
 * no electron, no network:
 *
 *  1. `TG_MEMBER_SCRIPT` is a STATIC in-page payload — its un-evaluated source holds
 *     NO `${…}` interpolation (scraped content can never be spliced into executed
 *     code) and NO in-page `fetch()` (unlike the source, which fetched avatar blobs
 *     unrestricted; the port returns the avatar SRC for host-restricted resolution in
 *     the collector). Ported from quarantine `renderer.js` `extractionScript` member loop.
 *  2. `normalizeMember` maps a captured member UserCell → a `TgMember`, honest by
 *     construction: the visible display name is stored ONLY when shown and is NEVER
 *     backfilled from the @handle (the source's `||username||'Telegram member'` fallback
 *     is DROPPED); the avatar is admitted ONLY as a local `data:` thumbnail; the phone
 *     is stored ONLY when visible to this account; the profile permalink is scheme-guarded
 *     to Telegram hosts.
 *  3. `captureMembers` SETTLES (async-SPA render wait) BEFORE the static scrape, routes
 *     through the challenge/lock gate (a locked / signed-out page yields NOTHING), and
 *     reports ONLY the visible members captured — it NEVER fabricates a group total
 *     (Telegram hides the real subscriber/member count).
 *
 * extract.ts + collector.ts + store.ts are quarantine-clean: this file imports them
 * WITHOUT mocking electron, proving none pulls in the electron graph at load.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TG_MEMBER_SCRIPT,
  normalizeMember,
  type RawMember,
} from '../src/main/socmint/telegram-hunter/extract';
import {
  captureMembers,
  TG_COLLECTOR_VERSION,
  type TgMemberCaptureRequest,
  type TgMemberCaptureDeps,
} from '../src/main/socmint/telegram-hunter/collector';
import { makeTgHunterStore, type TgMember, type TgHunterStoreDeps } from '../src/main/socmint/telegram-hunter/store';

/** Read the un-evaluated body of a `` export const NAME = `…` `` static-script template. */
function scriptSourceBody(relPath: string, name: string): string {
  const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
  const m = source.match(new RegExp('const ' + name + '\\s*=\\s*`([\\s\\S]*?)`'));
  if (!m) throw new Error(`static script ${name} not found in ${relPath}`);
  return m[1];
}

const rawMember = (o: Partial<RawMember> = {}): RawMember => ({
  username: '@alice_op',
  displayName: 'Alice Ops',
  phone: '',
  status: 'last seen recently',
  links: [],
  context: 'Operators Group',
  profileUrl: 'https://t.me/alice_op',
  avatar: 'data:image/png;base64,BBBB',
  ...o,
});

const CAP_AT = '2026-08-07T12:00:00.000Z';

// ---- 1. static payload, no interpolation, no fetch ----------------------

describe('TG_MEMBER_SCRIPT: static, no interpolation, no in-page fetch', () => {
  it('is a non-empty string', () => {
    expect(typeof TG_MEMBER_SCRIPT).toBe('string');
    expect(TG_MEMBER_SCRIPT.length).toBeGreaterThan(0);
  });

  it('contains NO `${` interpolation (scraped content can never be spliced in)', () => {
    const body = scriptSourceBody('src/main/socmint/telegram-hunter/extract.ts', 'TG_MEMBER_SCRIPT');
    expect(body).not.toContain('${');
    // A distinctive selector proves the scanned source template is the exported one.
    expect(body).toContain('participant');
    expect(TG_MEMBER_SCRIPT).toContain('participant');
  });

  it('does NOT fetch remote media in-page (no unrestricted remote inlining)', () => {
    expect(TG_MEMBER_SCRIPT).not.toContain('fetch(');
  });
});

// ---- 2. normalizeMember (pure honesty core) -----------------------------

describe('normalizeMember: captured UserCell → TgMember', () => {
  it('stores the visible display name honestly and NEVER falls back to the @handle', () => {
    // visible display name → stored as-is
    const named = normalizeMember(rawMember({ displayName: 'Alice Ops' }), { capturedAt: CAP_AT });
    expect(named.displayName).toBe('Alice Ops');
    expect(named.handle).toBe('@alice_op');

    // NO display name visible → displayName ABSENT, never backfilled from the handle
    const anon = normalizeMember(rawMember({ displayName: '' }), { capturedAt: CAP_AT });
    expect(anon.displayName).toBeUndefined();
    expect(anon.handle).toBe('@alice_op');

    // a displayName that IS just the handle is NOT stored (the source's fallback, refused)
    const echoed = normalizeMember(rawMember({ displayName: '@alice_op' }), { capturedAt: CAP_AT });
    expect(echoed.displayName).toBeUndefined();

    // Case-MISMATCHED echo: handles are case-insensitive, so "ALICE_OP" / "@Alice_OP" against
    // "@alice_op" is the SAME identity echoed — a case-sensitive guard would fabricate a
    // display name. The compare must be case-folded.
    const echoCIbare = normalizeMember(rawMember({ displayName: 'ALICE_OP' }), { capturedAt: CAP_AT });
    expect(echoCIbare.displayName).toBeUndefined();
    const echoCIat = normalizeMember(rawMember({ displayName: '@Alice_OP' }), { capturedAt: CAP_AT });
    expect(echoCIat.displayName).toBeUndefined();
  });

  it('admits an avatar ONLY as a local data: thumbnail — a remote URL is dropped', () => {
    const kept = normalizeMember(rawMember({ avatar: 'data:image/png;base64,BBBB' }), { capturedAt: CAP_AT });
    expect(kept.avatar).toBe('data:image/png;base64,BBBB');

    const remote = normalizeMember(rawMember({ avatar: 'https://web.telegram.org/a/x.jpg' }), { capturedAt: CAP_AT });
    expect(remote.avatar).toBeUndefined();
    expect(remote.avatar ?? '').not.toMatch(/^https?:/);
  });

  it('stores the phone ONLY when visible to this account', () => {
    const shown = normalizeMember(rawMember({ phone: '+1 555 010 1234' }), { capturedAt: CAP_AT });
    expect(shown.phone).toBe('+1 555 010 1234');

    const hidden = normalizeMember(rawMember({ phone: '' }), { capturedAt: CAP_AT });
    expect(hidden.phone).toBeUndefined();
  });

  it('scheme-guards the profile permalink to Telegram hosts', () => {
    const ok = normalizeMember(rawMember({ profileUrl: 'https://t.me/alice_op' }), { capturedAt: CAP_AT });
    expect(ok.profileUrl).toBe('https://t.me/alice_op');

    const offDomain = normalizeMember(rawMember({ profileUrl: 'https://evil.example/alice_op' }), { capturedAt: CAP_AT });
    expect(offDomain.profileUrl).toBeUndefined();
  });

  it('carries the visible status + chat context and the injected capturedAt clock', () => {
    const m = normalizeMember(rawMember({ status: 'admin · online', context: 'Operators Group' }), { capturedAt: CAP_AT });
    expect(m.status).toBe('admin · online');
    expect(m.context).toBe('Operators Group');
    expect(m.capturedAt).toBe(CAP_AT);
  });
});

// ---- 3. captureMembers: settle + gate + no fabricated total -------------

const WIN = {} as unknown as Electron.BrowserWindow;
const REQ: TgMemberCaptureRequest = { caseId: 'case-a' };

function mdeps(over: Partial<TgMemberCaptureDeps> = {}): Partial<TgMemberCaptureDeps> {
  return {
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    settle: async () => {},
    runCapture: async () => [rawMember(), rawMember({ username: '@bob_op', displayName: 'Bob', profileUrl: 'https://t.me/bob_op' })],
    resolveMedia: async (_win, url) => (url.startsWith('data:') ? url : null),
    // Default the toggle ON so the avatar-resolution assertion exercises resolution; the
    // OFF (dormant-no-op-guard) path has its own dedicated case.
    captureMedia: true,
    saveMembers: async (_caseId, members) => ({ added: members.length, total: members.length }),
    now: () => CAP_AT,
    ...over,
  };
}

describe('captureMembers', () => {
  it('SETTLES before the static scrape (async-SPA under-capture race)', async () => {
    const order: string[] = [];
    const settle = vi.fn(async () => { order.push('settle'); });
    const runCapture = vi.fn(async () => { order.push('scrape'); return [rawMember()]; });
    await captureMembers(WIN, REQ, mdeps({ settle, runCapture }));
    expect(settle).toHaveBeenCalledWith(WIN);
    expect(order).toEqual(['settle', 'scrape']);
  });

  it('a challenge/lock gate blocks → NOTHING scraped, NOTHING persisted', async () => {
    const runCapture = vi.fn(async () => [rawMember()]);
    const saveMembers = vi.fn(async () => ({ added: 0, total: 0 }));
    const res = await captureMembers(
      WIN,
      REQ,
      mdeps({ guard: async () => ({ blocked: true, reason: 'Telegram is locked.' }), runCapture, saveMembers }),
    );
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('Telegram is locked.');
    expect(runCapture).not.toHaveBeenCalled();
    expect(saveMembers).not.toHaveBeenCalled();
    expect(res.members).toEqual([]);
    expect(res.captured).toBe(0);
  });

  it('reports ONLY the visible members captured — NEVER a fabricated group total', async () => {
    const res = await captureMembers(WIN, REQ, mdeps());
    expect(res.blocked).toBe(false);
    expect(res.members).toHaveLength(2);
    // captured == the visible rows scraped; there is no "group total" claim anywhere.
    expect(res.captured).toBe(res.members.length);
    expect(res).not.toHaveProperty('total');
    expect(res).not.toHaveProperty('groupSize');
    expect(res).not.toHaveProperty('memberCount');
    // honesty stamped through: display name kept, handle intact, capturedAt from injected clock
    expect(res.members[0].handle).toBe('@alice_op');
    expect(res.members[0].capturedAt).toBe(CAP_AT);
  });

  it('resolves member media host-restricted → data: only, dropping an unresolved remote avatar', async () => {
    const res = await captureMembers(
      WIN,
      REQ,
      mdeps({
        runCapture: async () => [rawMember({ avatar: 'https://web.telegram.org/a/x.jpg' })],
        resolveMedia: async () => null,
      }),
    );
    expect(res.blocked).toBe(false);
    expect(res.members).toHaveLength(1);
    expect(res.members[0].avatar).toBeUndefined();
    expect(res.members[0].avatar ?? '').not.toMatch(/^https?:/);
  });

  it('captureMedia:false → NO media resolution runs and NO member avatar is stored, even a data: one', async () => {
    const resolveMedia = vi.fn(async () => 'data:image/png;base64,ZZZZ');
    const res = await captureMembers(
      WIN,
      REQ,
      mdeps({
        runCapture: async () => [rawMember({ avatar: 'data:image/png;base64,BBBB' })],
        resolveMedia,
        captureMedia: false,
      }),
    );
    expect(res.blocked).toBe(false);
    expect(res.members).toHaveLength(1);
    expect(resolveMedia).not.toHaveBeenCalled();
    expect(res.members[0].avatar).toBeUndefined();
  });

  it('captureMedia:true → a remote member avatar IS resolved host-restricted to a data: thumbnail', async () => {
    const resolveMedia = vi.fn(async (_win: unknown, url: string) =>
      url.startsWith('https://web.telegram.org/') ? 'data:image/png;base64,RESOLVED' : null,
    );
    const res = await captureMembers(
      WIN,
      REQ,
      mdeps({
        runCapture: async () => [rawMember({ avatar: 'https://web.telegram.org/a/x.jpg' })],
        resolveMedia,
        captureMedia: true,
      }),
    );
    expect(resolveMedia).toHaveBeenCalledTimes(1);
    expect(res.members[0].avatar).toBe('data:image/png;base64,RESOLVED');
    expect(res.members[0].avatar ?? '').not.toMatch(/^https?:/);
  });

  it('persists via the injected members store and surfaces the added count', async () => {
    const saved: TgMember[] = [];
    const res = await captureMembers(
      WIN,
      REQ,
      mdeps({
        saveMembers: async (_caseId, members) => { saved.push(...members); return { added: members.length, total: members.length }; },
      }),
    );
    expect(res.added).toBe(2);
    expect(saved.map((m) => m.handle)).toEqual(['@alice_op', '@bob_op']);
    // the collector version stamped, not accepted from the renderer
    expect(TG_COLLECTOR_VERSION).toBe('telegram-hunter/1.0.0');
  });
});

// ---- 4. store: members.saveMany batch upsert (added/total, deduped) ------

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
    keywordWatchPath: (caseId) => `tg/${caseId}/tg-keyword-watch.json`,
    importsPath: (caseId) => `tg/${caseId}/tg-imports.json`,
    dedupPath: (caseId) => `tg/${caseId}/tg-dedup.json`,
  };
}

describe('members.saveMany: batch upsert reports added + total, dedups', () => {
  it('adds new members, dedups re-seen ones, and reports honest counts', async () => {
    const s = makeTgHunterStore(memDeps());
    const a: TgMember = { handle: '@a', displayName: 'Alice', context: 'grp', capturedAt: CAP_AT };
    const b: TgMember = { handle: '@b', context: 'grp', capturedAt: CAP_AT };

    const first = await s.members.saveMany('case-a', [a, b]);
    expect(first).toEqual({ added: 2, total: 2 });

    // re-seen a + a genuinely new c → 1 added, total 3
    const c: TgMember = { handle: '@c', displayName: 'Carol', context: 'grp', capturedAt: CAP_AT };
    const second = await s.members.saveMany('case-a', [a, c]);
    expect(second).toEqual({ added: 1, total: 3 });

    const got = await s.members.read('case-a');
    expect(got.map((m) => m.handle)).toEqual(['@a', '@b', '@c']);
    expect(got[1].displayName).toBeUndefined(); // never backfilled from @handle
  });
});
