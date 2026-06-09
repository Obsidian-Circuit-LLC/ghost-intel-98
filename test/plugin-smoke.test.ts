import { describe, it, expect, beforeAll, vi } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ROOT = mkdtempSync(join(tmpdir(), 'dcs98-smoke-'));
mkdirSync(join(ROOT, 'plugins'), { recursive: true });
cpSync(join(__dirname, 'fixtures/hello-plugin'), join(ROOT, 'plugins/hello'), { recursive: true });
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { loadPlugins, getVerified, _resetLoaderForTest } from '../src/main/plugins/loader';
import { invokePluginHandler } from '../src/main/plugins/invoke';

describe('plugin smoke (load → verify against PINNED dev key → register → invoke)', () => {
  beforeAll(async () => {
    _resetLoaderForTest();
    await loadPlugins({ isEnabled: () => true });
  });
  it('the fixture verifies against the pinned dev key and loads', () => {
    expect(getVerified().map((v) => v.id)).toContain('hello');
  });
  it('its registered handler is invokable', async () => {
    expect(await invokePluginHandler('hello', 'ping', ['x'])).toBe('pong:x');
  });
});
