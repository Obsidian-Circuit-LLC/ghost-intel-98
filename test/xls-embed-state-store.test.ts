// @vitest-environment node
/**
 * The embedded X Listening Station's state document — his shape, our storage guarantees.
 *
 * GhostExodus's app keeps ONE document (`station-state.json`, `schemaVersion: 9`) holding 13
 * collections plus settings/tor/archive, and every one of his 53 handlers is written against that
 * shape. Our port split it into per-panel files and re-derived the semantics, which is the direct
 * cause of five consecutive display-picture releases. So the embed keeps HIS document, unchanged,
 * and hardens only how it is stored.
 *
 * Two substitutions, and they are the whole point of this module:
 *
 *  1. ENCRYPTED AT REST. His `persistState()` writes plaintext JSON to userData. Here the same
 *     bytes go through secure-fs.
 *
 *  2. A FAILED READ IS NOT AN EMPTY STATE. His `loadState()` catches ANY read error, falls back to
 *     `defaultState()` and immediately persists it — which is harmless when the only realistic
 *     failure is ENOENT on a plaintext file, and catastrophic under encryption: a locked vault
 *     would silently overwrite a populated campaign with an empty one. ENOENT still means first
 *     run; a locked vault or a failed GCM tag must REPORT and TOUCH NOTHING. This is the same rule
 *     v3.72.8 established for the panel loader, applied where the stakes are data loss rather than
 *     a blank screen.
 */
import { describe, it, expect, vi } from 'vitest';
import { EVAULTLOCKED, EDECRYPT } from '../src/main/storage/secure-fs';
import { defaultStationState, makeStationStore } from '../src/main/xls-embed/state-store';

