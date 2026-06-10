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

  // Charter check (persistent-background-connection final verification): granting the bgconn
  // capability must NOT widen or bypass plugin egress. The bgconn network path is the
  // manager-spawned subprocess over the separate Tor SOCKS — never ctx.egress. So a plugin holding
  // bgconn but NOT egress has no ctx.egress at all, and one holding BOTH still hits the SSRF gate
  // on loopback/socks targets.
  it('persistent-background-connection does NOT grant egress', () => {
    const d: ContextDeps = {
      ...deps(true),
      bgConn: { registerWorker: vi.fn(), secrets: {} as never, isVaultLocked: () => true, noteReconnect: vi.fn() }
    };
    const ctx = createPluginContext('tg', ['persistent-background-connection'], d);
    expect(ctx.bgConn).toBeDefined();
    expect(ctx.egress).toBeUndefined(); // no egress capability ⇒ no fetch surface
  });

  it('bgconn + egress: egress.fetch still rejects loopback/socks via the SSRF gate', async () => {
    const ssrf = (u: string): string => {
      // Mirror the real wire-deps validator: reject non-public/non-http(s) targets.
      if (/^socks:/i.test(u) || /127\.0\.0\.1|localhost|::1/i.test(u) || !/^https?:/i.test(u)) {
        throw new Error(`plugin egress: URL rejected by SSRF validator — ${u}`);
      }
      return u;
    };
    const d: ContextDeps = {
      ...deps(true),
      validateUrl: ssrf,
      bgConn: { registerWorker: vi.fn(), secrets: {} as never, isVaultLocked: () => true, noteReconnect: vi.fn() }
    };
    const ctx = createPluginContext('tg', ['persistent-background-connection', 'egress'], d);
    expect(ctx.bgConn).toBeDefined();
    await expect(ctx.egress!.fetch('http://127.0.0.1:9050/x')).rejects.toThrow(/SSRF validator/);
    await expect(ctx.egress!.fetch('socks://127.0.0.1:9050')).rejects.toThrow(/SSRF validator/);
    expect(d.rawFetch).not.toHaveBeenCalled(); // gate fires before rawFetch
  });
});
