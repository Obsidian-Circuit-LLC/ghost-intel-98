import { describe, it, expect } from 'vitest';
import { describeSkippedFiles } from '../src/renderer/modules/ai-assistant/file-notice';

describe('describeSkippedFiles', () => {
  it('returns null when nothing was skipped', () => {
    expect(describeSkippedFiles([])).toBeNull();
  });
  it('names each skipped file with a human reason (the "why Q cannot see my file" fix)', () => {
    const msg = describeSkippedFiles([
      { name: 'report.docx', reason: 'binary' },
      { name: 'scan.pdf', reason: 'pdf-no-text-layer' },
    ]);
    expect(msg).toContain('report.docx');
    expect(msg).toMatch(/binary|office/i);
    expect(msg).toContain('scan.pdf');
    expect(msg).toMatch(/scanned|no text/i);
    expect(msg).toMatch(/Q won't see|won't see/i);
  });
  it('falls back to the raw reason for an unknown code', () => {
    expect(describeSkippedFiles([{ name: 'x', reason: 'weird-code' }])).toContain('weird-code');
  });
});
