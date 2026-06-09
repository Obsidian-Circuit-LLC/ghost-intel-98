/**
 * plugin-wire-deps.test.ts
 *
 * Shape-level tests for buildContextDeps() and refreshPluginNetSnapshot().
 * Live store integration is smoke-tested in Task 16; here we assert:
 *   1. buildContextDeps() returns an object whose surface matches ContextDeps.
 *   2. isNetworkEnabled is a synchronous function.
 *   3. isNetworkEnabled reflects the injected snapshot (gate is CLOSED when
 *      networkEnabled is false or absent — nothing leaks from a stale snapshot).
 *   4. validateUrl accepts a real public URL and rejects loopback/private URLs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'dcs98-wiredeps-'));

// electron mock — must come before the module under test is imported.
import { vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

import { buildContextDeps, refreshPluginNetSnapshot } from '../src/main/plugins/wire-deps';

beforeEach(() => {
  // Reset snapshot to empty state before each test.
  refreshPluginNetSnapshot({});
});

describe('buildContextDeps()', () => {
  it('returns an object with all required ContextDeps surface keys', () => {
    const deps = buildContextDeps();
    expect(typeof deps.isNetworkEnabled).toBe('function');
    expect(typeof deps.rawFetch).toBe('function');
    expect(typeof deps.validateUrl).toBe('function');
    expect(typeof deps.secretBackend.get).toBe('function');
    expect(typeof deps.secretBackend.set).toBe('function');
    expect(typeof deps.secretBackend.delete).toBe('function');
    expect(deps.entities).toBeDefined();
    expect(typeof deps.timelineAppend).toBe('function');
    expect(typeof deps.caseSidecar.read).toBe('function');
    expect(typeof deps.caseSidecar.write).toBe('function');
    expect(typeof deps.pluginStore.read).toBe('function');
    expect(typeof deps.pluginStore.write).toBe('function');
    expect(typeof deps.pluginStore.list).toBe('function');
    expect(typeof deps.pluginStore.delete).toBe('function');
  });

  it('isNetworkEnabled is synchronous (returns a boolean, not a Promise)', () => {
    refreshPluginNetSnapshot({ 'test-plugin': { enabled: true, networkEnabled: true } });
    const deps = buildContextDeps();
    const result = deps.isNetworkEnabled('test-plugin');
    // Must be a plain boolean, NOT a Promise
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });

  it('isNetworkEnabled returns true only when networkEnabled === true in snapshot', () => {
    refreshPluginNetSnapshot({
      'enabled-net': { enabled: true, networkEnabled: true },
      'disabled-net': { enabled: true, networkEnabled: false },
      'no-net-key': { enabled: true }
    });
    const deps = buildContextDeps();
    expect(deps.isNetworkEnabled('enabled-net')).toBe(true);
    expect(deps.isNetworkEnabled('disabled-net')).toBe(false);
    expect(deps.isNetworkEnabled('no-net-key')).toBe(false);
  });

  it('isNetworkEnabled defaults to false for unknown plugin ids (gate closed)', () => {
    // Empty snapshot — no plugins configured
    const deps = buildContextDeps();
    expect(deps.isNetworkEnabled('unknown-plugin')).toBe(false);
    expect(deps.isNetworkEnabled('')).toBe(false);
  });

  it('isNetworkEnabled reflects a refreshed snapshot without rebuilding deps', () => {
    // Deps object is built BEFORE the snapshot is updated — simulates the v1 flow
    // where buildContextDeps() captures a closure over the module-level snapshot.
    const deps = buildContextDeps();

    // Initially closed
    expect(deps.isNetworkEnabled('my-plugin')).toBe(false);

    // After a snapshot refresh the same deps object reflects the new state
    refreshPluginNetSnapshot({ 'my-plugin': { enabled: true, networkEnabled: true } });
    expect(deps.isNetworkEnabled('my-plugin')).toBe(true);
  });

  it('validateUrl accepts a real public HTTPS URL', () => {
    const deps = buildContextDeps();
    expect(() => deps.validateUrl('https://example.com/api')).not.toThrow();
    expect(deps.validateUrl('https://example.com/api')).toBe('https://example.com/api');
  });

  it('validateUrl rejects loopback URLs (SSRF guard)', () => {
    const deps = buildContextDeps();
    expect(() => deps.validateUrl('http://127.0.0.1/internal')).toThrow(/SSRF validator/);
    expect(() => deps.validateUrl('http://localhost/secret')).toThrow(/SSRF validator/);
  });

  it('validateUrl rejects private-network URLs (SSRF guard)', () => {
    const deps = buildContextDeps();
    expect(() => deps.validateUrl('http://192.168.1.1/admin')).toThrow(/SSRF validator/);
    expect(() => deps.validateUrl('http://10.0.0.1/internal')).toThrow(/SSRF validator/);
  });

  it('validateUrl rejects non-http(s) URLs', () => {
    const deps = buildContextDeps();
    expect(() => deps.validateUrl('ftp://example.com/file')).toThrow(/SSRF validator/);
    expect(() => deps.validateUrl('file:///etc/passwd')).toThrow(/SSRF validator/);
  });
});

describe('refreshPluginNetSnapshot()', () => {
  it('accepts undefined (clears the snapshot)', () => {
    refreshPluginNetSnapshot({ 'some-plugin': { networkEnabled: true } });
    refreshPluginNetSnapshot(undefined);
    const deps = buildContextDeps();
    expect(deps.isNetworkEnabled('some-plugin')).toBe(false);
  });

  it('accepts an empty record (no plugins enabled)', () => {
    refreshPluginNetSnapshot({});
    const deps = buildContextDeps();
    expect(deps.isNetworkEnabled('any')).toBe(false);
  });
});
