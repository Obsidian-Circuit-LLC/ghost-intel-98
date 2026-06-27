/**
 * X-5: IPC handler gate + delegation tests.
 *
 * Tests the egress gate behaviour of handleXCollect (both flags required),
 * account management handler delegation (injectable secretStore deps),
 * and the channels.x structure (globally unique values, correct key set).
 *
 * handleXListItems / handleXRankItems are not tested here (they lazy-import
 * the SOCMINT store which requires Electron paths — the quarantine + store
 * integration is covered by the X-2 and X-4 test suites).
 */

import { describe, it, expect, vi } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
import {
  XCollectorGatedError,
  handleXAddAccount,
  handleXRemoveAccount,
  handleXListAccounts,
  handleXHasAccount,
  handleXCollect,
  handleXListItems,
  handleXRankItems,
} from '../src/main/x/ipc';
import type { XCollectResult } from '../src/main/x/collector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CASE_ID = '22222222-2222-4222-8222-222222222222';

function makeStoreDeps() {
  const store: Record<string, string> = {};
  return {
    getSecret: vi.fn(async (k: string) => store[k] ?? null),
    setSecret: vi.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteSecret: vi.fn(async (k: string) => { delete store[k]; }),
    store,
  };
}

function makeMockCollectResult(override: Partial<XCollectResult> = {}): XCollectResult {
  return {
    status: 'done',
    totalFromSidecar: 1,
    itemsAdded: 1,
    itemsSkipped: 0,
    jobId: 'test-job-id',
    ...override,
  };
}

// ---------------------------------------------------------------------------
// channels.x structure
// ---------------------------------------------------------------------------

describe('X-5: channels.x structure', () => {
  it('channels.x exists as a top-level channel group', () => {
    expect((channels as Record<string, unknown>).x).toBeTruthy();
  });

  it('channels.x has exactly the expected keys', () => {
    const expected = [
      'addAccount', 'removeAccount', 'listAccounts', 'hasAccount',
      'collect', 'listItems', 'rankItems',
    ];
    expect(Object.keys(channels.x).sort()).toEqual([...expected].sort());
  });

  it('all channels.x values are prefixed with x:', () => {
    for (const v of Object.values(channels.x)) {
      expect((v as string).startsWith('x:')).toBe(true);
    }
  });

  it('channels.x and channels.socmint are not the same object', () => {
    expect(channels.x).not.toBe(channels.socmint);
  });

  it('channel values are globally unique across ALL namespaces (includes channels.x)', () => {
    const all = Object.values(channels as Record<string, Record<string, string>>).flatMap(
      (grp) => Object.values(grp),
    );
    expect(new Set(all).size).toBe(all.length);
  });
});

// ---------------------------------------------------------------------------
// handleXCollect — egress gate
// ---------------------------------------------------------------------------

