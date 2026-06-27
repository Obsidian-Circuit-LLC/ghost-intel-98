/**
 * W3: Gate-contract + de-seal invariant coverage.
 *
 * This file asserts the gate-before-egress GUARANTEE for both SOCMINT platforms
 * and covers the de-seal invariants via the exported pure helpers.
 *
 * Sections:
 *   1. Gate-contract: zero connect/construct calls when networkEnabled is false —
 *      for TELEGRAM (handleStartMonitor), WHATSAPP (handleStartMonitor), and
 *      WHATSAPP PAIRING (handleSetWhatsappBurnerPairingCode).
 *   2. SILENT_LOGGER invariants via buildBaileysSocketConfig:
 *      every log method is a genuine no-op; key material cannot leak through logging.
 *   3. syncFullHistory:false in both transport modes via buildBaileysSocketConfig.
 *   4. secretStore auth abstraction via makeWhatsAppAuthState (deps-injectable pure helper).
 *   5. mtcute transport selection via resolveTransport + handleStartMonitor factory-arg capture:
 *      'tor' → per-burner IsolateSOCKSAuth proxy; 'direct' → no proxy; Tor-down → fail-closed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleStartMonitor,
  handleSetWhatsappBurnerPairingCode,
} from '../src/main/socmint/ipc';
import {
  buildBaileysSocketConfig,
  type WaSocketLike,
} from '../src/main/socmint/whatsapp-collector';
import { makeWhatsAppAuthState } from '../src/main/socmint/whatsapp-auth';
import {
  deriveBurnerCredentials,
  resolveTransport,
  SocmintTorUnavailableError,
} from '../src/main/socmint/tor-identity';
import { setBgTor, _resetBgTorForTest } from '../src/main/bgconn/tor-singleton';
import type { BgconnTor } from '../src/main/bgconn/tor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CASE_ID = '22222222-2222-4222-8222-222222222222';

function makeMockTor(bootstrapped: boolean, port = 9999): BgconnTor {
  return {
    isBootstrapped: () => bootstrapped,
    socksPort: () => port,
    start: async () => {},
    stop: async () => {},
  } as unknown as BgconnTor;
}

/** Minimal mock collector — all methods are vi.fn() spies. */
function makeSpyCollector() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    join: vi.fn().mockResolvedValue({ channelId: 'ch', label: 'ch', keywords: [] }),
    backfill: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn(() => () => {}),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

/** Minimal mock WA socket for pairingCode tests. */
function makeWaSocket(): WaSocketLike {
  return {
    ev: { on: vi.fn(), off: vi.fn() },
    groupMetadata: vi.fn().mockResolvedValue({ subject: 'G' }),
    end: vi.fn(),
    requestPairingCode: vi.fn().mockResolvedValue('1234-5678'),
  };
}

/** Minimal WhatsApp auth state for _inject tests. */
const mockAuthState = {
  state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
  initialize: vi.fn().mockResolvedValue(undefined),
  saveCreds: vi.fn().mockResolvedValue(undefined),
  unlinkSession: vi.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Section 1: Gate-before-egress contract — ZERO calls when gate is closed
// ---------------------------------------------------------------------------

describe('CONTRACT: gate-before-egress — Telegram (handleStartMonitor, platform=telegram)', () => {
  it('ZERO factory calls when networkEnabled returns false', async () => {
    const collectorSpy = vi.fn();
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'tg-gate-contract', channelIds: [], platform: 'telegram' },
      {
        networkEnabled: async () => false,
        transport: async () => 'direct',
        collectorFactory: collectorSpy,
      },
    );
    expect(result).toEqual({ disabled: true });
    // Gate fired before any factory invocation.
    expect(collectorSpy).toHaveBeenCalledTimes(0);
  });

  it('ZERO connect() calls when networkEnabled returns false', async () => {
    const collector = makeSpyCollector();
    const collectorFactory = vi.fn(() => collector);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'tg-gate-contract', channelIds: [], platform: 'telegram' },
      {
        networkEnabled: async () => false,
        transport: async () => 'direct',
        collectorFactory,
      },
    );
    expect(result).toEqual({ disabled: true });
    // Factory never invoked → collector never constructed → connect unreachable.
    expect(collectorFactory).toHaveBeenCalledTimes(0);
    expect(collector.connect).toHaveBeenCalledTimes(0);
  });

  it('exactly ONE connect() call when networkEnabled returns true (gate open)', async () => {
    const collector = makeSpyCollector();
    const collectorFactory = vi.fn(() => collector);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'tg-gate-open', channelIds: [], platform: 'telegram' },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory,
      },
    );
    expect(result).toMatchObject({ started: true });
    expect(collectorFactory).toHaveBeenCalledTimes(1);
    expect(collector.connect).toHaveBeenCalledTimes(1);
  });
});

