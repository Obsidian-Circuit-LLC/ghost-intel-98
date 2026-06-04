import { describe, it, expect } from 'vitest';
import { ensureBriefcaseNote } from '../src/main/security/validate';

describe('ensureBriefcaseNote', () => {
  it('keeps a valid note', () => {
    const n = ensureBriefcaseNote({ id: '11111111-1111-4111-8111-111111111111', name: 'todo', body: 'buy milk' });
    expect(n).toEqual({ id: '11111111-1111-4111-8111-111111111111', name: 'todo', body: 'buy milk' });
  });

  it('defaults a blank name and mints an id for an invalid one', () => {
    const n = ensureBriefcaseNote({ id: '', name: '   ', body: 'x' });
    expect(n.name).toBe('untitled');
    expect(n.id.length).toBeGreaterThan(0);
  });

  it('bounds name and body length', () => {
    const n = ensureBriefcaseNote({ id: 'i', name: 'x'.repeat(5000), body: 'y'.repeat(5_000_000) });
    expect(n.name.length).toBeLessThanOrEqual(200);
    expect(n.body.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('tolerates garbage', () => {
    const n = ensureBriefcaseNote(null);
    expect(n.name).toBe('untitled');
    expect(n.body).toBe('');
  });
});
