import { describe, it, expect, vi } from 'vitest';
import { handleStartMonitor } from '../src/main/socmint/ipc';

describe('socmint:startMonitor gate', () => {
  it('returns { disabled: true } and never calls collectorFactory when networkEnabled is false', async () => {
    const factorySpy = vi.fn();
    const result = await handleStartMonitor(
      { caseId: 'abc123', burnerId: 'burner-1', channelIds: [] },
      {
        networkEnabled: async () => false,
        collectorFactory: factorySpy,
      },
    );
    expect(result).toEqual({ disabled: true });
    expect(factorySpy).not.toHaveBeenCalled();
  });

  it('calls collectorFactory and returns { started, jobId } when networkEnabled is true', async () => {
    const mockCollector = {
      connect: vi.fn().mockResolvedValue(undefined),
      join: vi.fn(),
      backfill: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const factorySpy = vi.fn(() => mockCollector);
    const result = await handleStartMonitor(
      { caseId: 'abc123', burnerId: 'burner-1', channelIds: [] },
      {
        networkEnabled: async () => true,
        collectorFactory: factorySpy,
      },
    );
    expect(factorySpy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ started: true, jobId: expect.any(String) });
  });
});
