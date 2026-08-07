/**
 * TG1 — Telegram message capture → HarvestedItem (pure extract + settle orchestration).
 *
 * Plan B ports GhostExodus's Telegram Hunter message capture onto the Plan-A
 * hardened-window foundation. These tests pin the honesty-critical guarantees on
 * PURE functions plus the settle-before-scrape seam — no electron, no network:
 *
 *  1. `TG_MESSAGE_SCRIPT` is a STATIC in-page payload — its un-evaluated source
 *     template holds NO `${…}` interpolation, so scraped/attacker-controlled
 *     content can never be spliced into the code the capture window executes
 *     (ported from quarantine `renderer.js` `extractionScript`).
 *  2. `normalizeMessage` maps a captured-DOM message row → a `HarvestedItem`
 *     stamped `verified:false` + `captureProvenance:'visible-capture'`, preserves
 *     the message text VERBATIM (escaping is a render/export concern, done by
 *     `escapeField`, not baked into storage), admits an avatar ONLY as a local
 *     `data:` thumbnail (a remote URL is DROPPED — the beacon/no-remote-inlining
 *     rule), records the visible display name honestly (NEVER the @handle), and
 *     scheme-guards the visible profile permalink to Telegram hosts.
 *  3. `captureVisibleMessages` SETTLES (the async-SPA render wait) AFTER any
 *     navigate and BEFORE the static scrape — Telegram Web is client-rendered, so
 *     a scrape fired immediately under-captures — and it routes through a
 *     challenge/lock gate that captures/persists NOTHING on a blocked page.
 *
 * extract.ts + collector.ts are quarantine-clean: this file imports them WITHOUT
 * mocking electron, proving neither module pulls in the electron graph at load.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TG_MESSAGE_SCRIPT,
  normalizeMessage,
  guardTelegramUrl,
  type RawMessage,
  type TgNormalizeContext,
} from '../src/main/socmint/telegram-hunter/extract';
import {
  captureVisibleMessages,
  TG_COLLECTOR_VERSION,
  type TgCaptureRequest,
  type TgMessageCaptureDeps,
} from '../src/main/socmint/telegram-hunter/collector';
import { escapeField } from '../src/main/capture/security';

/**
 * The SOURCE body of a `` export const NAME = `…` `` static-script template literal,
 * read off disk. The RUNTIME value can never contain `${…}` (a template literal
 * resolves substitutions at evaluation time), so `SCRIPT.includes('${')` is vacuous;
 * guarding the un-evaluated source is what actually catches a regression that splices
 * scraped content into the payload.
 */
function scriptSourceBody(relPath: string, name: string): string {
  const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
  const m = source.match(new RegExp('const ' + name + '\\s*=\\s*`([\\s\\S]*?)`'));
  if (!m) throw new Error(`static script ${name} not found in ${relPath}`);
  return m[1];
}

const CTX: TgNormalizeContext = {
  caseId: 'case-a',
  jobId: 'job-1',
  collectorVersion: 'telegram-hunter/1.0.0',
  harvestedAt: '2026-08-07T12:00:00.000Z',
  channelId: 'Operators Group',
  channelLabel: 'Operators Group',
};

const rawMessage = (o: Partial<RawMessage> = {}): RawMessage => ({
  chat: 'Operators Group',
  author: 'Jane Doe',
  authorUsername: '@jane_op',
  authorProfileUrl: 'https://t.me/jane_op',
  timestamp: 'Aug 7 at 11:59',
  text: 'Visible message — <script>alert(1)</script> & more https://t.me/joinchat/xyz',
  links: ['https://t.me/joinchat/xyz'],
  avatar: 'data:image/png;base64,AAAA',
  eventType: '',
  messageId: 'msg-42',
  ...o,
});

// ---- 1. static payload, no interpolation -------------------------------

