import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleStartMonitor } from '../src/main/socmint/ipc';
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
