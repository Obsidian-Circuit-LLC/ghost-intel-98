import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

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
});