describe('TG_MESSAGE_SCRIPT: static, no interpolation', () => {
  it('is a non-empty string', () => {
    expect(typeof TG_MESSAGE_SCRIPT).toBe('string');
    expect(TG_MESSAGE_SCRIPT.length).toBeGreaterThan(0);
  });

  it('contains NO `${` interpolation (scraped content can never be spliced in)', () => {
    const body = scriptSourceBody(
      'src/main/socmint/telegram-hunter/extract.ts',
      'TG_MESSAGE_SCRIPT',
    );
    expect(body).not.toContain('${');
    // The runtime constant is the same static payload (a distinctive selector proves
    // the scanned source template is the one actually exported).
    expect(body).toContain('data-message-id');
    expect(TG_MESSAGE_SCRIPT).toContain('data-message-id');
  });

  it('does NOT fetch remote media in-page (no unrestricted remote inlining)', () => {
    // The source `extractionScript` fetched avatar blobs in-page with no host
    // restriction; the port returns the avatar SRC and defers host-restricted
    // resolution to the collector — so the static payload must contain no fetch().
    expect(TG_MESSAGE_SCRIPT).not.toContain('fetch(');
  });
});

// ---- 2. normalizeMessage (pure honesty core) ---------------------------

describe('normalizeMessage: captured DOM → HarvestedItem', () => {
  it('stamps the honesty markers (verified:false, visible-capture, telegram)', () => {
    const item = normalizeMessage(rawMessage(), CTX);
    expect(item.verified).toBe(false);
    expect(item.captureProvenance).toBe('visible-capture');
    expect(item.platform).toBe('telegram');
  });

  it('preserves the message text VERBATIM (escaping is a render concern)', () => {
    const item = normalizeMessage(rawMessage(), CTX);
    expect(item.text).toBe(
      'Visible message — <script>alert(1)</script> & more https://t.me/joinchat/xyz',
    );
    // …and escapeField renders it safe on the way OUT, not in storage.
    expect(escapeField(item.text)).toContain('&lt;script&gt;');
    expect(escapeField(item.text)).not.toContain('<script>');
  });

  it('admits an avatar ONLY as a local data: thumbnail — a remote URL is dropped', () => {
    const kept = normalizeMessage(rawMessage({ avatar: 'data:image/png;base64,AAAA' }), CTX);
    expect(kept.avatar).toBe('data:image/png;base64,AAAA');

    const remote = normalizeMessage(
      rawMessage({ avatar: 'https://web.telegram.org/a/avatar.jpg' }),
      CTX,
    );
    expect(remote.avatar).toBeUndefined();
    // no stored media field may ever be a remote URL (beacon guard)
    expect(remote.avatar ?? '').not.toMatch(/^https?:/);
  });

  it('records the visible display name honestly and NEVER falls back to the @handle', () => {
    // display name visible → stored as-is
    const named = normalizeMessage(rawMessage({ author: 'Jane Doe' }), CTX);
    expect(named.authorDisplay).toBe('Jane Doe');
    expect(named.authorHandle).toBe('@jane_op');

    // NO display name visible → authorDisplay ABSENT, never backfilled from the handle
    const anon = normalizeMessage(rawMessage({ author: '' }), CTX);
    expect(anon.authorDisplay).toBeUndefined();
    expect(anon.authorHandle).toBe('@jane_op');
  });

  it('SUPPRESSES a display name that is merely an echo of the @handle (parity with member/profile)', () => {
    // The visible "sender" is just the handle, with the @ — not a real name. Storing it as
    // authorDisplay would fake a distinct display name. normalizeProfile/normalizeMember
    // already drop this echo; normalizeMessage must too.
    const echoAt = normalizeMessage(rawMessage({ author: '@jane_op' }), CTX);
    expect(echoAt.authorDisplay).toBeUndefined();
    expect(echoAt.authorHandle).toBe('@jane_op');

    // …and the bare handle (no @) is equally an echo, not a display name.
    const echoBare = normalizeMessage(rawMessage({ author: 'jane_op' }), CTX);
    expect(echoBare.authorDisplay).toBeUndefined();

    // A genuinely distinct name is still kept.
    const real = normalizeMessage(rawMessage({ author: 'Jane Doe' }), CTX);
    expect(real.authorDisplay).toBe('Jane Doe');
  });

  it('scheme-guards the visible profile permalink to Telegram hosts', () => {
    const item = normalizeMessage(rawMessage({ authorProfileUrl: 'https://t.me/jane_op' }), CTX);
    expect(item.url).toBe('https://t.me/jane_op');

    const offDomain = normalizeMessage(
      rawMessage({ authorProfileUrl: 'https://evil.example/jane_op' }),
      CTX,
    );
    expect(offDomain.url).toBe('');
  });

  it('carries links, event type, and case/channel provenance', () => {
    const item = normalizeMessage(
      rawMessage({ links: ['https://t.me/joinchat/xyz'], eventType: 'SERVICE EVENT' }),
      CTX,
    );
    expect(item.links).toEqual(['https://t.me/joinchat/xyz']);
    expect(item.eventType).toBe('SERVICE EVENT');
    expect(item.channelId).toBe('Operators Group');
    expect(item.channelLabel).toBe('Operators Group');
    expect(item.harvestedAt).toBe('2026-08-07T12:00:00.000Z');
    expect(item.provenance).toEqual({
      collectorVersion: 'telegram-hunter/1.0.0',
      jobId: 'job-1',
      caseId: 'case-a',
    });
  });

  it('a non-service message carries no eventType', () => {
    const item = normalizeMessage(rawMessage({ eventType: '' }), CTX);
    expect(item.eventType).toBeUndefined();
  });

  it('derives a deterministic sha256 id over telegram:channelId:messageId', () => {
    const item = normalizeMessage(rawMessage(), CTX);
    const expected = createHash('sha256')
      .update('telegram:Operators Group:msg-42', 'utf8')
      .digest('hex');
    expect(item.id).toBe(expected);
    expect(item.messageId).toBe('msg-42');
    expect(normalizeMessage(rawMessage(), CTX).id).toBe(item.id);
  });

  it('when the DOM exposes no message id, derives a deterministic content-keyed surrogate (no clock, dedup-stable)', () => {
    const a = normalizeMessage(rawMessage({ messageId: '' }), CTX);
    const b = normalizeMessage(rawMessage({ messageId: '' }), CTX);
    // deterministic: same visible content → same surrogate id (never a Date/random)
    expect(a.id).toBe(b.id);
    expect(a.messageId).toBe(b.messageId);
    // a DIFFERENT visible message → a different surrogate
    const c = normalizeMessage(rawMessage({ messageId: '', text: 'a different line' }), CTX);
    expect(c.id).not.toBe(a.id);
  });
});

