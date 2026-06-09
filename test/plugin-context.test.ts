import { describe, it, expect, vi } from 'vitest';
import { createPluginContext, type ContextDeps } from '../src/main/plugins/context';

function deps(networkEnabled: boolean): ContextDeps {
  return {
    isNetworkEnabled: (id) => networkEnabled,
    rawFetch: vi.fn(async () => ({ status: 200, body: 'ok', finalUrl: 'https://x' })),
    validateUrl: (u) => u,
    secretBackend: { get: vi.fn(async () => null), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
    entities: {} as never,
    timelineAppend: vi.fn(async () => {}),
    caseSidecar: { read: vi.fn(async () => null), write: vi.fn(async () => {}) },
    pluginStore: { read: vi.fn(async () => null), write: vi.fn(async () => {}), list: vi.fn(async () => []), delete: vi.fn(async () => {}) }
  };
}

describe('PluginContext capability scoping', () => {
  it('only declared capabilities are present', () => {
    const ctx = createPluginContext('osint', ['egress'], deps(true));
    expect(ctx.egress).toBeDefined();
    expect(ctx.secrets).toBeUndefined();
    expect(ctx.storage).toBeUndefined();
    expect(typeof ctx.registerHandler).toBe('function');
  });
  it('egress.fetch throws EEGRESSOFF and performs no fetch when disabled', async () => {
    const d = deps(false);
    const ctx = createPluginContext('osint', ['egress'], d);
    await expect(ctx.egress!.fetch('https://x')).rejects.toThrow(/EEGRESSOFF/);
    expect(d.rawFetch).not.toHaveBeenCalled();
  });
  it('secrets are namespaced to plugin:<id>:', async () => {
    const d = deps(true);
    const ctx = createPluginContext('osint', ['secrets'], d);
    await ctx.secrets!.set('shodan', 'k');
    expect(d.secretBackend.set).toHaveBeenCalledWith('plugin:osint:shodan', 'k');
  });
});
