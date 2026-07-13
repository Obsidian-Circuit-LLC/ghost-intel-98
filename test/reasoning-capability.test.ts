import { describe, it, expect, vi } from 'vitest';
import { createPluginContext } from '../src/main/plugins/context';
import type { ContextDeps } from '../src/main/plugins/context';

function deps(over: Partial<ContextDeps>): ContextDeps {
  return { isNetworkEnabled: () => false, rawFetch: async () => ({ status: 0, body: '', finalUrl: '' }), validateUrl: (u) => u,
    secretBackend: { get: async () => null, set: async () => {}, delete: async () => {} }, entities: {},
    timelineAppend: async () => {}, caseSidecar: { read: async () => null, write: async () => {} },
    pluginStore: { read: async () => null, write: async () => {}, list: async () => [], delete: async () => {} }, ...over } as ContextDeps;
}

describe('ctx.reasoning gate', () => {
  it('absent without the reasoning-runtime capability', () => {
    const ctx = createPluginContext('p', [], deps({ reasoning: { generate: vi.fn(), ensureModel: vi.fn(), verify: vi.fn() } as any }));
    expect(ctx.reasoning).toBeUndefined();
  });
  it('present with the capability; verify delegates to deps', () => {
    const verify = vi.fn(() => true);
    const ctx = createPluginContext('p', ['reasoning-runtime'], deps({ reasoning: { generate: vi.fn(), ensureModel: vi.fn(), verify } as any }));
    expect(ctx.reasoning).toBeTruthy();
    expect(ctx.reasoning!.verify(new Uint8Array([1]), new Uint8Array([2]))).toBe(true);
    expect(verify).toHaveBeenCalled();
  });
});