// ---- guardTelegramUrl ---------------------------------------------------

describe('guardTelegramUrl', () => {
  it('admits https t.me / web.telegram.org, refuses everything else', () => {
    expect(guardTelegramUrl('https://t.me/jane_op')).toBe('https://t.me/jane_op');
    expect(guardTelegramUrl('https://web.telegram.org/k/#@jane')).toBe(
      'https://web.telegram.org/k/#@jane',
    );
    expect(guardTelegramUrl('http://t.me/jane_op')).toBe(''); // not https
    expect(guardTelegramUrl('https://evil.example/jane_op')).toBe(''); // off-domain
    expect(guardTelegramUrl('https://user:pass@t.me/jane_op')).toBe(''); // userinfo spoof
    expect(guardTelegramUrl('javascript:alert(1)')).toBe('');
    expect(guardTelegramUrl('not a url')).toBe('');
  });
});

// ---- 3. captureVisibleMessages: settle-before-scrape + challenge gate ---

const WIN = {} as unknown as Electron.BrowserWindow;

const REQ: TgCaptureRequest = {
  caseId: 'case-a',
  jobId: 'job-1',
  channelId: 'Operators Group',
  channelLabel: 'Operators Group',
};

function deps(over: Partial<TgMessageCaptureDeps> = {}): Partial<TgMessageCaptureDeps> {
  return {
    // pass-through gate: signed-in, unlocked, unchallenged
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    // Stub the async-SPA settle to a no-op so tests never incur the real wait.
    settle: async () => {},
    runCapture: async () => [rawMessage()],
    // avatar already a data: thumbnail; media resolver is a pass-through here
    resolveMedia: async (_win, url) => (url.startsWith('data:') ? url : null),
    // Default the toggle ON here so the avatar-resolution assertions below actually exercise
    // resolution; the OFF (dormant-no-op-guard) path has its own dedicated cases.
    captureMedia: true,
    saveItems: async () => ({ added: 1, skipped: 0 }),
    now: () => '2026-08-07T12:00:00.000Z',
    ...over,
  };
}

