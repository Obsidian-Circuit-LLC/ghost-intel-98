import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Task 6 — IPC contract expansion + `registerXListeningIpc` wiring seam test.
 *
 * Proves the Phase-1 backend (session.ts/capture.ts/campaigns.ts/analysis.ts/evidence.ts,
 * Tasks 1-5) is reachable end-to-end through the IPC boundary, mirroring the existing
 * `x-listening-connect.test.ts`/`x-listening-security.test.ts` pattern:
 *
 *  - `electron` is mocked ONLY down to `session.fromPartition` (matches
 *    `x-listening-security.test.ts`'s header rationale: ipc.ts imports `session` at module
 *    load; every assertion here is exercised through the trust boundary + light business
 *    logic, never a real BrowserWindow).
 *  - `assertTrustedSender` is the REAL implementation (not mocked) — every new channel must
 *    reject a non-`file://…/index.html` sender frame BEFORE any argument is even read (the
 *    v3.24.2 "no fail-open" lesson: a garbage/undefined payload must never let an untrusted
 *    sender slip past because arg validation threw first).
 *  - "invokable" means the handler is registered under the literal channel string AND, for a
 *    TRUSTED sender + minimal valid args, the call reaches PAST the trust boundary — it may
 *    still reject downstream (no live capture window / no real electron `app` in this unit
 *    test), but that rejection must never be the sender-check error.
 *
 * This is NOT a re-test of Task 1-5's own business-logic suites (store/evidence/analysis/
 * session/capture/campaigns already have dedicated fixture-based tests) — it is the seam: the
 * literal channel constants exist, every one is registered, and the sender check fires FIRST,
 * every time, for every new channel, matching the No-hollow-UI rule
 * ([[socmint-collect-path-wiring-v3.24.2]]).
 */

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) }
}));

import { channels } from '../src/shared/ipc-contracts';
import { registerXListeningIpc } from '../src/main/x-listening/ipc';
import { assertTrustedSender } from '../src/main/capture/capture-window';

const TRUSTED_EVENT = { senderFrame: { url: 'file:///app/index.html' } };
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://x.com/attacker' } };
const SENDER_ERROR = 'Rejected IPC from an untrusted sender frame.';

/** Models the app's real event-preserving wrapper (`register.ts` `safeHandleWithEvent`):
 *  `ipcMain.handle(channel, (_e, ...args) => fn(_e, ...args))`. Same convention as
 *  `x-listening-connect.test.ts`'s `fakeIpcMain`. */
function fakeIpcMain() {
  const registered = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const handle = (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
    registered.set(channel, (e, ...args) => fn(e, ...args));
  };
  return { registered, handle };
}

/** Invoke a registered handler, normalizing a synchronous throw and an async rejection to the
 *  same `{ok:false, error}` shape so one assertion style covers both async and sync handlers. */
async function callHandler(
  ipc: ReturnType<typeof fakeIpcMain>,
  channel: string,
  event: unknown,
  ...args: unknown[]
): Promise<{ ok: true; value: unknown } | { ok: false; error: Error }> {
  const fn = ipc.registered.get(channel);
  if (!fn) throw new Error(`channel not registered: ${channel}`);
  try {
    return { ok: true, value: await fn(event, ...args) };
  } catch (e) {
    return { ok: false, error: e as Error };
  }
}

const caseId = randomUUID();
const otherId = randomUUID();

/** channel key -> valid-shaped args for a "reaches past the trust boundary" call. */
const NEW_CHANNELS: Array<{ key: keyof typeof channels.xListening; args: unknown[] }> = [
  { key: 'openSession', args: [caseId] },
  { key: 'sessionStatus', args: [caseId] },
  { key: 'closeSession', args: [caseId] },
  {
    key: 'captureTimeline',
    args: [{ caseId, channelId: 'target', channelLabel: '@target', targetUsername: 'target' }]
  },
  { key: 'campaignsList', args: [] },
  { key: 'campaignsCreate', args: ['Test Campaign'] },
  { key: 'campaignsSwitch', args: [caseId] },
  { key: 'campaignsUpdate', args: [{ id: caseId, name: 'Renamed' }] },
  { key: 'campaignsDelete', args: [otherId] },
  { key: 'analysis', args: [caseId] },
  { key: 'health', args: [caseId] },
  { key: 'entities', args: [caseId] },
  { key: 'presetsRead', args: [caseId] },
  {
    key: 'presetsSave',
    args: [{ caseId, id: 'preset-1', name: 'Preset', keywords: ['foo'] }]
  }
];

