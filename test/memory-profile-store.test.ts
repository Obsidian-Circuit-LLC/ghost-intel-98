import { describe, it, expect } from 'vitest';
import { createProfileStore, type ProfileStoreIO } from '../src/main/services/memory/profile/profile-store';
import { normalizeItemText, type MemoryItem } from '../src/main/services/memory/profile/types';

/** In-memory fake IO — no real secure-fs, no filesystem. */
function makeFakeIO(initial: MemoryItem[] = []): ProfileStoreIO {
  let text: string | null = initial.length ? JSON.stringify(initial) : null;
  return {
    async read() { return text; },
    async write(t: string) { text = t; }
  };
}

function item(over: Partial<MemoryItem>): MemoryItem {
  return {
    id: 'i1',
    scope: 'global',
    text: 'Prefers Tor-only egress',
    normalized: normalizeItemText('Prefers Tor-only egress'),
    provenance: ['note:foo'],
    confidence: 0.5,
    createdAt: 1000,
    lastSeenAt: 1000,
    pinned: false,
    source: 'extractor',
    ...over
  };
}

describe('normalizeItemText', () => {
  it('lowercases, collapses whitespace, and trims', () => {
    expect(normalizeItemText('  Prefers   TOR-only\n\tEgress  ')).toBe('prefers tor-only egress');
  });

  it('is idempotent on already-normalized text', () => {
    const n = normalizeItemText('already normal');
    expect(normalizeItemText(n)).toBe(n);
  });
});

describe('createProfileStore (in-memory io)', () => {
  it('round-trips put/all', async () => {
    const store = createProfileStore(makeFakeIO());
    const a = item({ id: 'a', scope: 'global' });
    const b = item({ id: 'b', scope: 'case:c1' });
    await store.put([a, b]);
    const all = await store.all();
    expect(all).toHaveLength(2);
    expect(all.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('put upserts by id — replacing an existing item, leaving others untouched', async () => {
    const store = createProfileStore(makeFakeIO());
    await store.put([item({ id: 'a', confidence: 0.3 }), item({ id: 'b', confidence: 0.4 })]);
    await store.put([item({ id: 'a', confidence: 0.9, text: 'updated' })]);
    const all = await store.all();
    expect(all).toHaveLength(2);
    const a = all.find((i) => i.id === 'a')!;
    const b = all.find((i) => i.id === 'b')!;
    expect(a.confidence).toBe(0.9);
    expect(a.text).toBe('updated');
    expect(b.confidence).toBe(0.4);
  });

  it('byScope filters to only the requested scopes', async () => {
    const store = createProfileStore(makeFakeIO());
    await store.put([
      item({ id: 'g1', scope: 'global' }),
      item({ id: 'c1', scope: 'case:c1' }),
      item({ id: 'c2', scope: 'case:c2' }),
      item({ id: 's1', scope: 'subject:foo' })
    ]);
    const filtered = await store.byScope(['global', 'case:c1']);
    expect(filtered.map((i) => i.id).sort()).toEqual(['c1', 'g1']);
  });

  it('remove deletes only the named ids', async () => {
    const store = createProfileStore(makeFakeIO());
    await store.put([item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]);
    await store.remove(['b']);
    const all = await store.all();
    expect(all.map((i) => i.id).sort()).toEqual(['a', 'c']);
  });

  it('wipe(scope) removes only that scope, leaving others intact', async () => {
    const store = createProfileStore(makeFakeIO());
    await store.put([
      item({ id: 'g1', scope: 'global' }),
      item({ id: 'c1', scope: 'case:c1' }),
      item({ id: 'c2', scope: 'case:c1' })
    ]);
    await store.wipe('case:c1');
    const all = await store.all();
    expect(all.map((i) => i.id)).toEqual(['g1']);
  });

  it('wipe() with no scope clears everything', async () => {
    const store = createProfileStore(makeFakeIO());
    await store.put([item({ id: 'a' }), item({ id: 'b', scope: 'case:c1' })]);
    await store.wipe();
    expect(await store.all()).toEqual([]);
  });

  it('all() on an empty/missing store returns []', async () => {
    const store = createProfileStore(makeFakeIO());
    expect(await store.all()).toEqual([]);
  });

  it('tolerates a read() that returns null (missing file) as an empty profile', async () => {
    const io: ProfileStoreIO = { read: async () => null, write: async () => undefined };
    const store = createProfileStore(io);
    expect(await store.all()).toEqual([]);
    expect(await store.byScope(['global'])).toEqual([]);
  });
});