describe('captureVisibleMessages', () => {
  it('SETTLES before the static scrape (async-SPA under-capture race)', async () => {
    const order: string[] = [];
    const settle = vi.fn(async () => {
      order.push('settle');
    });
    const runCapture = vi.fn(async () => {
      order.push('scrape');
      return [rawMessage()];
    });
    await captureVisibleMessages(WIN, REQ, deps({ settle, runCapture }));
    expect(settle).toHaveBeenCalledWith(WIN);
    // settle must run BEFORE the scrape; a scrape fired first reads a not-yet-rendered SPA
    expect(order).toEqual(['settle', 'scrape']);
  });

  it('a challenge/lock gate blocks → NOTHING scraped, NOTHING persisted', async () => {
    const runCapture = vi.fn(async () => [rawMessage()]);
    const saveItems = vi.fn(async () => ({ added: 0, skipped: 0 }));
    const res = await captureVisibleMessages(
      WIN,
      REQ,
      deps({
        guard: async () => ({ blocked: true, reason: 'Telegram is locked.' }),
        runCapture,
        saveItems,
      }),
    );
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('Telegram is locked.');
    expect(runCapture).not.toHaveBeenCalled();
    expect(saveItems).not.toHaveBeenCalled();
    expect(res.items).toEqual([]);
  });

  it('resolves media host-restricted → data: only, dropping an unresolved remote avatar', async () => {
    const res = await captureVisibleMessages(
      WIN,
      REQ,
      deps({
        runCapture: async () => [rawMessage({ avatar: 'https://web.telegram.org/a/x.jpg' })],
        // resolver fails to produce a data: thumbnail → avatar must be dropped, never stored raw
        resolveMedia: async () => null,
      }),
    );
    expect(res.blocked).toBe(false);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].avatar).toBeUndefined();
    expect(res.items[0].avatar ?? '').not.toMatch(/^https?:/);
  });

  it('stamps harvestedAt from the INJECTED clock and version from the collector', async () => {
    const res = await captureVisibleMessages(WIN, REQ, deps());
    expect(res.blocked).toBe(false);
    expect(res.items[0].harvestedAt).toBe('2026-08-07T12:00:00.000Z');
    expect(res.items[0].provenance.collectorVersion).toBe(TG_COLLECTOR_VERSION);
    expect(res.added).toBe(1);
  });

  // ---- captureMedia toggle is HONORED (not a dormant no-op) --------------

  it('captureMedia:false → NO media resolution runs and NO avatar is stored, even a data: one', async () => {
    const resolveMedia = vi.fn(async () => 'data:image/png;base64,ZZZZ');
    const res = await captureVisibleMessages(
      WIN,
      REQ,
      deps({
        // an in-page data: avatar would normally be kept — with capture OFF it is dropped
        runCapture: async () => [rawMessage({ avatar: 'data:image/png;base64,AAAA' })],
        resolveMedia,
        captureMedia: false,
      }),
    );
    expect(res.blocked).toBe(false);
    expect(res.items).toHaveLength(1);
    // toggling OFF changes behavior: the resolver is never called (no media fetch)…
    expect(resolveMedia).not.toHaveBeenCalled();
    // …and nothing is stored — not even the in-page data: thumbnail.
    expect(res.items[0].avatar).toBeUndefined();
  });

  it('captureMedia:true → a remote avatar IS resolved host-restricted to a data: thumbnail', async () => {
    const resolveMedia = vi.fn(async (_win: unknown, url: string) =>
      url.startsWith('https://web.telegram.org/') ? 'data:image/png;base64,RESOLVED' : null,
    );
    const res = await captureVisibleMessages(
      WIN,
      REQ,
      deps({
        runCapture: async () => [rawMessage({ avatar: 'https://web.telegram.org/a/x.jpg' })],
        resolveMedia,
        captureMedia: true,
      }),
    );
    expect(resolveMedia).toHaveBeenCalledTimes(1);
    expect(res.items[0].avatar).toBe('data:image/png;base64,RESOLVED');
    expect(res.items[0].avatar ?? '').not.toMatch(/^https?:/);
  });
});