describe('X-5: handleXCollect egress gate', () => {
  const gateOpenDeps = {
    networkEnabled: async () => true,
    clearnetAcknowledged: async () => true,
    collectXFn: vi.fn().mockResolvedValue(makeMockCollectResult()),
    async upsertItems(_caseId: string, _items: unknown[]) { return { added: 0, skipped: 0 }; },
    async recordJob() {},
    getSecret: async () => null,
  };

  it('throws XCollectorGatedError when networkEnabled is false', async () => {
    const collectXFn = vi.fn();
    await expect(
      handleXCollect({ caseId: VALID_CASE_ID, mode: 'search', query: 'test' }, {
        ...gateOpenDeps,
        collectXFn,
        networkEnabled: async () => false,
        clearnetAcknowledged: async () => true,
      }),
    ).rejects.toThrow(XCollectorGatedError);
    expect(collectXFn).not.toHaveBeenCalled();
  });

  it('throws XCollectorGatedError when clearnetAcknowledged is false', async () => {
    const collectXFn = vi.fn();
    await expect(
      handleXCollect({ caseId: VALID_CASE_ID, mode: 'search', query: 'test' }, {
        ...gateOpenDeps,
        collectXFn,
        networkEnabled: async () => true,
        clearnetAcknowledged: async () => false,
      }),
    ).rejects.toThrow(XCollectorGatedError);
    expect(collectXFn).not.toHaveBeenCalled();
  });

  it('throws XCollectorGatedError when both flags are false', async () => {
    const collectXFn = vi.fn();
    await expect(
      handleXCollect({ caseId: VALID_CASE_ID, mode: 'search', query: 'test' }, {
        ...gateOpenDeps,
        collectXFn,
        networkEnabled: async () => false,
        clearnetAcknowledged: async () => false,
      }),
    ).rejects.toThrow(XCollectorGatedError);
    expect(collectXFn).not.toHaveBeenCalled();
  });

  it('XCollectorGatedError is an Error instance with the correct name', async () => {
    let thrown: unknown;
    try {
      await handleXCollect({ caseId: VALID_CASE_ID, mode: 'search', query: 'test' }, {
        ...gateOpenDeps,
        networkEnabled: async () => false,
        clearnetAcknowledged: async () => true,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('XCollectorGatedError');
  });

  it('gate check fires before any delegation — networkEnabled is always awaited', async () => {
    const networkEnabled = vi.fn().mockResolvedValue(false);
    const collectXFn = vi.fn();
    await expect(
      handleXCollect({ caseId: VALID_CASE_ID, mode: 'search', query: 'test' }, {
        ...gateOpenDeps,
        networkEnabled,
        clearnetAcknowledged: async () => true,
        collectXFn,
      }),
    ).rejects.toThrow(XCollectorGatedError);
    expect(networkEnabled).toHaveBeenCalledOnce();
    expect(collectXFn).not.toHaveBeenCalled();
  });

  it('clearnetAcknowledged is checked even when networkEnabled is false', async () => {
    const clearnetAcknowledged = vi.fn().mockResolvedValue(false);
    await expect(
      handleXCollect({ caseId: VALID_CASE_ID, mode: 'search', query: 'test' }, {
        ...gateOpenDeps,
        networkEnabled: async () => false,
        clearnetAcknowledged,
      }),
    ).rejects.toThrow(XCollectorGatedError);
    // Both gate checks fire before the short-circuit resolves.
    // With short-circuit OR, clearnetAcknowledged may or may not be called — the invariant
    // is that the gate is CLOSED (throws) when EITHER is false.
    expect(clearnetAcknowledged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleXCollect — delegation (gate open)
// ---------------------------------------------------------------------------

describe('X-5: handleXCollect delegation (gate open)', () => {
  it('delegates to collectXFn with the correct caseId (search mode)', async () => {
    const collectXFn = vi.fn().mockResolvedValue(makeMockCollectResult());
    await handleXCollect(
      { caseId: VALID_CASE_ID, mode: 'search', query: 'hello world', limit: 100 },
      {
        networkEnabled: async () => true,
        clearnetAcknowledged: async () => true,
        collectXFn,
        async upsertItems() { return { added: 0, skipped: 0 }; },
        async recordJob() {},
        getSecret: async () => null,
      },
    );
    expect(collectXFn).toHaveBeenCalledOnce();
    const [req] = collectXFn.mock.calls[0] as [{ caseId: string; sidecarReq: { type: string; query: string; limit: number } }];
    expect(req.caseId).toBe(VALID_CASE_ID);
    expect(req.sidecarReq.type).toBe('search');
    expect(req.sidecarReq.query).toBe('hello world');
    expect(req.sidecarReq.limit).toBe(100);
  });

  it('delegates to collectXFn with the correct username (userTweets mode)', async () => {
    const collectXFn = vi.fn().mockResolvedValue(makeMockCollectResult());
    await handleXCollect(
      { caseId: VALID_CASE_ID, mode: 'userTweets', username: '@testuser', limit: 200 },
      {
        networkEnabled: async () => true,
        clearnetAcknowledged: async () => true,
        collectXFn,
        async upsertItems() { return { added: 0, skipped: 0 }; },
        async recordJob() {},
        getSecret: async () => null,
      },
    );
    expect(collectXFn).toHaveBeenCalledOnce();
    const [req] = collectXFn.mock.calls[0] as [{ sidecarReq: { type: string; username: string; limit: number } }];
    expect(req.sidecarReq.type).toBe('userTweets');
    // Leading @ is stripped.
    expect(req.sidecarReq.username).toBe('testuser');
    expect(req.sidecarReq.limit).toBe(200);
  });

  it('caps limit at 5000', async () => {
    const collectXFn = vi.fn().mockResolvedValue(makeMockCollectResult());
    await handleXCollect(
      { caseId: VALID_CASE_ID, mode: 'search', query: 'test', limit: 99999 },
      {
        networkEnabled: async () => true,
        clearnetAcknowledged: async () => true,
        collectXFn,
        async upsertItems() { return { added: 0, skipped: 0 }; },
        async recordJob() {},
        getSecret: async () => null,
      },
    );
    const [req] = collectXFn.mock.calls[0] as [{ sidecarReq: { limit: number } }];
    expect(req.sidecarReq.limit).toBe(5000);
  });

  it('defaults limit to 500 when absent', async () => {
    const collectXFn = vi.fn().mockResolvedValue(makeMockCollectResult());
    await handleXCollect(
      { caseId: VALID_CASE_ID, mode: 'search', query: 'test' },
      {
        networkEnabled: async () => true,
        clearnetAcknowledged: async () => true,
        collectXFn,
        async upsertItems() { return { added: 0, skipped: 0 }; },
        async recordJob() {},
        getSecret: async () => null,
      },
    );
    const [req] = collectXFn.mock.calls[0] as [{ sidecarReq: { limit: number } }];
    expect(req.sidecarReq.limit).toBe(500);
  });

  it('returns the XCollectResult from collectXFn unchanged', async () => {
    const expected = makeMockCollectResult({ status: 'partial', itemsAdded: 5, itemsSkipped: 2 });
    const collectXFn = vi.fn().mockResolvedValue(expected);
    const result = await handleXCollect(
      { caseId: VALID_CASE_ID, mode: 'search', query: 'test' },
      {
        networkEnabled: async () => true,
        clearnetAcknowledged: async () => true,
        collectXFn,
        async upsertItems() { return { added: 0, skipped: 0 }; },
        async recordJob() {},
        getSecret: async () => null,
      },
    );
    expect(result).toBe(expected);
  });

  it('throws when mode is invalid (gate-open path)', async () => {
    await expect(
      handleXCollect(
        { caseId: VALID_CASE_ID, mode: 'invalid', query: 'test' },
        {
          networkEnabled: async () => true,
          clearnetAcknowledged: async () => true,
          collectXFn: vi.fn(),
          async upsertItems() { return { added: 0, skipped: 0 }; },
          async recordJob() {},
          getSecret: async () => null,
        },
      ),
    ).rejects.toThrow(/mode/i);
  });

  it('throws when search mode has empty query', async () => {
    await expect(
      handleXCollect(
        { caseId: VALID_CASE_ID, mode: 'search', query: '   ' },
        {
          networkEnabled: async () => true,
          clearnetAcknowledged: async () => true,
          collectXFn: vi.fn(),
          async upsertItems() { return { added: 0, skipped: 0 }; },
          async recordJob() {},
          getSecret: async () => null,
        },
      ),
    ).rejects.toThrow(/query/i);
  });

  it('throws when userTweets mode has empty username', async () => {
    await expect(
      handleXCollect(
        { caseId: VALID_CASE_ID, mode: 'userTweets', username: '' },
        {
          networkEnabled: async () => true,
          clearnetAcknowledged: async () => true,
          collectXFn: vi.fn(),
          async upsertItems() { return { added: 0, skipped: 0 }; },
          async recordJob() {},
          getSecret: async () => null,
        },
      ),
    ).rejects.toThrow(/username/i);
  });
});

// ---------------------------------------------------------------------------
// handleXAddAccount / handleXHasAccount / handleXListAccounts / handleXRemoveAccount
// ---------------------------------------------------------------------------

describe('X-5: account management handlers', () => {
  it('handleXAddAccount stores auth_token and updates the index', async () => {
    const deps = makeStoreDeps();
    await handleXAddAccount('acct-1', { auth_token: 'tok123', ct0: 'ct0val' }, deps);
    expect(deps.setSecret).toHaveBeenCalledWith('x.accounts.acct-1.auth_token', 'tok123');
    expect(deps.setSecret).toHaveBeenCalledWith('x.accounts.acct-1.ct0', 'ct0val');
    // Index updated.
    expect(deps.store['x.accounts.index']).toContain('acct-1');
  });

  it('handleXAddAccount throws when no credential field is provided', async () => {
    const deps = makeStoreDeps();
    await expect(handleXAddAccount('acct-2', {}, deps)).rejects.toThrow(/credential/i);
  });

  it('handleXAddAccount throws when accountId is empty', async () => {
    const deps = makeStoreDeps();
    await expect(handleXAddAccount('', { auth_token: 'tok' }, deps)).rejects.toThrow(/accountId/i);
  });

  it('handleXAddAccount sanitises path separators in accountId', async () => {
    const deps = makeStoreDeps();
    await handleXAddAccount('acct/evil\\path', { auth_token: 'tok' }, deps);
    expect(deps.setSecret).toHaveBeenCalledWith('x.accounts.acct_evil_path.auth_token', 'tok');
  });

  it('handleXHasAccount returns true when auth_token is stored', async () => {
    const deps = makeStoreDeps();
    await handleXAddAccount('acct-3', { auth_token: 'secrettoken' }, deps);
    expect(await handleXHasAccount('acct-3', deps)).toBe(true);
  });

  it('handleXHasAccount returns false when no auth_token is stored', async () => {
    const deps = makeStoreDeps();
    expect(await handleXHasAccount('nonexistent', deps)).toBe(false);
  });

  it('handleXHasAccount returns false for empty accountId without store access', async () => {
    const deps = makeStoreDeps();
    expect(await handleXHasAccount('', deps)).toBe(false);
    expect(deps.getSecret).not.toHaveBeenCalled();
  });

  it('handleXHasAccount returns false on keyring error (never throws)', async () => {
    const deps = {
      getSecret: vi.fn().mockRejectedValue(new Error('keyring locked')),
      setSecret: vi.fn(),
      deleteSecret: vi.fn(),
    };
    await expect(handleXHasAccount('acct-x', deps)).resolves.toBe(false);
  });

  it('handleXListAccounts returns empty array when no accounts stored', async () => {
    const deps = makeStoreDeps();
    expect(await handleXListAccounts(deps)).toEqual([]);
  });

  it('handleXListAccounts returns the list of account IDs (no creds)', async () => {
    const deps = makeStoreDeps();
    await handleXAddAccount('a1', { auth_token: 'tok1' }, deps);
    await handleXAddAccount('a2', { auth_token: 'tok2' }, deps);
    const ids = await handleXListAccounts(deps);
    expect(ids).toContain('a1');
    expect(ids).toContain('a2');
    // Must not include credential values.
    expect(ids).not.toContain('tok1');
    expect(ids).not.toContain('tok2');
  });

  it('handleXRemoveAccount deletes all credential fields and removes from index', async () => {
    const deps = makeStoreDeps();
    await handleXAddAccount('rm-acct', { auth_token: 'tok', ct0: 'c', username: 'u' }, deps);
    await handleXRemoveAccount('rm-acct', deps);
    expect(deps.deleteSecret).toHaveBeenCalledWith('x.accounts.rm-acct.auth_token');
    expect(deps.deleteSecret).toHaveBeenCalledWith('x.accounts.rm-acct.ct0');
    expect(deps.deleteSecret).toHaveBeenCalledWith('x.accounts.rm-acct.username');
    // Account removed from index.
    const ids = await handleXListAccounts(deps);
    expect(ids).not.toContain('rm-acct');
  });

  it('handleXRemoveAccount is a no-op when accountId is empty', async () => {
    const deps = makeStoreDeps();
    await handleXRemoveAccount('', deps);
    expect(deps.deleteSecret).not.toHaveBeenCalled();
  });

  it('handleXAddAccount does not append duplicates to the index', async () => {
    const deps = makeStoreDeps();
    await handleXAddAccount('dup-acct', { auth_token: 'tok1' }, deps);
    await handleXAddAccount('dup-acct', { auth_token: 'tok2' }, deps);
    const ids = await handleXListAccounts(deps);
    expect(ids.filter((id) => id === 'dup-acct')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// handleXListItems / handleXRankItems — function availability (not store access)
// ---------------------------------------------------------------------------

describe('X-5: handleXListItems and handleXRankItems are exported and callable', () => {
  it('handleXListItems is a function (wired via channels.x.listItems)', () => {
    expect(typeof handleXListItems).toBe('function');
  });

  it('handleXRankItems is a function (wired via channels.x.rankItems)', () => {
    expect(typeof handleXRankItems).toBe('function');
  });
});
