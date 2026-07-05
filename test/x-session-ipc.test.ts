/**
 * Task 3: X session IPC handlers — addSession / removeSession / listSessions /
 * testSession / testStoredSession.
 *
 * These handlers sit between the renderer and the Task 1 sessions-store + Task 2
 * session-test core. All I/O is injected so the seam is exercised without Electron,
 * secretStore, or a real network (mirrors src/main/x/ipc.ts's existing handler tests).
 *
 * Charter guards asserted here:
 *  - addSession writes the auth_token + ct0 (+ username) secret keys and untested metadata,
 *    returning an opaque accountId — never echoing a cookie value back.
 *  - removeSession deletes BOTH the secrets and the metadata.
 *  - testSession / testStoredSession are GATED behind networkEnabled (throw when off).
 *  - testStoredSession reads the secret keys MAIN-SIDE and stamps status/handle/lastTestedAt.
 *  - No renderer-facing return value of any handler contains a secret (cookie) value.
 */

import { describe, it, expect, vi } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
import {
  XSessionGatedError,
  handleXAddSession,
  handleXAddSessionTested,
  handleXRemoveSession,
  handleXListSessions,
  handleXTestSession,
  handleXTestStoredSession,
  handleXMigrateLegacySessions,
} from '../src/main/x/ipc';
import type { SessionMeta } from '../src/main/x/sessions-store';
import type { SessionTestResult } from '../src/main/x/session-test';

// ---------------------------------------------------------------------------
// Injected fakes
// ---------------------------------------------------------------------------

function makeSecretStore() {
  const store: Record<string, string> = {};
  return {
    store,
    getSecret: vi.fn(async (k: string) => store[k] ?? null),
    setSecret: vi.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteSecret: vi.fn(async (k: string) => { delete store[k]; }),
  };
}

function makeMetaStore() {
  const map = new Map<string, SessionMeta>();
  return {
    map,
    listSessions: vi.fn(async () => [...map.values()]),
    putSessionMeta: vi.fn(async (m: SessionMeta) => { map.set(m.accountId, m); }),
    removeSessionMeta: vi.fn(async (id: string) => { map.delete(id); }),
  };
}

const AUTH = 'auth_tok_SECRET_do_not_leak';
const CT0 = 'ct0_SECRET_do_not_leak';

/** Recursively assert no secret cookie value appears anywhere in a renderer-facing return. */
function assertNoSecret(value: unknown): void {
  const json = JSON.stringify(value ?? null);
  expect(json).not.toContain(AUTH);
  expect(json).not.toContain(CT0);
}

// ---------------------------------------------------------------------------
// channels wiring
// ---------------------------------------------------------------------------

describe('Task 3: channels.x session channels', () => {
  it('exposes the five new session channels (and keeps the legacy account channels)', () => {
    for (const k of ['addSession', 'removeSession', 'listSessions', 'testSession', 'testStoredSession']) {
      expect((channels.x as Record<string, string>)[k]).toBeTruthy();
      expect((channels.x as Record<string, string>)[k].startsWith('x:')).toBe(true);
    }
    // Back-compat: GhostScrape still relies on x:listAccounts.
    expect(channels.x.listAccounts).toBe('x:listAccounts');
    expect(channels.x.addAccount).toBe('x:addAccount');
  });

  it('all channel values are globally unique (new channels included)', () => {
    const all = Object.values(channels as Record<string, Record<string, string>>).flatMap((g) => Object.values(g));
    expect(new Set(all).size).toBe(all.length);
  });
});

// ---------------------------------------------------------------------------
// addSession
// ---------------------------------------------------------------------------

const ACCOUNT_INDEX_KEY = 'x.accounts.index';

