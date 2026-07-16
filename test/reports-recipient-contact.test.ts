import { describe, it, expect } from 'vitest';
import { ensureReport } from '../src/main/security/validate';

describe('toContactId model + validator', () => {
  it('preserves a valid toContactId, like fromContactId', () => {
    const r = ensureReport({ id: 'r1', to: '', toContactId: 'c-recipient', blocks: [] });
    expect(r.toContactId).toBe('c-recipient');
  });

  it('leaves toContactId unset when absent', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [] });
    expect(r.toContactId).toBeUndefined();
  });

  it('drops an over-long toContactId', () => {
    const r = ensureReport({ id: 'r1', to: '', toContactId: 'x'.repeat(65), blocks: [] });
    expect(r.toContactId).toBeUndefined();
  });

  it('drops a non-string toContactId', () => {
    const r = ensureReport({ id: 'r1', to: '', toContactId: 12345, blocks: [] });
    expect(r.toContactId).toBeUndefined();
  });

  it('drops an empty-string toContactId', () => {
    const r = ensureReport({ id: 'r1', to: '', toContactId: '', blocks: [] });
    expect(r.toContactId).toBeUndefined();
  });
});
