import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

describe('searchlight channels', () => {
  it('exposes the expected channel set, all namespaced under searchlight:', () => {
    const g = (channels as Record<string, Record<string, string>>).searchlight;
    expect(g).toBeTruthy();
    const expected = ['catalog', 'startSweep', 'cancelSweep', 'importSites', 'listCases', 'saveCase', 'loadCase', 'deleteCase', 'exportCase', 'importCase', 'onSweepResult', 'onSweepDone', 'favicon', 'addCustomSite', 'exportSites', 'exportPdf'];
    expect(Object.keys(g).sort()).toEqual([...expected].sort());
    for (const v of Object.values(g)) expect(v.startsWith('searchlight:')).toBe(true);
  });
  it('channel values are globally unique', () => {
    const all = Object.values(channels as Record<string, Record<string, string>>).flatMap((grp) => Object.values(grp));
    expect(new Set(all).size).toBe(all.length);
  });
});
