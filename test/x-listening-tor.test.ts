import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task 3 — X Listening Station capture session + Tor posture.
 *
 * `connectXSession(caseId, clearnetEnabled)` mirrors `telegram-hunter/session.ts`'s
 * fail-closed Tor discipline, with ONE addition the Telegram surface doesn't have: an
 * operator-controlled clearnet escape hatch (`AppSettings.xListening.clearnet`, default
 * false). The one-time real-IP acknowledgement UX lives at the renderer settings layer
 * (Task 13, mirrors `ai.linkClearnetAcknowledged`) — by the time `clearnetEnabled` reaches
 * this module it is trusted to already reflect an acknowledged, persisted operator choice;
 * this module's own job is purely the network-posture gate:
 *
 *   - clearnetEnabled === false (Tor mode, the default): refuse (`{blocked:true}`) and open
 *     NO window when background Tor is not bootstrapped — NEVER a clearnet fallback. When
 *     bootstrapped, route through the Tor SOCKS proxy.
 *   - clearnetEnabled === true: skip the Tor gate entirely, pass NO proxy (clearnet).
 *   - EITHER mode: WebRTC is locked to `disable_non_proxied_udp` on the capture window
 *     (belt-and-braces even on the clearnet path, per the design's "WebRTC-disable stays
 *     applied regardless").
 *
 * We mock the two collaborators (the Plan-A `createCaptureWindow` factory + the Tor
 * singleton) so this test targets ONLY this module's gate/wiring — the proxy-before-load
 * ordering itself is owned and proven by capture-window.test.ts, matching the
 * tg-hunter-session.test.ts convention this file mirrors.
 */

const rec = vi.hoisted(() => ({
  createCalls: [] as Array<Record<string, unknown>>,
  webrtcCalls: [] as string[],
  bootstrapped: false,
  socksPort: 9050,
  cookieQuery: null as Record<string, unknown> | null,
  cookies: [] as Array<{ name: string; value: string; domain: string }>
}));

vi.mock('../src/main/capture/capture-window', () => ({
  createCaptureWindow: vi.fn(async (opts: Record<string, unknown>) => {
    rec.createCalls.push(opts);
    return {
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
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

vi.mock('electron', () => ({
  session: {
    fromPartition: vi.fn(() => ({
      cookies: {
        get: vi.fn(async (q: Record<string, unknown>) => {
          rec.cookieQuery = q;
          return rec.cookies;
        })
      }
    }))
  }
}));

import {
  connectXSession,
  getXStatus,
  clearXSession,
  X_LISTENING_PARTITION,
  X_HOME_URL,
  X_ALLOW_HOSTS,
  __resetXSessionsForTests
} from '../src/main/x-listening/session';

const CASE_A = '11111111-1111-4111-8111-111111111111';
const CASE_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  rec.createCalls = [];
  rec.webrtcCalls = [];
  rec.bootstrapped = false;
  rec.socksPort = 9050;
  rec.cookieQuery = null;
  rec.cookies = [];
  __resetXSessionsForTests();
});

describe('connectXSession — Tor-default, fail-closed', () => {
  it('refuses and creates NO window when Tor is not bootstrapped and clearnet is off', async () => {
    rec.bootstrapped = false;
    const out = await connectXSession(CASE_A, false);
    expect(out).toMatchObject({ blocked: true });
    expect((out as { blocked: true; reason: string }).reason).toBeTypeOf('string');
    expect(rec.createCalls).toHaveLength(0);
    expect(rec.webrtcCalls).toHaveLength(0);
  });

  it('opens the capture window over the Tor SOCKS proxy when bootstrapped', async () => {
    rec.bootstrapped = true;
    rec.socksPort = 9151;
    const out = await connectXSession(CASE_A, false);

    expect(out).toMatchObject({ blocked: false });
    expect(rec.createCalls).toHaveLength(1);
    const opts = rec.createCalls[0]!;
    expect(opts.partition).toBe(X_LISTENING_PARTITION);
    expect(opts.url).toBe(X_HOME_URL);
    expect(opts.allowHosts).toEqual(X_ALLOW_HOSTS);
    expect((opts.proxy as { socks: string }).socks).toContain('127.0.0.1:9151');
    expect((opts.proxy as { socks: string }).socks).not.toContain('socks5://socks5://');
  });

  it('locks WebRTC to disable_non_proxied_udp on the captured webContents (Tor mode)', async () => {
    rec.bootstrapped = true;
    await connectXSession(CASE_A, false);
    expect(rec.webrtcCalls).toContain('disable_non_proxied_udp');
  });

  it('threads webRTCIPHandlingPolicy into the factory call so it applies BEFORE load', async () => {
    // The factory (capture-window.test.ts) awaits loadURL before returning, so setting the
    // policy only on the returned webContents would land AFTER the guest's first navigation.
    // Passing it as a createCaptureWindow option is what gets it applied pre-load.
    rec.bootstrapped = true;
    await connectXSession(CASE_A, false);
    const opts = rec.createCalls[0]!;
    expect(opts.webRTCIPHandlingPolicy).toBe('disable_non_proxied_udp');
  });

  it('routes a dead/zero SOCKS port only to the SOCKS rule (no direct egress)', async () => {
    rec.bootstrapped = true;
    rec.socksPort = 0;
    await connectXSession(CASE_A, false);
    const opts = rec.createCalls[0]!;
    expect((opts.proxy as { socks: string }).socks).toBe('127.0.0.1:0');
  });

  it('MUTATION GUARD: no createCaptureWindow call is ever proxy-less while clearnet===false', async () => {
    // Exercise both the blocked and the bootstrapped branch; in EVERY call that actually
    // reaches createCaptureWindow while clearnetEnabled is false, opts.proxy must be set.
    // This is the invariant the design doc calls out explicitly: "no capture fires clearnet
    // while clearnet===false" — a regression here would silently strip Tor routing.
    rec.bootstrapped = false;
    await connectXSession(CASE_A, false);
    rec.bootstrapped = true;
    await connectXSession(CASE_B, false);

    expect(rec.createCalls).toHaveLength(1); // only the bootstrapped attempt actually opened a window
    for (const call of rec.createCalls) {
      expect(call.proxy).toBeTruthy();
      expect((call.proxy as { socks: string }).socks).toBeTypeOf('string');
    }
  });
});

describe('connectXSession — acked clearnet opt-in', () => {
  it('passes NO proxy when clearnet is enabled, even though Tor is not bootstrapped', async () => {
    rec.bootstrapped = false;
    const out = await connectXSession(CASE_A, true);
    expect(out).toMatchObject({ blocked: false });
    expect(rec.createCalls).toHaveLength(1);
    const opts = rec.createCalls[0]!;
    expect(opts.proxy).toBeUndefined();
  });

  it('still locks WebRTC to disable_non_proxied_udp on the clearnet path', async () => {
    rec.bootstrapped = false;
    await connectXSession(CASE_A, true);
    const opts = rec.createCalls[0]!;
    expect(opts.webRTCIPHandlingPolicy).toBe('disable_non_proxied_udp');
    expect(rec.webrtcCalls).toContain('disable_non_proxied_udp');
  });
});

describe('connectXSession — per-case window lifecycle', () => {
  it('reuses a live window for the same case instead of opening a second one', async () => {
    rec.bootstrapped = true;
    await connectXSession(CASE_A, false);
    await connectXSession(CASE_A, false);
    expect(rec.createCalls).toHaveLength(1);
  });

  it('opens an independent window for a different case', async () => {
    rec.bootstrapped = true;
    await connectXSession(CASE_A, false);
    await connectXSession(CASE_B, false);
    expect(rec.createCalls).toHaveLength(2);
  });

  it('rejects a non-UUID caseId before touching the capture harness', async () => {
    rec.bootstrapped = true;
    await expect(connectXSession('not-a-uuid', false)).rejects.toThrow();
    expect(rec.createCalls).toHaveLength(0);
  });
});

describe('clearXSession', () => {
  it('closes and forgets the case window; a later connect opens a fresh one', async () => {
    rec.bootstrapped = true;
    const first = await connectXSession(CASE_A, false);
    expect(first).toMatchObject({ blocked: false });
    const closed = clearXSession(CASE_A);
    expect(closed).toMatchObject({ cleared: true });

    await connectXSession(CASE_A, false);
    expect(rec.createCalls).toHaveLength(2);
  });

  it('is a harmless no-op when the case has no live window', () => {
    expect(clearXSession(CASE_A)).toMatchObject({ cleared: false });
  });

  it('rejects a non-UUID caseId', () => {
    expect(() => clearXSession('not-a-uuid')).toThrow();
  });
});

describe('AppSettings.xListening.clearnet — survives a stale persisted xListening block', () => {
  it('defaults to false and heals in when an on-disk xListening block predates the field', async () => {
    const { mergeSettings } = await import('../src/main/storage/json-fs');
    const { defaultSettings } = await import('../src/shared/types');
    const onDisk = {
      xListening: { collect: { replies: true, reposts: false, comments: false }, archiveCycles: false }
    } as unknown as Partial<typeof defaultSettings>;

    const merged = mergeSettings(defaultSettings, onDisk);

    expect(merged.xListening.clearnet).toBe(false);
    // user override kept
    expect(merged.xListening.collect.replies).toBe(true);
  });

  it('reads false directly from defaults when no on-disk xListening block is present', async () => {
    const { mergeSettings } = await import('../src/main/storage/json-fs');
    const { defaultSettings } = await import('../src/shared/types');
    const merged = mergeSettings(defaultSettings, {} as unknown as Partial<typeof defaultSettings>);
    expect(merged.xListening.clearnet).toBe(false);
  });
});

describe('getXStatus', () => {
  it('reports connected:false with no auth_token cookie on the partition', async () => {
    rec.cookies = [];
    const status = await getXStatus(CASE_A);
    expect(status.connected).toBe(false);
    expect(rec.cookieQuery).toMatchObject({ name: 'auth_token' });
  });

  it('reports connected:true when an auth_token cookie is scoped to x.com/twitter.com', async () => {
    rec.cookies = [{ name: 'auth_token', value: 'redacted-should-never-appear', domain: '.x.com' }];
    const status = await getXStatus(CASE_A);
    expect(status.connected).toBe(true);
  });

  it('never surfaces the cookie VALUE anywhere in the status result', async () => {
    rec.cookies = [{ name: 'auth_token', value: 'super-secret-token-value', domain: '.x.com' }];
    const status = await getXStatus(CASE_A);
    expect(JSON.stringify(status)).not.toContain('super-secret-token-value');
  });

  it('reports windowOpen:true only for a case with a live connected window', async () => {
    rec.bootstrapped = true;
    const before = await getXStatus(CASE_A);
    expect(before.windowOpen).toBe(false);
    await connectXSession(CASE_A, false);
    const after = await getXStatus(CASE_A);
    expect(after.windowOpen).toBe(true);
    const otherCase = await getXStatus(CASE_B);
    expect(otherCase.windowOpen).toBe(false);
  });

  it('rejects a non-UUID caseId', async () => {
    await expect(getXStatus('not-a-uuid')).rejects.toThrow();
  });
});
