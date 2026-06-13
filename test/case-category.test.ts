import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';

// json-fs → paths.ts imports electron's `app`; mock it to a temp userData dir so the
// real caseStore runs against real files without an Electron runtime.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-case-category-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { caseStore } from '../src/main/storage/json-fs';
import { caseDir, caseFile, ensureCaseLayout } from '../src/main/storage/paths';

const ROOT = '/tmp/ga98-case-category-test';

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe('case category persistence', () => {
  it('create() with a category persists and round-trips through list() and read()', async () => {
    const summary = await caseStore.create({ title: 'Work case', category: 'work' });
    expect(summary.category).toBe('work');

    const full = await caseStore.read(summary.id);
    expect(full.category).toBe('work');

    const list = await caseStore.list();
    const row = list.find((c) => c.id === summary.id);
    expect(row?.category).toBe('work');
  });

  it('create() with no category stores empty string and round-trips as ""', async () => {
    const summary = await caseStore.create({ title: 'No category' });
    expect(summary.category).toBe('');
    const list = await caseStore.list();
    expect(list.find((c) => c.id === summary.id)?.category).toBe('');
  });

  it('update({category}) changes the category and records it in the changed set', async () => {
    const summary = await caseStore.create({ title: 'Movable', category: 'inbox' });
    const updated = await caseStore.update(summary.id, { category: 'opChildSafety' });
    expect(updated.category).toBe('opChildSafety');
    // a category change must surface in the timeline
    expect(updated.timeline.some((e) => e.kind === 'updated' && e.message.includes('category'))).toBe(true);

    // clearing to '' moves it back to Uncategorized
    const cleared = await caseStore.update(summary.id, { category: '' });
    expect(cleared.category).toBe('');
  });

  it('a legacy on-disk case (meta with no category) lists as category:"" without throwing', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    await ensureCaseLayout(id);
    const ts = '2026-01-01T00:00:00.000Z';
    // Write a legacy meta with NO category field — exactly what predates this feature.
    await writeFile(
      caseFile(id),
      JSON.stringify({
        id,
        title: 'Legacy case',
        reference: '',
        description: '',
        status: 'open',
        priority: 'low',
        tags: [],
        createdAt: ts,
        updatedAt: ts,
        archived: false
      }),
      'utf8'
    );

    const list = await caseStore.list();
    const row = list.find((c) => c.id === id);
    expect(row).toBeDefined();
    expect(row?.category).toBe('');

    const full = await caseStore.read(id);
    // legacy read tolerates the absent field
    expect(full.category ?? '').toBe('');
  });

  it('trims and clips the category: strips control chars and caps length', async () => {
    const dirty = '\x00\x07work\x1f\x7f  '; // leading/trailing control + whitespace
    const summary = await caseStore.create({ title: 'Dirty cat', category: dirty });
    // control chars removed, then trimmed → 'work'
    expect(summary.category).toBe('work');

    const longName = 'A'.repeat(500);
    const longCase = await caseStore.create({ title: 'Long cat', category: longName });
    expect(longCase.category?.length).toBe(120);
    expect(longCase.category).toBe('A'.repeat(120));
  });
});

// Keep `caseDir` referenced so the import survives strict lint if the cleanup path changes.
export const _unused = caseDir;
