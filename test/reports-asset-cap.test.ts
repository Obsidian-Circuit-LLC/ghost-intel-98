import { describe, it, expect } from 'vitest';
import { ensureReportAssetInput, ensureAssetInput } from '../src/main/security/validate';

// Whole-branch fix: report banners/photos were sharing the 2 MB invoice-logo cap, so a normal phone
// photo (3–8 MB) silently rejected. Reports get a 25 MB per-image cap; invoices keep 2 MB.
describe('ensureReportAssetInput (report photo cap)', () => {
  it('accepts a 3 MB image that the 2 MB invoice cap rejects', () => {
    const bytes = new Array(3_000_000).fill(1);
    expect(() => ensureAssetInput({ bytes, mime: 'image/jpeg' })).toThrow(/too large/i); // invoice cap: rejects
    expect(ensureReportAssetInput({ bytes, mime: 'image/jpeg' }).bytes.length).toBe(3_000_000); // report cap: accepts
  });
  it('still enforces the png/jpeg mime allowlist', () => {
    expect(() => ensureReportAssetInput({ bytes: [1, 2, 3], mime: 'image/gif' })).toThrow(/mime/i);
    expect(() => ensureReportAssetInput({ bytes: 'not-an-array', mime: 'image/png' })).toThrow(/byte array/i);
  });
});