function enoent(): NodeJS.ErrnoException {
  const e = new Error('ENOENT') as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

function coded(code: string): Error {
  const e = new Error(code) as Error & { code?: string };
  e.code = code;
  return e;
}

function deps(over: Partial<Parameters<typeof makeStationStore>[0]> = {}) {
  const writes: Array<{ path: string; data: string }> = [];
  const base = {
    readFile: vi.fn(async () => { throw enoent(); }),
    writeFile: vi.fn(async (path: string, data: string) => { writes.push({ path, data }); }),
    statePath: () => '/vault/xls/station-state.json',
    now: () => '2026-08-24T12:00:00.000Z',
    makeId: (() => { let n = 0; return () => `id-${++n}`; })(),
  };
  return { deps: { ...base, ...over }, writes };
}

describe('embedded station state — his document', () => {
  it('starts from HIS defaultState on first run', async () => {
    const { deps: d } = deps();
    const store = makeStationStore(d);
    const state = await store.load();
    expect(state.schemaVersion).toBe(9);
    // His default workspace record — the UI calls these campaigns; `cases` is his legacy field name.
    expect(state.cases).toHaveLength(1);
    expect(state.cases[0].name).toBe('Primary Campaign');
    expect(state.activeCaseId).toBe(state.cases[0].id);
    // All 13 collections present and empty.
    for (const k of ['profiles', 'posts', 'relationships', 'notes', 'presets', 'matches', 'entities',
                     'profileSnapshots', 'changeEvents', 'collectionRuns', 'networkSnapshots', 'networkEvents']) {
      expect(state[k as keyof typeof state], k).toEqual([]);
    }
    // A few of his settings defaults, verbatim.
    expect(state.settings.intervalMinutes).toBe(30);
    expect(state.settings.relationshipScrollPasses).toBe(8);
    expect(state.settings.networkStagnationLimit).toBe(7);
    expect(state.settings.collectImages).toBe(true);
    expect(state.settings.autoSweep).toBe(false);
  });

  it('round-trips his document unchanged', async () => {
    const saved = { ...defaultStationState(() => 't', () => 'c1'), lastSweepAt: '2026-08-01T00:00:00.000Z' };
    saved.posts.push({ id: 'p1', caseId: 'c1', username: 'alice' } as never);
    const { deps: d } = deps({ readFile: vi.fn(async () => Buffer.from(JSON.stringify(saved), 'utf8')) });
    const state = await makeStationStore(d).load();
    expect(state.schemaVersion).toBe(9);
    expect(state.posts).toHaveLength(1);
    expect(state.lastSweepAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('persists through the injected writer (encrypted at rest in production)', async () => {
    const { deps: d, writes } = deps();
    const store = makeStationStore(d);
    const state = await store.load();
    state.lastSweepAt = '2026-08-24T13:00:00.000Z';
    await store.save(state);
    const last = writes.at(-1)!;
    expect(last.path).toBe('/vault/xls/station-state.json');
    expect(JSON.parse(last.data).lastSweepAt).toBe('2026-08-24T13:00:00.000Z');
  });

  it('REPORTS a locked vault instead of resetting the document', async () => {
    const { deps: d, writes } = deps({ readFile: vi.fn(async () => { throw coded(EVAULTLOCKED); }) });
    const store = makeStationStore(d);
    await expect(store.load()).rejects.toThrow();
    // The decisive assertion: nothing was written. His version would have overwritten a populated
    // campaign with an empty default here.
    expect(writes).toHaveLength(0);
  });

  it('REPORTS a failed decrypt instead of resetting the document', async () => {
    const { deps: d, writes } = deps({ readFile: vi.fn(async () => { throw coded(EDECRYPT); }) });
    await expect(makeStationStore(d).load()).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it('does not reset on a corrupt document either — unreadable is not empty', async () => {
    const { deps: d, writes } = deps({ readFile: vi.fn(async () => Buffer.from('{not json', 'utf8')) });
    await expect(makeStationStore(d).load()).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it('serialises writes so a burst cannot interleave (his saveQueue)', async () => {
    const order: string[] = [];
    const { deps: d } = deps({
      writeFile: vi.fn(async (_p: string, data: string) => {
        const tag = JSON.parse(data).lastSweepAt as string;
        order.push(`start:${tag}`);
        await new Promise((r) => setTimeout(r, tag === 'a' ? 20 : 1));
        order.push(`end:${tag}`);
      }),
    });
    const store = makeStationStore(d);
    const s = await store.load();
    const p1 = store.save({ ...s, lastSweepAt: 'a' });
    const p2 = store.save({ ...s, lastSweepAt: 'b' });
    await Promise.all([p1, p2]);
    // 'a' must fully finish before 'b' starts, however long it takes.
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });
});

describe('first run carries the analyst\'s existing campaigns over', () => {
  it('uses the migrated document and persists it so the migration runs once', async () => {
    const migrated = { ...defaultStationState(() => 't', () => 'c1'), lastSweepAt: 'migrated' };
    const { deps: d, writes } = deps({ migrate: async () => migrated });
    const store = makeStationStore(d);
    const state = await store.load();
    expect(state.lastSweepAt).toBe('migrated');
    // Persisted immediately — a migration that ran but was not written would re-run every launch.
    expect(JSON.parse(writes.at(-1)!.data).lastSweepAt).toBe('migrated');
  });

  it('falls back to his default document when there is nothing to carry over', async () => {
    const { deps: d } = deps({ migrate: async () => null });
    expect((await makeStationStore(d).load()).cases[0].name).toBe('Primary Campaign');
  });

  it('NEVER consults the migration when a document already exists', async () => {
    const saved = defaultStationState(() => 't', () => 'c1');
    const migrate = vi.fn(async () => null);
    const { deps: d } = deps({
      readFile: vi.fn(async () => Buffer.from(JSON.stringify(saved), 'utf8')),
      migrate,
    });
    await makeStationStore(d).load();
    expect(migrate).not.toHaveBeenCalled();
  });

  it('does not migrate over a LOCKED vault — that is not a first run', async () => {
    const migrate = vi.fn(async () => defaultStationState(() => 't', () => 'c1'));
    const { deps: d, writes } = deps({
      readFile: vi.fn(async () => { throw coded(EVAULTLOCKED); }),
      migrate,
    });
    await expect(makeStationStore(d).load()).rejects.toThrow();
    expect(migrate).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