describe('Task 3: handleXAddSession', () => {
  it('appends the new accountId to the legacy x.accounts.index (GhostScrape discovery path)', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    await handleXAddSession(
      { label: 'Alpha', authToken: AUTH, ct0: CT0 },
      { getSecret: secrets.getSecret, setSecret: secrets.setSecret, putSessionMeta: meta.putSessionMeta, genId: () => 'uuid-new' },
    );
    // GhostScrape reads x.listAccounts → readAccountIndex(x.accounts.index); the refined session
    // MUST be discoverable there, else GhostScrape can't authenticate with it.
    expect(JSON.parse(secrets.store[ACCOUNT_INDEX_KEY])).toContain('uuid-new');
  });

  it('preserves pre-existing index entries when appending (does not clobber legacy accounts)', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    secrets.store[ACCOUNT_INDEX_KEY] = JSON.stringify(['burner1']);
    await handleXAddSession(
      { label: 'Alpha', authToken: AUTH, ct0: CT0 },
      { getSecret: secrets.getSecret, setSecret: secrets.setSecret, putSessionMeta: meta.putSessionMeta, genId: () => 'uuid-new' },
    );
    expect(JSON.parse(secrets.store[ACCOUNT_INDEX_KEY])).toEqual(['burner1', 'uuid-new']);
  });

  it('writes auth_token + ct0 + username secrets and untested metadata, returns a uuid accountId', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    const genId = vi.fn(() => 'uuid-123');
    const res = await handleXAddSession(
      { label: 'Burner A', username: 'ghostexodus', authToken: AUTH, ct0: CT0 },
      { getSecret: secrets.getSecret, setSecret: secrets.setSecret, putSessionMeta: meta.putSessionMeta, genId },
    );
    expect(res).toEqual({ accountId: 'uuid-123' });
    expect(secrets.store['x.accounts.uuid-123.auth_token']).toBe(AUTH);
    expect(secrets.store['x.accounts.uuid-123.ct0']).toBe(CT0);
    expect(secrets.store['x.accounts.uuid-123.username']).toBe('ghostexodus');
    const stored = meta.map.get('uuid-123');
    expect(stored).toMatchObject({ accountId: 'uuid-123', label: 'Burner A', username: 'ghostexodus', status: 'untested' });
    // The return carries no secret.
    assertNoSecret(res);
  });

  it('omits the username secret when no username is given', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    await handleXAddSession(
      { label: 'No handle', authToken: AUTH, ct0: CT0 },
      { getSecret: secrets.getSecret, setSecret: secrets.setSecret, putSessionMeta: meta.putSessionMeta, genId: () => 'u2' },
    );
    expect(secrets.store['x.accounts.u2.username']).toBeUndefined();
    expect(meta.map.get('u2')?.username).toBeUndefined();
  });

  it('requires a label', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    await expect(handleXAddSession(
      { label: '  ', authToken: AUTH, ct0: CT0 },
      { getSecret: secrets.getSecret, setSecret: secrets.setSecret, putSessionMeta: meta.putSessionMeta, genId: () => 'u3' },
    )).rejects.toThrow(/label/i);
    expect(secrets.setSecret).not.toHaveBeenCalled();
  });

  it('requires BOTH auth_token and ct0 (atomic pair)', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    const deps = { getSecret: secrets.getSecret, setSecret: secrets.setSecret, putSessionMeta: meta.putSessionMeta, genId: () => 'u4' };
    await expect(handleXAddSession({ label: 'L', authToken: AUTH }, deps)).rejects.toThrow(/ct0|auth_token/i);
    await expect(handleXAddSession({ label: 'L', ct0: CT0 }, deps)).rejects.toThrow(/ct0|auth_token/i);
    expect(secrets.setSecret).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addSessionTested (combined test + save-on-valid, single clearnet request)
// ---------------------------------------------------------------------------

describe('handleXAddSessionTested', () => {
  const base = (over: Partial<{ networkEnabled: boolean; result: SessionTestResult }> = {}) => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    const testSession = vi.fn(async () => over.result ?? ({ valid: true, handle: 'ghostexodus' } as SessionTestResult));
    return {
      secrets, meta, testSession,
      deps: {
        getSecret: secrets.getSecret, setSecret: secrets.setSecret, putSessionMeta: meta.putSessionMeta,
        genId: () => 'uuid-new', now: () => '2026-07-05T00:00:00.000Z',
        networkEnabled: vi.fn(async () => over.networkEnabled ?? true), testSession,
      },
    };
  };
  const input = { label: 'Burner', authToken: AUTH, ct0: CT0 };

  it('valid → saves with status:valid + handle in ONE testSession call; returns {accountId,result}, no secret leak', async () => {
    const { secrets, meta, testSession, deps } = base({ result: { valid: true, handle: 'ghostexodus' } });
    const res = await handleXAddSessionTested(input, deps);
    expect(testSession).toHaveBeenCalledTimes(1);
    expect(secrets.store['x.accounts.uuid-new.auth_token']).toBe(AUTH);
    expect(meta.map.get('uuid-new')).toMatchObject({ status: 'valid', handle: 'ghostexodus', lastTestedAt: '2026-07-05T00:00:00.000Z' });
    expect(res).toEqual({ accountId: 'uuid-new', result: { valid: true, handle: 'ghostexodus' } });
    assertNoSecret(res);
  });

  it('expired → does NOT save (no secret write, no metadata) and returns {result}', async () => {
    const { secrets, meta, deps } = base({ result: { valid: false, reason: 'expired' } });
    const res = await handleXAddSessionTested(input, deps);
    expect(secrets.setSecret).not.toHaveBeenCalled();
    expect(meta.putSessionMeta).not.toHaveBeenCalled();
    expect(res).toEqual({ result: { valid: false, reason: 'expired' } });
  });

  it('throws XSessionGatedError when networkEnabled is false, without testing', async () => {
    const { testSession, deps } = base({ networkEnabled: false });
    await expect(handleXAddSessionTested(input, deps)).rejects.toBeInstanceOf(XSessionGatedError);
    expect(testSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeSession
// ---------------------------------------------------------------------------

describe('Task 3: handleXRemoveSession', () => {
  it('un-lists (metadata) BEFORE deleting secrets — never a listed session with missing cookies', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    const order: string[] = [];
    meta.removeSessionMeta.mockImplementation(async (id: string) => { order.push('meta'); meta.map.delete(id); });
    secrets.deleteSecret.mockImplementation(async (k: string) => { order.push('secret'); delete secrets.store[k]; });
    secrets.store['x.accounts.abc.auth_token'] = AUTH;
    meta.map.set('abc', { accountId: 'abc', label: 'L', status: 'valid' });
    await handleXRemoveSession('abc', { getSecret: secrets.getSecret, setSecret: secrets.setSecret, deleteSecret: secrets.deleteSecret, removeSessionMeta: meta.removeSessionMeta });
    expect(order[0]).toBe('meta'); // metadata cleared first (mirror of addSession's secrets-then-metadata)
    expect(order).toContain('secret');
    expect(order.indexOf('meta')).toBeLessThan(order.indexOf('secret'));
  });

  it('deletes the secret keys AND the metadata', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    secrets.store['x.accounts.abc.auth_token'] = AUTH;
    secrets.store['x.accounts.abc.ct0'] = CT0;
    meta.map.set('abc', { accountId: 'abc', label: 'L', status: 'valid' });
    await handleXRemoveSession('abc', { getSecret: secrets.getSecret, setSecret: secrets.setSecret, deleteSecret: secrets.deleteSecret, removeSessionMeta: meta.removeSessionMeta });
    expect(secrets.deleteSecret).toHaveBeenCalledWith('x.accounts.abc.auth_token');
    expect(secrets.deleteSecret).toHaveBeenCalledWith('x.accounts.abc.ct0');
    expect(secrets.deleteSecret).toHaveBeenCalledWith('x.accounts.abc.username');
    expect(meta.removeSessionMeta).toHaveBeenCalledWith('abc');
    expect(meta.map.has('abc')).toBe(false);
  });

  it('is a no-op for an empty accountId', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    await handleXRemoveSession('', { getSecret: secrets.getSecret, setSecret: secrets.setSecret, deleteSecret: secrets.deleteSecret, removeSessionMeta: meta.removeSessionMeta });
    expect(secrets.deleteSecret).not.toHaveBeenCalled();
    expect(meta.removeSessionMeta).not.toHaveBeenCalled();
  });

  it('filters the removed id out of the legacy x.accounts.index (no dead GhostScrape entry / no migration resurrection)', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    secrets.store[ACCOUNT_INDEX_KEY] = JSON.stringify(['keep', 'abc']);
    secrets.store['x.accounts.abc.auth_token'] = AUTH;
    await handleXRemoveSession('abc', { getSecret: secrets.getSecret, setSecret: secrets.setSecret, deleteSecret: secrets.deleteSecret, removeSessionMeta: meta.removeSessionMeta });
    expect(JSON.parse(secrets.store[ACCOUNT_INDEX_KEY])).toEqual(['keep']);
  });

  it('leaves the index untouched when the removed id was not present', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    secrets.store[ACCOUNT_INDEX_KEY] = JSON.stringify(['keep']);
    await handleXRemoveSession('abc', { getSecret: secrets.getSecret, setSecret: secrets.setSecret, deleteSecret: secrets.deleteSecret, removeSessionMeta: meta.removeSessionMeta });
    // setSecret must not have rewritten the index (only the 3 secret deletes ran).
    expect(secrets.setSecret).not.toHaveBeenCalledWith(ACCOUNT_INDEX_KEY, expect.anything());
    expect(JSON.parse(secrets.store[ACCOUNT_INDEX_KEY])).toEqual(['keep']);
  });

  it('sanitises path separators in the accountId before building secret keys', async () => {
    const secrets = makeSecretStore();
    const meta = makeMetaStore();
    await handleXRemoveSession('a/b\\c', { getSecret: secrets.getSecret, setSecret: secrets.setSecret, deleteSecret: secrets.deleteSecret, removeSessionMeta: meta.removeSessionMeta });
    expect(secrets.deleteSecret).toHaveBeenCalledWith('x.accounts.a_b_c.auth_token');
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe('Task 3: handleXListSessions', () => {
  it('returns the metadata store list and carries no secret', async () => {
    const meta = makeMetaStore();
    meta.map.set('s1', { accountId: 's1', label: 'One', status: 'valid', handle: 'ghostexodus' });
    const out = await handleXListSessions({ listSessions: meta.listSessions });
    expect(out).toEqual([{ accountId: 's1', label: 'One', status: 'valid', handle: 'ghostexodus' }]);
    assertNoSecret(out);
  });
});

// ---------------------------------------------------------------------------
// migrateLegacySessions (non-destructive startup migration, spec §5)
// ---------------------------------------------------------------------------

describe('handleXMigrateLegacySessions', () => {
  it('passes the legacy x.accounts.index ids to migrateSessions so upgraded accounts stay visible', async () => {
    const secrets = makeSecretStore();
    secrets.store[ACCOUNT_INDEX_KEY] = JSON.stringify(['burner1', 'burner2']);
    const migrateSessions = vi.fn(async () => {});
    await handleXMigrateLegacySessions({ getSecret: secrets.getSecret, migrateSessions });
    expect(migrateSessions).toHaveBeenCalledWith(['burner1', 'burner2']);
  });

  it('does not call migrateSessions when the legacy index is empty/absent', async () => {
    const secrets = makeSecretStore();
    const migrateSessions = vi.fn(async () => {});
    await handleXMigrateLegacySessions({ getSecret: secrets.getSecret, migrateSessions });
    expect(migrateSessions).not.toHaveBeenCalled();
  });

  it('end-to-end: a legacy account synthesizes untested metadata that then lists', async () => {
    // Legacy account "burner1" exists in the index + secretStore, but nothing is in the metadata
    // store yet (the pre-refinement state on upgrade). Migration must make it listable.
    const secrets = makeSecretStore();
    secrets.store[ACCOUNT_INDEX_KEY] = JSON.stringify(['burner1']);
    secrets.store['x.accounts.burner1.auth_token'] = AUTH;
    secrets.store['x.accounts.burner1.ct0'] = CT0;
    const meta = makeMetaStore();
    // migrateSessions mirrors the sessions-store's non-destructive semantics.
    const migrateSessions = vi.fn(async (ids: string[]) => {
      for (const id of ids) {
        if (![...meta.map.keys()].includes(id)) meta.map.set(id, { accountId: id, label: id, status: 'untested' });
      }
    });
    await handleXMigrateLegacySessions({ getSecret: secrets.getSecret, migrateSessions });
    const listed = await handleXListSessions({ listSessions: meta.listSessions });
    expect(listed).toEqual([{ accountId: 'burner1', label: 'burner1', status: 'untested' }]);
    assertNoSecret(listed);
  });
});

// ---------------------------------------------------------------------------
// testSession (gated)
// ---------------------------------------------------------------------------

describe('Task 3: handleXTestSession (gated)', () => {
  it('throws when networkEnabled is false (never calls the core)', async () => {
    const core = vi.fn();
    await expect(handleXTestSession(
      { authToken: AUTH, ct0: CT0 },
      { networkEnabled: async () => false, testSession: core },
    )).rejects.toThrow(XSessionGatedError);
    expect(core).not.toHaveBeenCalled();
  });

  it('calls the core with the passed creds when networkEnabled is true and returns the (secret-free) result', async () => {
    const core = vi.fn(async (): Promise<SessionTestResult> => ({ valid: true, handle: 'ghostexodus' }));
    const out = await handleXTestSession(
      { authToken: AUTH, ct0: CT0 },
      { networkEnabled: async () => true, testSession: core },
    );
    expect(core).toHaveBeenCalledWith({ authToken: AUTH, ct0: CT0 });
    expect(out).toEqual({ valid: true, handle: 'ghostexodus' });
    assertNoSecret(out);
  });
});

// ---------------------------------------------------------------------------
// testStoredSession (gated, reads secrets main-side, writes metadata)
// ---------------------------------------------------------------------------

describe('Task 3: handleXTestStoredSession (gated)', () => {
  function deps(networkEnabled: boolean, core: SessionTestResult, meta = makeMetaStore(), secrets = makeSecretStore()) {
    secrets.store['x.accounts.abc.auth_token'] = AUTH;
    secrets.store['x.accounts.abc.ct0'] = CT0;
    return {
      secrets, meta,
      d: {
        networkEnabled: async () => networkEnabled,
        getSecret: secrets.getSecret,
        testSession: vi.fn(async () => core),
        listSessions: meta.listSessions,
        putSessionMeta: meta.putSessionMeta,
        now: () => '2026-07-05T00:00:00.000Z',
      },
    };
  }

  it('throws when networkEnabled is false', async () => {
    const { d } = deps(false, { valid: false, reason: 'expired' });
    await expect(handleXTestStoredSession('abc', d)).rejects.toThrow(XSessionGatedError);
  });

  it('reads the auth_token + ct0 secret keys main-side and passes them to the core', async () => {
    const { d } = deps(true, { valid: true, handle: 'ghostexodus' });
    await handleXTestStoredSession('abc', d);
    expect(d.getSecret).toHaveBeenCalledWith('x.accounts.abc.auth_token');
    expect(d.getSecret).toHaveBeenCalledWith('x.accounts.abc.ct0');
    expect(d.testSession).toHaveBeenCalledWith({ authToken: AUTH, ct0: CT0 });
  });

  it('on valid, stamps status=valid + handle + lastTestedAt and returns a secret-free result', async () => {
    const { d, meta } = deps(true, { valid: true, handle: 'ghostexodus' });
    meta.map.set('abc', { accountId: 'abc', label: 'Burner A', status: 'untested' });
    const out = await handleXTestStoredSession('abc', d);
    expect(out).toEqual({ valid: true, handle: 'ghostexodus' });
    expect(meta.map.get('abc')).toEqual({
      accountId: 'abc', label: 'Burner A', status: 'valid',
      handle: 'ghostexodus', lastTestedAt: '2026-07-05T00:00:00.000Z',
    });
    assertNoSecret(out);
    assertNoSecret([...meta.map.values()]);
  });

  it('on expired, stamps status=expired (no handle) and preserves the label', async () => {
    const { d, meta } = deps(true, { valid: false, reason: 'expired' });
    meta.map.set('abc', { accountId: 'abc', label: 'Burner A', status: 'valid', handle: 'old' });
    const out = await handleXTestStoredSession('abc', d);
    expect(out).toEqual({ valid: false, reason: 'expired' });
    expect(meta.map.get('abc')).toMatchObject({ label: 'Burner A', status: 'expired' });
  });

  it('on an inconclusive result (rate-limited/network) keeps the prior status but stamps lastTestedAt', async () => {
    const { d, meta } = deps(true, { valid: false, reason: 'rate-limited' });
    meta.map.set('abc', { accountId: 'abc', label: 'Burner A', status: 'valid', handle: 'ghostexodus' });
    await handleXTestStoredSession('abc', d);
    expect(meta.map.get('abc')).toMatchObject({
      status: 'valid', handle: 'ghostexodus', lastTestedAt: '2026-07-05T00:00:00.000Z',
    });
  });
});
