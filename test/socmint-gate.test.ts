import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleStartMonitor,
  handleStopMonitor,
  handleHasWhatsappBurner,
  handleUnlinkWhatsappBurner,
  handleSetWhatsappBurnerPairingCode,
} from '../src/main/socmint/ipc';
import { WA_SEALED_MESSAGE } from '../src/main/socmint/whatsapp-collector';
import { setBgTor, _resetBgTorForTest } from '../src/main/bgconn/tor-singleton';
import type { BgconnTor } from '../src/main/bgconn/tor';
import { SocmintTorUnavailableError, deriveBurnerCredentials } from '../src/main/socmint/tor-identity';

const VALID_CASE_ID = '11111111-1111-4111-8111-111111111111';

function makeMockTor(bootstrapped: boolean, port = 9999): BgconnTor {
  return {
    isBootstrapped: () => bootstrapped,
    socksPort: () => port,
    start: async () => {},
    stop: async () => {},
  } as unknown as BgconnTor;
}

function makeMockCollector() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    join: vi.fn(),
    backfill: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe('socmint:startMonitor gate', () => {
  it('returns { disabled: true } and never calls collectorFactory when networkEnabled is false', async () => {
    const factorySpy = vi.fn();
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-1', channelIds: [] },
      {
        networkEnabled: async () => false,
        transport: async () => 'direct',
        collectorFactory: factorySpy,
      },
    );
    expect(result).toEqual({ disabled: true });
    expect(factorySpy).not.toHaveBeenCalled();
  });

  it('calls collectorFactory and returns { started, jobId } when networkEnabled is true (direct)', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-1', channelIds: [] },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory: factorySpy,
      },
    );
    expect(factorySpy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ started: true, jobId: expect.any(String) });
  });
});

describe('socmint:startMonitor — transport: tor with Tor down', () => {
  beforeEach(() => {
    setBgTor(makeMockTor(false));
  });

  afterEach(() => {
    _resetBgTorForTest();
  });

  it('rejects with SocmintTorUnavailableError when transport=tor and Tor is not bootstrapped', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    await expect(
      handleStartMonitor(
        { caseId: VALID_CASE_ID, burnerId: 'burner-tor', channelIds: [] },
        {
          networkEnabled: async () => true,
          transport: async () => 'tor',
          collectorFactory: factorySpy,
        },
      ),
    ).rejects.toThrow(SocmintTorUnavailableError);
    // Factory must not be called — Tor validation happens before collector construction.
    expect(factorySpy).not.toHaveBeenCalled();
  });
});

