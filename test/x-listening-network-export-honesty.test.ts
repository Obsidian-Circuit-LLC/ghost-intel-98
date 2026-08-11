import { describe, it, expect, vi } from 'vitest';

/**
 * Regression for the Phase-2 review CRITICAL: the live `exportNetwork` IPC path
 * (`exportNetworkCsv`) serialized EVERY account without filtering `synthetic`, so demo/seeded
 * follower rows leaked into a real-intel CSV. The fix strips synthetic accounts before serialising.
 */

const rec = vi.hoisted(() => ({ artifacts: [] as unknown[] }));

// Mock the store so exportNetworkCsv reads controlled artifacts; keep every other export real.
vi.mock('../src/main/x-listening/store', async (importActual) => {
  const actual = await importActual<typeof import('../src/main/x-listening/store')>();
  return { ...actual, prodXStore: async () => ({ networks: { read: async () => rec.artifacts } }) };
});
// ipc.ts imports `session` from electron at module load.
vi.mock('electron', () => ({
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) }
}));

import { exportNetworkCsv } from '../src/main/x-listening/ipc';

describe('exportNetworkCsv — demo/synthetic accounts are never exported as real intel', () => {
  it('excludes synthetic:true accounts from the CSV body AND the count', async () => {
    rec.artifacts = [
      {
        id: 'n1', caseId: 'c1', target: 'target', kind: 'followers', collectedAt: '2026-08-11T00:00:00.000Z',
        evidenceHash: 'h', accounts: [
          { handle: 'realacct', displayName: 'Real One', bio: 'analyst', url: 'https://x.com/realacct' },
          { handle: 'demoacct', displayName: 'Demo Seed', bio: 'seed', url: 'https://x.com/demoacct', synthetic: true }
        ]
      }
    ];
    const { csv, count } = await exportNetworkCsv('c1');
    expect(count).toBe(1); // only the one REAL account
    expect(csv).toContain('realacct');
    expect(csv).not.toContain('demoacct'); // the synthetic/demo row must not appear
  });
});
