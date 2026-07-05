import { describe, it, expect } from 'vitest';
import {
  createSessionsStore,
  type SessionMeta,
  type SessionsStoreIO,
} from '../src/main/x/sessions-store';

// In-memory IO seam — no electron, no disk. Mirrors the ProfileStoreIO fake in
// test/memory-profile-facade.test.ts: the store is exercised through an injected
// read/write pair so the metadata logic is tested without a real Electron runtime.
function makeFakeIO(initial: Record<string, SessionMeta> | null = null): SessionsStoreIO & { raw(): string | null } {
  let text: string | null = initial ? JSON.stringify(initial) : null;
  return {
    async read() {
      return text;
    },
    async write(t: string) {
      text = t;
    },
    raw() {
      return text;
    },
  };
}

function meta(over: Partial<SessionMeta> & Pick<SessionMeta, 'accountId'>): SessionMeta {
  return {
    label: over.label ?? over.accountId,
    status: 'untested',
    ...over,
  };
}

describe('sessions-store', () => {
  it('put→list round-trips and lists in stable order (label asc, then accountId asc)', async () => {
    const io = makeFakeIO();
    const store = createSessionsStore(io);

    // Insert out of order; two share the label 'alpha' so the accountId tie-break shows.
    await store.put(meta({ accountId: 'id-z', label: 'zephyr', status: 'valid', handle: 'zed' }));
    await store.put(meta({ accountId: 'id-b', label: 'alpha' }));
    await store.put(meta({ accountId: 'id-a', label: 'alpha' }));
    await store.put(meta({ accountId: 'id-m', label: 'mid', username: 'mm' }));

    const list = await store.list();
    expect(list.map((s) => s.accountId)).toEqual(['id-a', 'id-b', 'id-m', 'id-z']);
    // round-trip preserves the non-secret fields
    expect(list.find((s) => s.accountId === 'id-z')).toMatchObject({
      accountId: 'id-z',
      label: 'zephyr',
      status: 'valid',
      handle: 'zed',
    });
    expect(list.find((s) => s.accountId === 'id-m')?.username).toBe('mm');
  });

  it('put overwrites an existing accountId in place (no duplicate rows)', async () => {
    const io = makeFakeIO();
    const store = createSessionsStore(io);
    await store.put(meta({ accountId: 'x1', label: 'first', status: 'untested' }));
    await store.put(meta({ accountId: 'x1', label: 'first', status: 'valid', handle: 'ghost', lastTestedAt: '2026-07-05T00:00:00.000Z' }));

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ accountId: 'x1', status: 'valid', handle: 'ghost' });
  });

  it('remove deletes only the named id', async () => {
    const io = makeFakeIO();
    const store = createSessionsStore(io);
    await store.put(meta({ accountId: 'keep', label: 'keep' }));
    await store.put(meta({ accountId: 'drop', label: 'drop' }));

    await store.remove('drop');

    const list = await store.list();
    expect(list.map((s) => s.accountId)).toEqual(['keep']);
  });

  it('remove of an absent id is a no-op (does not throw)', async () => {
    const io = makeFakeIO();
    const store = createSessionsStore(io);
    await store.put(meta({ accountId: 'keep', label: 'keep' }));
    await expect(store.remove('nope')).resolves.toBeUndefined();
    expect((await store.list()).map((s) => s.accountId)).toEqual(['keep']);
  });

  it('migrateLegacyAccounts adds untested metadata for unknown ids and leaves existing metadata untouched', async () => {
    const io = makeFakeIO();
    const store = createSessionsStore(io);
    // Pre-existing rich metadata for 'known'
    await store.put(meta({ accountId: 'known', label: 'My Handle', status: 'valid', handle: 'realhandle', username: 'realhandle' }));

    await store.migrate(['known', 'legacy1', 'legacy2']);

    const list = await store.list();
    const known = list.find((s) => s.accountId === 'known');
    // untouched — migration must never overwrite existing metadata
    expect(known).toMatchObject({ label: 'My Handle', status: 'valid', handle: 'realhandle' });
    // new ids get synthesized { label:<id>, status:'untested' }
    expect(list.find((s) => s.accountId === 'legacy1')).toMatchObject({ accountId: 'legacy1', label: 'legacy1', status: 'untested' });
    expect(list.find((s) => s.accountId === 'legacy2')).toMatchObject({ accountId: 'legacy2', label: 'legacy2', status: 'untested' });
    expect(list).toHaveLength(3);
  });

  it('migrateLegacyAccounts on an empty id list leaves the store unchanged', async () => {
    const io = makeFakeIO(null);
    const store = createSessionsStore(io);
    await store.migrate([]);
    expect(await store.list()).toEqual([]);
  });

  it('never persists a secret field even if one is passed in (defence in depth)', async () => {
    const io = makeFakeIO();
    const store = createSessionsStore(io);
    // A caller mistakenly hands over an object carrying cookie material.
    const dirty = {
      accountId: 'sec',
      label: 'leaky',
      status: 'valid',
      handle: 'ghost',
      auth_token: 'AUTHTOKENSECRET',
      ct0: 'CT0SECRET',
    } as unknown as SessionMeta;
    await store.put(dirty);

    const raw = io.raw() ?? '';
    expect(raw).not.toContain('AUTHTOKENSECRET');
    expect(raw).not.toContain('CT0SECRET');
    expect(raw).not.toContain('auth_token');
    expect(raw).not.toContain('ct0');

    const stored = (await store.list())[0] as unknown as Record<string, unknown>;
    expect(stored.auth_token).toBeUndefined();
    expect(stored.ct0).toBeUndefined();
    expect(stored).toMatchObject({ accountId: 'sec', label: 'leaky', status: 'valid', handle: 'ghost' });
  });

  it('list on a fresh (never-written) store returns []', async () => {
    const io = makeFakeIO(null);
    const store = createSessionsStore(io);
    expect(await store.list()).toEqual([]);
  });
});