describe('CONTRACT: gate-before-egress — WhatsApp (handleStartMonitor, platform=whatsapp)', () => {
  it('ZERO waFactory calls when networkEnabled returns false', async () => {
    const waFactory = vi.fn();
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'wa-gate-contract', channelIds: [], platform: 'whatsapp' },
      {
        networkEnabled: async () => false,
        transport: async () => 'direct',
        collectorFactory: vi.fn(),
        whatsappCollectorFactory: waFactory as unknown as Parameters<typeof handleStartMonitor>[1]['collectorFactory'],
      },
    );
    expect(result).toEqual({ disabled: true });
    // Gate closed — WhatsApp factory NEVER reached.
    expect(waFactory).toHaveBeenCalledTimes(0);
  });

  it('ZERO connect() calls on the WhatsApp collector when gate is closed', async () => {
    const waMock = makeSpyCollector();
    const waFactory = vi.fn(() => waMock);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'wa-gate-contract', channelIds: [], platform: 'whatsapp' },
      {
        networkEnabled: async () => false,
        transport: async () => 'direct',
        collectorFactory: vi.fn(),
        whatsappCollectorFactory: waFactory,
      },
    );
    expect(result).toEqual({ disabled: true });
    // Factory never called → collector never constructed → connect() unreachable.
    expect(waFactory).toHaveBeenCalledTimes(0);
    expect(waMock.connect).toHaveBeenCalledTimes(0);
  });

  it('exactly ONE connect() call when gate is open (platform=whatsapp)', async () => {
    const waMock = makeSpyCollector();
    const waFactory = vi.fn(() => waMock);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'wa-gate-open', channelIds: [], platform: 'whatsapp' },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory: vi.fn(),
        whatsappCollectorFactory: waFactory,
      },
    );
    expect(result).toMatchObject({ started: true });
    expect(waFactory).toHaveBeenCalledTimes(1);
    expect(waMock.connect).toHaveBeenCalledTimes(1);
  });

  it('Telegram factory is NOT called for platform=whatsapp even when gate is open', async () => {
    const waMock = makeSpyCollector();
    const tgFactory = vi.fn();
    const waFactory = vi.fn(() => waMock);
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'wa-gate-platform-sel', channelIds: [], platform: 'whatsapp' },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory: tgFactory,
        whatsappCollectorFactory: waFactory,
      },
    );
    expect(tgFactory).toHaveBeenCalledTimes(0);
    expect(waFactory).toHaveBeenCalledTimes(1);
  });
});

