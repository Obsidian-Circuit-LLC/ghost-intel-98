import { describe, it, expect, vi } from 'vitest';
// search.ts imports json-fs (→ electron via paths) at module load; mock electron so the
// pure searchRecord can be imported in a plain node test.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-search-test' } }));
import { searchRecord } from '../src/main/services/search';
import type { CaseRecord } from '@shared/types';

const rec: CaseRecord = {
  id: 'x', title: 'Acme Investigation', reference: 'INV-1', status: 'open', priority: 'high', tags: ['fraud'],
  createdAt: '', updatedAt: '', archived: false, description: 'A case about Acme Corp wire fraud.',
  notes: [], attachments: [],
  links: [{ id: 'l', title: 'Acme site', url: 'https://acme.example', addedAt: '' }],
  timeline: [], tasks: [{ id: 't', text: 'Subpoena bank records', done: false, createdAt: '' }], reminders: [],
  entities: [{
    entity: { id: 'ent-1', type: 'organisation', value: 'Acme Corp', notes: '', aliases: ['ACME LLC'], createdAt: '', updatedAt: '' },
    linkIds: [], attachmentFileNames: []
  }],
  bioImages: []
};

describe('searchRecord (pure field matcher)', () => {
  it('matches across title / description / tags / tasks / links / entities incl. aliases', () => {
    expect(searchRecord(rec, 'acme').length).toBeGreaterThan(1);
    expect(searchRecord(rec, 'fraud').some((h) => h.field === 'description' || h.field === 'tags')).toBe(true);
    expect(searchRecord(rec, 'subpoena').some((h) => h.field === 'task')).toBe(true);
    expect(searchRecord(rec, 'acme llc').some((h) => h.field === 'entity')).toBe(true);
  });
  it('returns nothing for a non-match', () => {
    expect(searchRecord(rec, 'zzzznotpresent')).toHaveLength(0);
  });
});
