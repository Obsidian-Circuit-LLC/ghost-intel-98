import { describe, it, expect } from 'vitest';
import { ensureReport } from '../src/main/security/validate';
import { mergeSettings } from '../src/main/storage/json-fs';
import { defaultSettings } from '../src/shared/types';

describe('report status/author + settings.reports merge', () => {
  it('defaults status to draft and author to Investigator', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [] });
    expect(r.status).toBe('draft');
    expect(r.author).toBe('Investigator');
  });
  it('keeps a valid status + author and clamps a bad status', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [], status: 'archived', author: 'GhostExodus' });
    expect(r.status).toBe('archived');
    expect(r.author).toBe('GhostExodus');
    expect(ensureReport({ id: 'r2', to: '', blocks: [], status: 'bogus' }).status).toBe('draft');
  });
  it('mergeSettings preserves a nested reports.author across an upgrade', () => {
    // an older persisted settings block that predates reports.author
    const merged = mergeSettings(defaultSettings, { reports: { author: 'GhostExodus' } } as any);
    expect(merged.reports?.author).toBe('GhostExodus');
    // and a default merge does not drop the reports key
    expect(mergeSettings(defaultSettings, {}).reports).toBeDefined();
  });
});
