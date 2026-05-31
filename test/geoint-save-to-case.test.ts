import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Record<string, unknown[]> = {};
vi.mock('../src/main/storage/json-fs', () => ({
  caseStore: {
    addLink: vi.fn(async (id: string, url: string, title: string) => { calls.addLink = [id, url, title]; }),
    addTimeline: vi.fn(async (id: string, ev: { kind: string; message: string }) => { calls.addTimeline = [id, ev]; return { id: 't', at: '', ...ev }; })
  },
  noteStore: { write: vi.fn(async (id: string, name: string, body: string) => { calls.note = [id, name, body]; }) }
}));
const entityState: { list: { id: string; type: string; value: string }[] } = { list: [] };
vi.mock('../src/main/storage/entities', () => ({
  listAll: vi.fn(async () => entityState.list),
  create: vi.fn(async (input: { type: string; value: string }) => { const e = { id: 'new-ent', ...input }; entityState.list.push(e); return e; }),
  linkToCase: vi.fn(async (caseId: string, entityId: string) => { calls.linkToCase = [caseId, entityId]; })
}));
vi.mock('../src/main/geoint/case-events', () => ({ addCaseEvent: vi.fn(async (_id: string, item: { title: string }) => ({ ...item, id: 'saved', savedAt: 'now' })) }));

import { saveToCase } from '../src/main/geoint/save-to-case';
import * as caseEvents from '../src/main/geoint/case-events';
import * as entities from '../src/main/storage/entities';

const CASE = 'c1';
const item = { id: 'e1', sourceId: 's1', title: 'Quake in Mali', summary: 'm5', link: 'https://x/1', lat: 17, lon: -4, located: 'gazetteer' as const, place: 'Mali' };

beforeEach(() => { entityState.list = []; for (const k of Object.keys(calls)) delete calls[k]; vi.clearAllMocks(); });

describe('saveToCase', () => {
  it('record form: writes a saved-event record', async () => {
    await saveToCase(CASE, item, { form: 'record' });
    expect(caseEvents.addCaseEvent).toHaveBeenCalledWith(CASE, item);
  });
  it('link form: addLink with the item link + title', async () => {
    await saveToCase(CASE, item, { form: 'link' });
    expect(calls.addLink).toEqual([CASE, 'https://x/1', 'Quake in Mali']);
  });
  it('link form: rejects a non-http(s) link', async () => {
    await expect(saveToCase(CASE, { ...item, link: 'javascript:1' }, { form: 'link' })).rejects.toThrow();
  });
  it('note form: writes a note containing the title', async () => {
    await saveToCase(CASE, item, { form: 'note' });
    expect((calls.note as string[])[2]).toContain('Quake in Mali');
  });
  it('auto-creates + links a location entity from item.place', async () => {
    await saveToCase(CASE, item, { form: 'record' });
    expect(entities.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'location', value: 'Mali' }));
    expect(calls.linkToCase).toEqual([CASE, 'new-ent']);
  });
  it('reuses an existing location entity (find, not create)', async () => {
    entityState.list = [{ id: 'ex', type: 'location', value: 'Mali' }];
    await saveToCase(CASE, item, { form: 'record' });
    expect(entities.create).not.toHaveBeenCalled();
    expect(calls.linkToCase).toEqual([CASE, 'ex']);
  });
  it('emits a geo-event timeline entry', async () => {
    await saveToCase(CASE, item, { form: 'record' });
    expect((calls.addTimeline as [string, { kind: string }])[1].kind).toBe('geo-event');
  });
});
