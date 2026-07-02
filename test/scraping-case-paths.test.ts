import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-scraping-case-paths-test' } }));

import {
  dataRoot,
  scrapingCasesRoot,
  scrapingCaseDir,
  scrapingCaseFile,
  scrapingBackupDir,
} from '../src/main/storage/paths';

describe('scraping-case paths', () => {
  const root = dataRoot();

  it('scrapingCasesRoot() nests under dataRoot()', () => {
    expect(scrapingCasesRoot()).toBe(`${root}/scraping-cases`);
  });

  it('scrapingCaseDir()/scrapingCaseFile() resolve for the socmint namespace', () => {
    expect(scrapingCaseDir('socmint', 'abc123')).toBe(`${root}/scraping-cases/socmint/abc123`);
    expect(scrapingCaseFile('socmint', 'abc123')).toBe(`${root}/scraping-cases/socmint/abc123/case.json`);
  });

  it('scrapingCaseDir()/scrapingCaseFile() resolve for the x namespace', () => {
    expect(scrapingCaseDir('x', 'def456')).toBe(`${root}/scraping-cases/x/def456`);
    expect(scrapingCaseFile('x', 'def456')).toBe(`${root}/scraping-cases/x/def456/case.json`);
  });

  it('scrapingBackupDir() points at the pre-v3.27.0 backup under the scraping-cases root', () => {
    expect(scrapingBackupDir()).toBe(`${root}/scraping-cases/backup-pre-v3.27.0`);
  });
});