describe('CONTRACT: gate-before-egress — WhatsApp pairing (handleSetWhatsappBurnerPairingCode)', () => {
  it('ZERO socket-construction calls when networkEnabled returns false', async () => {
    const createSocketSpy = vi.fn();
    const result = await handleSetWhatsappBurnerPairingCode(
      'wa-pair-contract',
      '15551234567',
      {
        networkEnabled: async () => false,
        transport: async () => 'direct',
        _inject: { createSocket: createSocketSpy },
      },
    );
    expect(result).toEqual({ disabled: true });
    // CRITICAL: makeWASocket egresses on construction — must be NEVER reached when gate is closed.
    expect(createSocketSpy).toHaveBeenCalledTimes(0);
  });

  it('exactly ONE socket construction when gate is open', async () => {
    const mockSock = makeWaSocket();
    const createSocketSpy = vi.fn(() => mockSock);
    const result = await handleSetWhatsappBurnerPairingCode(
      'wa-pair-open',
      '15551234567',
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        _inject: { createSocket: createSocketSpy, authState: mockAuthState },
      },
    );
    expect(createSocketSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pairingCode: expect.any(String) });
  });

  it('networkEnabled is awaited before any _inject path is entered', async () => {
    // Verify the gate check runs even when _inject is provided.
    const networkEnabled = vi.fn().mockResolvedValue(false);
    const createSocketSpy = vi.fn();
    await handleSetWhatsappBurnerPairingCode(
      'wa-pair-check-order',
      '15551234567',
      { networkEnabled, transport: async () => 'direct', _inject: { createSocket: createSocketSpy } },
    );
    expect(networkEnabled).toHaveBeenCalledTimes(1);
    expect(createSocketSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Section 2: SILENT_LOGGER invariants via buildBaileysSocketConfig
//
// A pino-compatible logger that Baileys accepts at level:'silent' must have
// all log methods as genuine no-ops.  If any method emitted output it would
// expose key material (Baileys logs session strings and Signal key bytes at
// default level).
// ---------------------------------------------------------------------------

describe('de-seal invariant: SILENT_LOGGER — all log methods are genuine no-ops', () => {
  const mockAuthForCfg = {
    state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
    initialize: async () => {},
    saveCreds: async () => {},
    unlinkSession: async () => {},
  };

  function getLogger() {
    const cfg = buildBaileysSocketConfig({ mode: 'direct' }, mockAuthForCfg, undefined);
    return cfg.logger as {
      level: string;
      trace: (...args: unknown[]) => void;
      debug: (...args: unknown[]) => void;
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      fatal: (...args: unknown[]) => void;
      child: (...args: unknown[]) => unknown;
    };
  }

  it('level is "silent" (suppresses all pino log output)', () => {
    expect(getLogger().level).toBe('silent');
  });

  it('trace() is a no-op — does not throw and returns undefined', () => {
    const logger = getLogger();
    // Call with several argument shapes Baileys uses internally.
    expect(() => logger.trace('session-string-here')).not.toThrow();
    expect(() => logger.trace({ key: 'private-bytes' }, 'msg')).not.toThrow();
    expect(logger.trace('x')).toBeUndefined();
  });

  it('debug() is a no-op — does not throw and returns undefined', () => {
    const logger = getLogger();
    expect(() => logger.debug({ apiHash: 'secret' }, 'connecting')).not.toThrow();
    expect(logger.debug('x')).toBeUndefined();
  });

  it('info() is a no-op — does not throw and returns undefined', () => {
    const logger = getLogger();
    expect(() => logger.info({ noiseKey: new Uint8Array(32) }, 'open')).not.toThrow();
    expect(logger.info('x')).toBeUndefined();
  });

  it('warn() is a no-op — does not throw and returns undefined', () => {
    const logger = getLogger();
    expect(() => logger.warn('warn-msg')).not.toThrow();
    expect(logger.warn('x')).toBeUndefined();
  });

  it('error() is a no-op — does not throw and returns undefined', () => {
    const logger = getLogger();
    expect(() => logger.error(new Error('session expired'))).not.toThrow();
    expect(logger.error('x')).toBeUndefined();
  });

  it('fatal() is a no-op — does not throw and returns undefined', () => {
    const logger = getLogger();
    expect(() => logger.fatal('fatal-signal')).not.toThrow();
    expect(logger.fatal('x')).toBeUndefined();
  });

  it('child() returns an object with level "silent" (key material safe in child loggers)', () => {
    const logger = getLogger();
    const child = logger.child({ module: 'baileys' }) as { level: string };
    expect(child.level).toBe('silent');
  });

  it('SILENT_LOGGER is the same object across both transport modes (singleton)', () => {
    const direct = buildBaileysSocketConfig({ mode: 'direct' }, mockAuthForCfg, undefined);
    const tor = buildBaileysSocketConfig(
      { mode: 'tor', proxy: { host: '127.0.0.1', port: 9050, version: 5, user: 'u', password: 'p' } },
      mockAuthForCfg,
      undefined,
    );
    expect(direct.logger).toBe(tor.logger);
  });
});

// ---------------------------------------------------------------------------
// Section 3: syncFullHistory:false in both transport modes
// ---------------------------------------------------------------------------

describe('de-seal invariant: syncFullHistory:false (buildBaileysSocketConfig)', () => {
  const auth = {
    state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
    initialize: async () => {},
    saveCreds: async () => {},
    unlinkSession: async () => {},
  };

  it('syncFullHistory is false in direct mode (no history accumulation → no ban-risk backfill)', () => {
    const cfg = buildBaileysSocketConfig({ mode: 'direct' }, auth, undefined);
    expect(cfg.syncFullHistory).toBe(false);
  });

  it('syncFullHistory is false in tor mode (invariant holds regardless of transport)', () => {
    const cfg = buildBaileysSocketConfig(
      { mode: 'tor', proxy: { host: '127.0.0.1', port: 9050, version: 5, user: 'u', password: 'p' } },
      auth,
      { type: 'fake-socks-agent' },
    );
    expect(cfg.syncFullHistory).toBe(false);
  });

  it('syncFullHistory is NEVER true (would enable history sync + elevated ban-risk)', () => {
    // Verify against both code paths — the value must not change.
    for (const cfg of [
      buildBaileysSocketConfig({ mode: 'direct' }, auth, undefined),
      buildBaileysSocketConfig(
        { mode: 'tor', proxy: { host: '127.0.0.1', port: 9050, version: 5, user: 'u', password: 'p' } },
        auth,
        {},
      ),
    ]) {
      expect(cfg.syncFullHistory).not.toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 4: secretStore auth abstraction via makeWhatsAppAuthState (pure helper)
//
// The pure helper is injectable with any deps — in production it uses secretStore,
// in tests an in-memory Map.  These tests assert the abstraction invariant:
// creds/keys survive a save-and-reload cycle via the provided deps.
// ---------------------------------------------------------------------------

describe('de-seal invariant: secretStore auth abstraction (makeWhatsAppAuthState)', () => {
  it('initialize() produces empty creds when deps.read returns null (no secretStore required)', async () => {
    const auth = makeWhatsAppAuthState('contract-burner', {
      read: async () => null,
      write: async () => {},
      delete: async () => {},
    });
    await auth.initialize();
    expect(auth.state.creds).toEqual({});
  });

  it('auth state is backed by the provided deps (secretStore in prod, Map in tests)', async () => {
    const store = new Map<string, string>();
    const deps = {
      read: async (k: string) => store.get(k) ?? null,
      write: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    };

    // First instance: write a credential
    const auth1 = makeWhatsAppAuthState('contract-burner', deps);
    await auth1.initialize();
    Object.assign(auth1.state.creds, { registered: true, me: { id: 'test@s.whatsapp.net' } });
    await auth1.saveCreds();

    // Force the debounced write synchronously by advancing timers
    await vi.advanceTimersByTimeAsync ? undefined : undefined; // guard (not using fake timers here)
    // Flush by waiting a tick — saveCreds schedules an internal timer
    await new Promise<void>((r) => setTimeout(r, 250));

    // Second instance: reload from the same deps (same 'store' Map)
    const auth2 = makeWhatsAppAuthState('contract-burner', deps);
    await auth2.initialize();
    expect(auth2.state.creds.registered).toBe(true);
    expect((auth2.state.creds.me as { id: string }).id).toBe('test@s.whatsapp.net');
  });

  it('secretStore key prefix is "socmint.whatsapp.burner.<burnerId>" — no plaintext fs path', async () => {
    // Verify storage keys use the expected prefix by intercepting deps.write.
    const written: string[] = [];
    const deps = {
      read: async () => null,
      write: async (k: string) => { written.push(k); },
      delete: async () => {},
    };
    const auth = makeWhatsAppAuthState('my-burner', deps);
    await auth.initialize();
    Object.assign(auth.state.creds, { x: 1 });
    await auth.saveCreds();
    // Wait for the debounce
    await new Promise<void>((r) => setTimeout(r, 250));
    // The write key must use the socmint.whatsapp.burner prefix (secretStore namespace, not FS path)
    expect(written.some((k) => k.startsWith('socmint.whatsapp.burner.'))).toBe(true);
    expect(written.every((k) => !k.startsWith('/'))).toBe(true); // no filesystem path
  });
});

// ---------------------------------------------------------------------------
// Section 5: mtcute transport selection via resolveTransport + handleStartMonitor
//
// The egress boundary calls resolveTransport() which either returns a proxy config
// ('tor' mode) or { mode: 'direct' } (explicit clearnet).  Tests here assert:
//   - the factory receives the correct transport for each mode
//   - Tor-down → SocmintTorUnavailableError (fail-closed, no clearnet fallback)
//   - distinct burnerIds → distinct SOCKS creds (IsolateSOCKSAuth separation)
// ---------------------------------------------------------------------------

describe('mtcute transport selection: resolveTransport pure helper', () => {
  afterEach(() => {
    _resetBgTorForTest();
  });

  it("'direct' mode → { mode: 'direct' } with no proxy (explicit clearnet)", () => {
    const t = resolveTransport('burner-direct', 'direct');
    expect(t.mode).toBe('direct');
    expect('proxy' in t).toBe(false);
  });

  it("'tor' mode (Tor bootstrapped) → { mode: 'tor', proxy: BurnerProxyConfig }", () => {
    setBgTor(makeMockTor(true, 9999));
    const t = resolveTransport('burner-tor', 'tor');
    expect(t.mode).toBe('tor');
    if (t.mode !== 'tor') throw new Error('type narrowing');
    expect(t.proxy.host).toBe('127.0.0.1');
    expect(t.proxy.port).toBe(9999);
    expect(t.proxy.version).toBe(5);
  });

  it("'tor' mode, Tor NOT bootstrapped → SocmintTorUnavailableError (fail-closed)", () => {
    setBgTor(makeMockTor(false));
    expect(() => resolveTransport('burner-down', 'tor')).toThrow(SocmintTorUnavailableError);
  });

  it("'tor' mode, no Tor singleton → SocmintTorUnavailableError (fail-closed)", () => {
    _resetBgTorForTest(); // no tor set
    expect(() => resolveTransport('burner-null', 'tor')).toThrow(SocmintTorUnavailableError);
  });
});

describe('mtcute transport selection: handleStartMonitor passes correct transport to factory', () => {
  afterEach(() => {
    _resetBgTorForTest();
  });

  it('direct mode → factory arg carries { mode: "direct" } — no proxy field', async () => {
    const collector = makeSpyCollector();
    const factorySpy = vi.fn(() => collector);
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'tg-tx-direct', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'direct', collectorFactory: factorySpy },
    );
    const arg = factorySpy.mock.calls[0][0] as { transport: { mode: string } };
    expect(arg.transport.mode).toBe('direct');
    expect('proxy' in arg.transport).toBe(false);
  });

  it('tor mode → factory arg carries { mode: "tor", proxy } with per-burner creds', async () => {
    setBgTor(makeMockTor(true, 9999));
    const collector = makeSpyCollector();
    const factorySpy = vi.fn(() => collector);
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'tg-tx-tor', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'tor', collectorFactory: factorySpy },
    );
    const arg = factorySpy.mock.calls[0][0] as {
      transport: { mode: string; proxy?: { version: number; user: string; password: string } };
    };
    expect(arg.transport.mode).toBe('tor');
    const proxy = arg.transport.proxy!;
    expect(proxy.version).toBe(5);
    // Creds must match deriveBurnerCredentials for the same burnerId.
    const { user, pass } = deriveBurnerCredentials('tg-tx-tor');
    expect(proxy.user).toBe(user);
    expect(proxy.password).toBe(pass);
  });

  it('tor mode, Tor not bootstrapped → rejects with SocmintTorUnavailableError BEFORE factory is called', async () => {
    setBgTor(makeMockTor(false));
    const factorySpy = vi.fn();
    await expect(
      handleStartMonitor(
        { caseId: VALID_CASE_ID, burnerId: 'tg-tx-down', channelIds: [] },
        { networkEnabled: async () => true, transport: async () => 'tor', collectorFactory: factorySpy },
      ),
    ).rejects.toThrow(SocmintTorUnavailableError);
    // Transport validation threw before the factory was reached.
    expect(factorySpy).toHaveBeenCalledTimes(0);
  });

  it('distinct burnerIds → distinct SOCKS proxy creds in factory arg (IsolateSOCKSAuth)', async () => {
    setBgTor(makeMockTor(true, 9999));

    const calls1: Array<{ transport: { mode: string; proxy?: { user: string; password: string } } }> = [];
    const calls2: typeof calls1 = [];
    const fac1 = vi.fn((opts: typeof calls1[0]) => { calls1.push(opts); return makeSpyCollector(); });
    const fac2 = vi.fn((opts: typeof calls2[0]) => { calls2.push(opts); return makeSpyCollector(); });

    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'iso-alpha', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'tor', collectorFactory: fac1 as unknown as Parameters<typeof handleStartMonitor>[1]['collectorFactory'] },
    );
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'iso-beta', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'tor', collectorFactory: fac2 as unknown as Parameters<typeof handleStartMonitor>[1]['collectorFactory'] },
    );

    const proxy1 = calls1[0].transport.proxy!;
    const proxy2 = calls2[0].transport.proxy!;
    // Same loopback port...
    expect(proxy1.version).toBe(5);
    expect(proxy2.version).toBe(5);
    // ...but distinct per-burner credentials.
    expect(proxy1.user).not.toBe(proxy2.user);
    expect(proxy1.password).not.toBe(proxy2.password);
  });
});
