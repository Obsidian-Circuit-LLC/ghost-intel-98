import { describe, it, expect, vi, beforeEach } from 'vitest';

// Task TF1 — Tor-fail-closed Telegram capture window.
//
// `openTelegramCapture(partition)` must:
//   - refuse (return {blocked:true}) and create NO window when Tor is not
//     bootstrapped — NEVER a clearnet fallback;
//   - when bootstrapped, call the Plan-A `createCaptureWindow` with the Tor
//     SOCKS proxy in `proxy.socks`, `allowHosts` = the Telegram hosts, and the
//     Telegram Web URL, then lock WebRTC on the returned webContents with
//     `disable_non_proxied_udp`;
//   - route a dead/zero SOCKS port only to the SOCKS rule (no direct egress).
//
// We mock the two collaborators (the Plan-A factory + the Tor singleton) so this
// test targets ONLY TF1's gate/wiring; the proxy-before-load ordering itself is
// owned and proven by capture-window.test.ts.

const rec = vi.hoisted(() => ({
  createCalls: [] as Array<Record<string, unknown>>,
  webrtcCalls: [] as string[],
  bootstrapped: false,
  socksPort: 9050
}));

vi.mock('../src/main/capture/capture-window', () => ({
  createCaptureWindow: vi.fn(async (opts: Record<string, unknown>) => {
    rec.createCalls.push(opts);
    return {
      webContents: {
        setWebRTCIPHandlingPolicy: (policy: string) => {
          rec.webrtcCalls.push(policy);
        }
      }
    };
  })
}));

vi.mock('../src/main/bgconn/tor-singleton', () => ({
  getBgTor: vi.fn(() => ({
    isBootstrapped: () => rec.bootstrapped,
    socksPort: () => rec.socksPort
  }))
}));

import { openTelegramCapture } from '../src/main/socmint/telegram-hunter/session';

beforeEach(() => {
  rec.createCalls = [];
  rec.webrtcCalls = [];
  rec.bootstrapped = false;
  rec.socksPort = 9050;
});

describe('openTelegramCapture — Tor fail-closed', () => {
  it('refuses and creates NO window when Tor is not bootstrapped (no clearnet fallback)', async () => {
    rec.bootstrapped = false;
    const out = await openTelegramCapture('persist:tg-hunter-default');
    expect(out).toMatchObject({ blocked: true });
    expect((out as { blocked: true; reason: string }).reason).toBeTypeOf('string');
    expect(rec.createCalls).toHaveLength(0);
    expect(rec.webrtcCalls).toHaveLength(0);
  });

  it('creates the capture window over the Tor SOCKS proxy when bootstrapped', async () => {
    rec.bootstrapped = true;
    rec.socksPort = 9151;
    const out = await openTelegramCapture('persist:tg-hunter-default');

    expect('win' in out).toBe(true);
    expect(rec.createCalls).toHaveLength(1);
    const opts = rec.createCalls[0]!;
    expect(opts.partition).toBe('persist:tg-hunter-default');
    expect(opts.url).toBe('https://web.telegram.org/k/');
    expect(opts.allowHosts).toEqual(['web.telegram.org', 't.me']);
    // The SOCKS proxy carries the Tor port; createCaptureWindow prepends socks5://.
    expect((opts.proxy as { socks: string }).socks).toContain('127.0.0.1:9151');
    expect((opts.proxy as { socks: string }).socks).not.toContain('socks5://socks5://');
  });

  it('locks WebRTC to disable_non_proxied_udp on the captured webContents', async () => {
    rec.bootstrapped = true;
    await openTelegramCapture('persist:tg-hunter-default');
    expect(rec.webrtcCalls).toEqual(['disable_non_proxied_udp']);
  });

  it('asks the factory to lock WebRTC BEFORE load via the webRTCIPHandlingPolicy option', async () => {
    // The primary anonymity fix: the policy is threaded to createCaptureWindow so it
    // is applied BEFORE loadURL (the post-return call above is a belt-and-braces
    // re-assert; on its own it would run after navigation because the factory awaits
    // loadURL). capture-window.test.ts owns the before-load ordering proof.
    rec.bootstrapped = true;
    await openTelegramCapture('persist:tg-hunter-default');
    const opts = rec.createCalls[0]!;
    expect(opts.webRTCIPHandlingPolicy).toBe('disable_non_proxied_udp');
  });

  it('routes a dead/zero SOCKS port only to the SOCKS rule (no direct)', async () => {
    rec.bootstrapped = true;
    rec.socksPort = 0;
    const out = await openTelegramCapture('persist:tg-hunter-default');
    expect('win' in out).toBe(true);
    const opts = rec.createCalls[0]!;
    // Still a SOCKS rule to the (dead) port — connection-refused, never direct.
    expect((opts.proxy as { socks: string }).socks).toBe('127.0.0.1:0');
  });
});