describe('socmint:startMonitor — transport: direct with Tor down', () => {
  beforeEach(() => {
    // Tor is NOT bootstrapped — but direct mode must not care.
    setBgTor(makeMockTor(false));
  });

  afterEach(() => {
    _resetBgTorForTest();
  });

  it('resolves { started, jobId } on direct transport even when Tor is down', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-direct', channelIds: [] },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory: factorySpy,
      },
    );
    expect(factorySpy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ started: true, jobId: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// WA-T6: handleHasWhatsappBurner / handleUnlinkWhatsappBurner — gate tests
// ---------------------------------------------------------------------------

describe('socmint:hasWhatsappBurner', () => {
  it('returns false immediately when burnerId is empty (no store call)', async () => {
    const mockStore = { get: vi.fn(), delete: vi.fn() };
    expect(await handleHasWhatsappBurner('', mockStore)).toBe(false);
    expect(mockStore.get).not.toHaveBeenCalled();
  });

  it('returns false when secretStore has no creds entry (null)', async () => {
    const mockStore = { get: vi.fn().mockResolvedValue(null), delete: vi.fn() };
    expect(await handleHasWhatsappBurner('burner-1', mockStore)).toBe(false);
    expect(mockStore.get).toHaveBeenCalledWith('socmint.whatsapp.burner.burner-1.creds');
  });

  it('returns false when secretStore returns an empty string', async () => {
    const mockStore = { get: vi.fn().mockResolvedValue(''), delete: vi.fn() };
    expect(await handleHasWhatsappBurner('burner-1', mockStore)).toBe(false);
  });

  it('returns true when secretStore holds a non-empty creds blob', async () => {
    const mockStore = { get: vi.fn().mockResolvedValue('{"noiseKey":{}}'), delete: vi.fn() };
    expect(await handleHasWhatsappBurner('burner-1', mockStore)).toBe(true);
    expect(mockStore.get).toHaveBeenCalledWith('socmint.whatsapp.burner.burner-1.creds');
  });

  it('returns false — never throws — when secretStore rejects (keyring locked)', async () => {
    const mockStore = { get: vi.fn().mockRejectedValue(new Error('keyring locked')), delete: vi.fn() };
    await expect(handleHasWhatsappBurner('burner-1', mockStore)).resolves.toBe(false);
  });

  it('sanitises path-separator characters in burnerId before constructing the key', async () => {
    const mockStore = { get: vi.fn().mockResolvedValue('x'), delete: vi.fn() };
    await handleHasWhatsappBurner('burner/evil\\path', mockStore);
    expect(mockStore.get).toHaveBeenCalledWith('socmint.whatsapp.burner.burner_evil_path.creds');
  });
});

describe('socmint:unlinkWhatsappBurner', () => {
  it('deletes both .creds and .keys entries from secretStore', async () => {
    const mockStore = { get: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    await handleUnlinkWhatsappBurner('burner-1', mockStore);
    expect(mockStore.delete).toHaveBeenCalledWith('socmint.whatsapp.burner.burner-1.creds');
    expect(mockStore.delete).toHaveBeenCalledWith('socmint.whatsapp.burner.burner-1.keys');
    expect(mockStore.delete).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when burnerId is empty — no store calls', async () => {
    const mockStore = { get: vi.fn(), delete: vi.fn() };
    await handleUnlinkWhatsappBurner('', mockStore);
    expect(mockStore.delete).not.toHaveBeenCalled();
  });

  it('sanitises path-separator characters in burnerId before constructing the keys', async () => {
    const mockStore = { get: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    await handleUnlinkWhatsappBurner('burner/evil\\path', mockStore);
    expect(mockStore.delete).toHaveBeenCalledWith('socmint.whatsapp.burner.burner_evil_path.creds');
    expect(mockStore.delete).toHaveBeenCalledWith('socmint.whatsapp.burner.burner_evil_path.keys');
  });

  it('deletes .creds before .keys (sequential, deterministic order)', async () => {
    const order: string[] = [];
    const mockStore = {
      get: vi.fn(),
      delete: vi.fn().mockImplementation(async (k: string) => { order.push(k); }),
    };
    await handleUnlinkWhatsappBurner('burner-1', mockStore);
    expect(order).toEqual([
      'socmint.whatsapp.burner.burner-1.creds',
      'socmint.whatsapp.burner.burner-1.keys',
    ]);
  });
});

// ---------------------------------------------------------------------------
// WA-T7: handleSetWhatsappBurnerPairingCode — egress gate
// ---------------------------------------------------------------------------

describe('socmint:setWhatsappBurnerPairingCode — egress gate', () => {
  it('returns { disabled: true } when networkEnabled is false (gate closed, no library touched)', async () => {
    const result = await handleSetWhatsappBurnerPairingCode(
      'burner-wa',
      '15551234567',
      { networkEnabled: async () => false },
    );
    expect(result).toEqual({ disabled: true });
  });

  it('gate-open: socket IS constructed and requestPairingCode is called (_inject)', async () => {
    // The seam is no longer sealed (§5.5 complete 2026-06-27).
    // Gate-open path constructs a socket and calls requestPairingCode.
    const mockSock = {
      ev: { on: vi.fn(), off: vi.fn() },
      groupMetadata: vi.fn(),
      end: vi.fn(),
      requestPairingCode: vi.fn().mockResolvedValue('ABCD-EFGH'),
    };
    const createSocketSpy = vi.fn(() => mockSock);
    const result = await handleSetWhatsappBurnerPairingCode('burner-wa', '15551234567', {
      networkEnabled: async () => true,
      _inject: {
        createSocket: createSocketSpy,
        authState: {
          state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
          initialize: vi.fn().mockResolvedValue(undefined),
          saveCreds: vi.fn().mockResolvedValue(undefined),
          unlinkSession: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    expect(createSocketSpy).toHaveBeenCalledOnce();
    expect(mockSock.requestPairingCode).toHaveBeenCalledWith('15551234567');
    expect(result).toEqual({ pairingCode: 'ABCD-EFGH' });
  });

  it('gate-open: result has a pairingCode string', async () => {
    const mockSock = {
      ev: { on: vi.fn(), off: vi.fn() },
      groupMetadata: vi.fn(),
      end: vi.fn(),
      requestPairingCode: vi.fn().mockResolvedValue('12345678'),
    };
    const result = await handleSetWhatsappBurnerPairingCode('burner-wa', '447700900000', {
      networkEnabled: async () => true,
      _inject: {
        createSocket: vi.fn(() => mockSock),
        authState: {
          state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
          initialize: vi.fn().mockResolvedValue(undefined),
          saveCreds: vi.fn().mockResolvedValue(undefined),
          unlinkSession: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    expect(result).toMatchObject({ pairingCode: expect.any(String) });
  });

  it('gate check fires before socket construction — networkEnabled is always awaited first', async () => {
    const networkEnabled = vi.fn().mockResolvedValue(false);
    await handleSetWhatsappBurnerPairingCode('burner-wa', '15551234567', { networkEnabled });
    expect(networkEnabled).toHaveBeenCalledOnce();
  });

  it('CONTRACT: createSocket is NEVER called when gate is closed (connect-before-gate invariant)', async () => {
    const createSocketSpy = vi.fn();
    const result = await handleSetWhatsappBurnerPairingCode('burner-wa', '15551234567', {
      networkEnabled: async () => false,
      _inject: { createSocket: createSocketSpy },
    });
    expect(result).toEqual({ disabled: true });
    // The socket must NEVER be constructed before the gate returns open.
    expect(createSocketSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// W1: live-wiring — connect / join / subscribe / stop-disconnect (gate open)
// ---------------------------------------------------------------------------

describe('socmint:startMonitor — live wiring (gate open, mock collector)', () => {
  it('calls connect() on the collector when gate is open', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-live', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'direct', collectorFactory: factorySpy },
    );
    expect(result).toMatchObject({ started: true, jobId: expect.any(String) });
    expect(mockCollector.connect).toHaveBeenCalledOnce();
  });

  it('gate-closed: connect() is NEVER called when networkEnabled is false', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-live', channelIds: [] },
      { networkEnabled: async () => false, transport: async () => 'direct', collectorFactory: factorySpy },
    );
    expect(result).toEqual({ disabled: true });
    // factory never called → collector never constructed → connect never reachable
    expect(factorySpy).not.toHaveBeenCalled();
    expect(mockCollector.connect).not.toHaveBeenCalled();
  });

  it('calls join() for each channelId in the request', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-live', channelIds: ['-100001', '-100002'] },
      { networkEnabled: async () => true, transport: async () => 'direct', collectorFactory: factorySpy },
    );
    expect(mockCollector.join).toHaveBeenCalledTimes(2);
    expect(mockCollector.join).toHaveBeenCalledWith('-100001');
    expect(mockCollector.join).toHaveBeenCalledWith('-100002');
  });

  it('calls subscribe() with the channelIds and an onItem callback', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-live', channelIds: ['-100001'] },
      { networkEnabled: async () => true, transport: async () => 'direct', collectorFactory: factorySpy },
    );
    expect(mockCollector.subscribe).toHaveBeenCalledOnce();
    expect(mockCollector.subscribe).toHaveBeenCalledWith(['-100001'], expect.any(Function));
  });

  it('subscribe() called with empty channelIds when none supplied', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-live', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'direct', collectorFactory: factorySpy },
    );
    expect(mockCollector.subscribe).toHaveBeenCalledWith([], expect.any(Function));
  });

  it('handleStopMonitor calls disconnect() on the registered collector', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-stop', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'direct', collectorFactory: factorySpy },
    );
    const { jobId } = result as { started: true; jobId: string };
    expect(mockCollector.disconnect).not.toHaveBeenCalled();

    await handleStopMonitor(jobId);

    expect(mockCollector.disconnect).toHaveBeenCalledOnce();
  });

  it('handleStopMonitor is a no-op for an unknown jobId', async () => {
    // Should resolve without throwing even for a jobId that was never registered.
    await expect(handleStopMonitor('00000000-dead-4000-beef-000000000000')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// W1: transport assertions — collectorFactory receives the right transport arg
// ---------------------------------------------------------------------------

describe('socmint:startMonitor — transport assertions (factory arg)', () => {
  afterEach(() => {
    _resetBgTorForTest();
  });

  it('mode:direct → factory receives transport { mode: "direct" } with no proxy', async () => {
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-direct-tx', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'direct', collectorFactory: factorySpy },
    );
    expect(factorySpy).toHaveBeenCalledOnce();
    const callArg = factorySpy.mock.calls[0][0] as { transport: { mode: string } };
    expect(callArg.transport.mode).toBe('direct');
    // Direct mode carries no proxy field.
    expect('proxy' in callArg.transport).toBe(false);
  });

  it('mode:tor → factory receives transport { mode: "tor", proxy } with per-burner IsolateSOCKSAuth creds', async () => {
    setBgTor(makeMockTor(true, 9999));
    const mockCollector = makeMockCollector();
    const factorySpy = vi.fn(() => mockCollector);
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-tor-tx', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'tor', collectorFactory: factorySpy },
    );
    expect(factorySpy).toHaveBeenCalledOnce();
    const callArg = factorySpy.mock.calls[0][0] as {
      transport: { mode: string; proxy?: { version: number; host: string; port: number; user: string; password: string } };
    };
    expect(callArg.transport.mode).toBe('tor');
    const proxy = callArg.transport.proxy!;
    expect(proxy.version).toBe(5);
    expect(proxy.host).toBe('127.0.0.1');
    expect(proxy.port).toBe(9999);
    // Per-burner SOCKS creds match the deriveBurnerCredentials output for this burnerId.
    const creds = deriveBurnerCredentials('burner-tor-tx');
    expect(proxy.user).toBe(creds.user);
    expect(proxy.password).toBe(creds.pass);
  });

  it('distinct burnerIds → distinct SOCKS creds (IsolateSOCKSAuth cross-burner isolation)', async () => {
    setBgTor(makeMockTor(true, 9999));

    const args1: { transport: { mode: string; proxy?: { user: string; password: string } } }[] = [];
    const args2: typeof args1 = [];

    const factory1 = vi.fn((opts: typeof args1[0]) => { args1.push(opts); return makeMockCollector(); });
    const factory2 = vi.fn((opts: typeof args2[0]) => { args2.push(opts); return makeMockCollector(); });

    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-alpha-iso', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'tor', collectorFactory: factory1 as unknown as typeof factory1 },
    );
    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'burner-beta-iso', channelIds: [] },
      { networkEnabled: async () => true, transport: async () => 'tor', collectorFactory: factory2 as unknown as typeof factory2 },
    );

    const proxy1 = args1[0].transport.proxy!;
    const proxy2 = args2[0].transport.proxy!;
    // Both are version:5 on the same loopback port…
    expect(proxy1.version).toBe(5);
    expect(proxy2.version).toBe(5);
    // …but carry different per-burner credentials.
    expect(proxy1.user).not.toBe(proxy2.user);
    expect(proxy1.password).not.toBe(proxy2.password);
  });
});

// ---------------------------------------------------------------------------
// W2: handleStartMonitor — WhatsApp platform selection
// ---------------------------------------------------------------------------

describe('socmint:startMonitor — platform selection (WhatsApp vs Telegram)', () => {
  it('platform=whatsapp → whatsappCollectorFactory is called; collectorFactory is not', async () => {
    const waMock = makeMockCollector();
    const waFactory = vi.fn(() => waMock);
    const tgFactory = vi.fn(() => makeMockCollector());

    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'wa-burner', channelIds: [], platform: 'whatsapp' },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory: tgFactory,
        whatsappCollectorFactory: waFactory,
      },
    );

    expect(waFactory).toHaveBeenCalledOnce();
    expect(tgFactory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ started: true, jobId: expect.any(String) });
  });

  it('platform=telegram → collectorFactory is called; whatsappCollectorFactory is not', async () => {
    const tgMock = makeMockCollector();
    const tgFactory = vi.fn(() => tgMock);
    const waFactory = vi.fn();

    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'tg-burner', channelIds: [], platform: 'telegram' },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory: tgFactory,
        whatsappCollectorFactory: waFactory as unknown as typeof tgFactory,
      },
    );

    expect(tgFactory).toHaveBeenCalledOnce();
    expect(waFactory).not.toHaveBeenCalled();
  });

  it('platform absent → collectorFactory (telegram) is used by default', async () => {
    const tgMock = makeMockCollector();
    const tgFactory = vi.fn(() => tgMock);
    const waFactory = vi.fn();

    await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'tg-burner', channelIds: [] },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory: tgFactory,
        whatsappCollectorFactory: waFactory as unknown as typeof tgFactory,
      },
    );

    expect(tgFactory).toHaveBeenCalledOnce();
    expect(waFactory).not.toHaveBeenCalled();
  });

  it('gate-closed → whatsappCollectorFactory NOT called even for platform=whatsapp (gate check first)', async () => {
    const waFactory = vi.fn();

    const result = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'wa-burner', channelIds: [], platform: 'whatsapp' },
      {
        networkEnabled: async () => false,
        transport: async () => 'direct',
        collectorFactory: vi.fn(),
        whatsappCollectorFactory: waFactory as unknown as Parameters<typeof handleStartMonitor>[1]['collectorFactory'],
      },
    );

    expect(result).toEqual({ disabled: true });
    // Gate check fires before factory selection — socket NEVER constructed.
    expect(waFactory).not.toHaveBeenCalled();
  });

  it('CONTRACT: connect() on the WA collector is called only after gate returns open', async () => {
    // This asserts the connect-before-gate invariant for the WhatsApp code path.
    // makeMockCollector().connect is a vi.fn() that tracks calls.
    const waMock = makeMockCollector();
    const waFactory = vi.fn(() => waMock);

    // Gate closed — connect() must NEVER be called.
    const closedResult = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'wa-contract', channelIds: [], platform: 'whatsapp' },
      {
        networkEnabled: async () => false,
        transport: async () => 'direct',
        collectorFactory: vi.fn(),
        whatsappCollectorFactory: waFactory,
      },
    );
    expect(closedResult).toEqual({ disabled: true });
    expect(waMock.connect).not.toHaveBeenCalled();

    // Gate open — connect() is called exactly once on the collector.
    const waMock2 = makeMockCollector();
    const waFactory2 = vi.fn(() => waMock2);
    const openResult = await handleStartMonitor(
      { caseId: VALID_CASE_ID, burnerId: 'wa-contract', channelIds: [], platform: 'whatsapp' },
      {
        networkEnabled: async () => true,
        transport: async () => 'direct',
        collectorFactory: vi.fn(),
        whatsappCollectorFactory: waFactory2,
      },
    );
    expect(openResult).toMatchObject({ started: true });
    expect(waMock2.connect).toHaveBeenCalledOnce();
  });
});
