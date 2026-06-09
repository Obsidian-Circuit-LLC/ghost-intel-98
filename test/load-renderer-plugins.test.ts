// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetRegistryForTest, listModules } from '../src/renderer/state/registry';
import { installPluginBridge, importPluginChunks } from '../src/renderer/plugins/load-renderer-plugins';

beforeEach(() => _resetRegistryForTest());

describe('renderer plugin loading', () => {
  it('installs window.dcs98Plugin with React + registerModule + api', () => {
    installPluginBridge();
    const w = window as unknown as { dcs98Plugin: { React: unknown; registerModule: unknown; api: unknown } };
    expect(w.dcs98Plugin.React).toBeDefined();
    expect(typeof w.dcs98Plugin.registerModule).toBe('function');
  });

  it('imports each chunk via an injected importer and tolerates a failing one', async () => {
    installPluginBridge();
    const importer = vi.fn(async (url: string) => {
      if (url.includes('good')) (window as unknown as { dcs98Plugin: { registerModule: (d: unknown) => void } })
        .dcs98Plugin.registerModule({ key: 'good:m', title: 'G', glyph: 'g', component: () => null, builtin: false });
      else throw new Error('boom');
    });
    await importPluginChunks(
      [{ id: 'good', name: 'G', version: '1', modules: [], renderer: 'renderer.js' },
       { id: 'bad', name: 'B', version: '1', modules: [], renderer: 'renderer.js' }],
      importer
    );
    expect(listModules().map((m) => m.key)).toContain('good:m');
  });
});
