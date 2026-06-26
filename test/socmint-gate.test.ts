import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleStartMonitor, handleHasWhatsappBurner, handleUnlinkWhatsappBurner } from '../src/main/socmint/ipc';
import { setBgTor, _resetBgTorForTest } from '../src/main/bgconn/tor-singleton';
import type { BgconnTor } from '../src/main/bgconn/tor';
import { SocmintTorUnavailableError } from '../src/main/socmint/tor-identity';

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
