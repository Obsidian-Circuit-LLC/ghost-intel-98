import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
import { ensureAssetInput } from '../src/main/security/validate';

describe('invoices IPC channels', () => {
  it('exposes the CRUD + asset + export channels', () => {
    expect(channels.invoices.list).toBe('invoices:list');
    expect(channels.invoices.save).toBe('invoices:save');
    expect(channels.invoices.remove).toBe('invoices:remove');
    expect(channels.invoices.duplicate).toBe('invoices:duplicate');
    expect(channels.invoices.nextNumber).toBe('invoices:nextNumber');
    expect(channels.invoices.listProfiles).toBe('invoices:listProfiles');
    expect(channels.invoices.saveProfile).toBe('invoices:saveProfile');
    expect(channels.invoices.removeProfile).toBe('invoices:removeProfile');
    expect(channels.invoices.putAsset).toBe('invoices:putAsset');
    expect(channels.invoices.getAsset).toBe('invoices:getAsset');
    expect(channels.invoices.exportPdf).toBe('invoices:exportPdf');
  });
  it('exposes exportDocx', () => { expect(channels.invoices.exportDocx).toBe('invoices:exportDocx'); });
});

describe('ensureAssetInput', () => {
  it('accepts a png under the size cap', () => {
    expect(ensureAssetInput({ bytes: [1, 2, 3], mime: 'image/png' })).toEqual({ bytes: Buffer.from([1, 2, 3]), mime: 'image/png' });
  });
  it('rejects a non-image mime', () => { expect(() => ensureAssetInput({ bytes: [1], mime: 'text/html' })).toThrow(); });
  it('rejects oversize (> 2MB)', () => { expect(() => ensureAssetInput({ bytes: new Array(2_100_000).fill(0), mime: 'image/png' })).toThrow(); });
  it('rejects a non-array bytes', () => { expect(() => ensureAssetInput({ bytes: 'x', mime: 'image/png' })).toThrow(); });
});
