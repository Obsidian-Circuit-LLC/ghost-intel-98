import { describe, it, expect, afterAll, vi } from 'vitest';
import { rm } from 'node:fs/promises';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-entities-test' } }));

import * as ent from '../src/main/storage/entities';

const CASE_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const CASE_B = '22222222-2222-4222-8222-bbbbbbbbbbbb';

afterAll(async () => { await rm('/tmp/ga98-entities-test', { recursive: true, force: true }); });

describe('entity registry + cross-case links', () => {
  it('creates, links, resolves, and sets relationship', async () => {
    const e = await ent.create({ type: 'person', value: 'John Doe' });
    expect((await ent.listAll()).some((x) => x.id === e.id)).toBe(true);

    await ent.linkToCase(CASE_A, e.id, { relationship: 'associate', attachmentFileNames: ['file.pdf'] });
    const resolved = await ent.resolveCaseEntities(CASE_A);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].entity.value).toBe('John Doe');
    expect(resolved[0].relationship).toBe('associate');
    expect(resolved[0].attachmentFileNames).toContain('file.pdf');

    await ent.setRelationship(CASE_A, e.id, 'family');
    expect((await ent.resolveCaseEntities(CASE_A))[0].relationship).toBe('family');
  });

  it('exposes the same entity across multiple cases (cross-case)', async () => {
    const e = await ent.create({ type: 'organisation', value: 'Acme' });
    await ent.linkToCase(CASE_A, e.id, {});
    await ent.linkToCase(CASE_B, e.id, {});
    const cases = (await ent.casesForEntity(e.id)).map((c) => c.caseId).sort();
    expect(cases).toEqual([CASE_A, CASE_B].sort());
  });

  it('merges one entity into another, repointing + deduping links', async () => {
    const keep = await ent.create({ type: 'person', value: 'Jane Smith' });
    const dup = await ent.create({ type: 'person', value: 'J. Smith' });
    await ent.linkToCase(CASE_A, dup.id, { attachmentFileNames: ['x.png'] });

    await ent.merge(keep.id, dup.id);

    const all = await ent.listAll();
    expect(all.some((x) => x.id === dup.id)).toBe(false);
    const kept = all.find((x) => x.id === keep.id);
    expect(kept?.aliases).toContain('J. Smith');
    expect(kept?.mergedFrom).toContain(dup.id);

    const resolvedA = await ent.resolveCaseEntities(CASE_A);
    expect(resolvedA.some((r) => r.entity.id === keep.id)).toBe(true);
    expect(resolvedA.some((r) => r.entity.id === dup.id)).toBe(false);
  });

  it('drops dangling links after the entity is removed', async () => {
    const e = await ent.create({ type: 'email', value: 'x@y.z' });
    await ent.linkToCase(CASE_B, e.id, {});
    await ent.remove(e.id);
    const resolved = await ent.resolveCaseEntities(CASE_B);
    expect(resolved.some((r) => r.entity.id === e.id)).toBe(false);
  });
});