describe('ipc-contracts.ts — Phase-1 xListening channel constants exist', () => {
  it.each(NEW_CHANNELS)('channels.xListening.$key is a non-empty xListening: string', ({ key }) => {
    const value = channels.xListening[key];
    expect(typeof value).toBe('string');
    expect(value.length).toBeGreaterThan(0);
    expect(value.startsWith('xListening:')).toBe(true);
  });

  it('every new channel string is unique (no accidental collision with the retiring X1-X8 surface)', () => {
    const all = Object.values(channels.xListening);
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });
});

describe('registerXListeningIpc — every Phase-1 channel is registered', () => {
  it.each(NEW_CHANNELS)('registers channels.xListening.$key', ({ key }) => {
    const ipc = fakeIpcMain();
    registerXListeningIpc({ handle: ipc.handle });
    expect(ipc.registered.has(channels.xListening[key])).toBe(true);
  });
});

describe('registerXListeningIpc — assertTrustedSender fires FIRST, before any arg is read', () => {
  it.each(NEW_CHANNELS)(
    'channels.xListening.$key rejects an untrusted sender even with a garbage/undefined payload',
    async ({ key }) => {
      const ipc = fakeIpcMain();
      registerXListeningIpc({ handle: ipc.handle });
      const r = await callHandler(ipc, channels.xListening[key], UNTRUSTED_EVENT, undefined);
      expect(r.ok).toBe(false);
      expect((r as { ok: false; error: Error }).error.message).toBe(SENDER_ERROR);
    }
  );

  it.each(NEW_CHANNELS)(
    'channels.xListening.$key still rejects an untrusted sender when a TRUSTED-looking value rides along as a later arg',
    async ({ key, args }) => {
      // A malicious renderer could pass a `{senderFrame:{url:'file://…/index.html'}}`-shaped
      // object as an ordinary argument, hoping a handler scans its args for something
      // trusted-looking instead of reading the genuine ipcMain-supplied first parameter. The
      // handler must reject on the REAL (untrusted) event regardless of what rides along after it.
      const ipc = fakeIpcMain();
      registerXListeningIpc({ handle: ipc.handle });
      const spoofedTrustedArg = { senderFrame: { url: 'file:///app/index.html' } };
      const r = await callHandler(ipc, channels.xListening[key], UNTRUSTED_EVENT, spoofedTrustedArg, ...args);
      expect(r.ok).toBe(false);
      expect((r as { ok: false; error: Error }).error.message).toBe(SENDER_ERROR);
    }
  );
});

describe('registerXListeningIpc — every Phase-1 channel is invokable for a trusted sender', () => {
  it.each(NEW_CHANNELS)(
    'channels.xListening.$key reaches past the trust boundary for a trusted sender + valid args',
    async ({ key, args }) => {
      const ipc = fakeIpcMain();
      registerXListeningIpc({ handle: ipc.handle });
      const r = await callHandler(ipc, channels.xListening[key], TRUSTED_EVENT, ...args);
      // Always assert (a bare `if (!r.ok)` guard asserts nothing on success — a hollow pass): a
      // trusted sender must reach PAST assertTrustedSender, so the result is NEVER a sender-boundary
      // rejection. It may still legitimately fail later for other reasons in this mocked env.
      const blockedAtTrustBoundary = r.ok === false && r.error.message === SENDER_ERROR;
      expect(blockedAtTrustBoundary).toBe(false);
    }
  );
});

describe('assertTrustedSender — sanity: the real implementation rejects a non-file origin', () => {
  it('throws on a https:// sender frame', () => {
    expect(() => assertTrustedSender(UNTRUSTED_EVENT as never)).toThrow(SENDER_ERROR);
  });
  it('accepts a file://…/index.html sender frame', () => {
    expect(() => assertTrustedSender(TRUSTED_EVENT as never)).not.toThrow();
  });
});
