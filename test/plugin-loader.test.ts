import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { canonicalPluginHash } from '../src/main/plugins/verify';
import { resolveInside } from '../src/main/plugins/paths';

const ROOT = mkdtempSync(join(tmpdir(), 'dcs98-plug-'));
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { loadPlugins, getVerified, getStatus, _resetLoaderForTest } from '../src/main/plugins/loader';

const ED_SEC = ed25519.utils.randomSecretKey();
const PQ = ml_dsa65.keygen();
const KEYSET = { edPub: ed25519.getPublicKey(ED_SEC), pqPub: PQ.publicKey };

function writePlugin(id: string, sign: boolean): void {
  const dir = join(ROOT, 'plugins', id);
  mkdirSync(dir, { recursive: true });
  const manifest = JSON.stringify({ id, name: id, version: '1.0.0', targetApiVersion: 1,
    modules: [{ key: `${id}:m`, title: id, glyph: 'x' }], capabilities: [], main: 'main.js', renderer: 'renderer.js' });
  const main = `module.exports.register = (ctx) => { globalThis.__loaded = (globalThis.__loaded||[]).concat(ctx.id); };`;
  const rend = `export const x = 1;`;
  writeFileSync(join(dir, 'manifest.json'), manifest);
  writeFileSync(join(dir, 'main.js'), main);
  writeFileSync(join(dir, 'renderer.js'), rend);
  const hash = canonicalPluginHash({ manifest: Buffer.from(manifest), main: Buffer.from(main), renderer: Buffer.from(rend), assets: [] });
  let sig = new Uint8Array(64 + 100);
  if (sign) {
    const ed = ed25519.sign(hash, ED_SEC);
    const pq = ml_dsa65.sign(hash, PQ.secretKey);
    sig = new Uint8Array(ed.length + pq.length); sig.set(ed, 0); sig.set(pq, ed.length);
  }
  writeFileSync(join(dir, 'signature.bin'), Buffer.from(sig));
}

beforeEach(() => {
  _resetLoaderForTest();
  (globalThis as Record<string, unknown>).__loaded = [];
});

describe('loadPlugins', () => {
  it('loads a validly-signed plugin and skips an unsigned one', async () => {
    writePlugin('good', true);
    writePlugin('bad', false);
    await loadPlugins({ isEnabled: () => true, keysets: [KEYSET] });
    expect((globalThis as Record<string, unknown>).__loaded).toEqual(['good']);
    expect(getVerified().map((v) => v.id)).toEqual(['good']);
    expect(getStatus().find((s) => s.id === 'bad')?.loaded).toBe(false);
  });

  it('does not throw when the plugins dir is absent', async () => {
    rmSync(join(ROOT, 'plugins'), { recursive: true, force: true });
    await expect(loadPlugins({ isEnabled: () => true, keysets: [KEYSET] })).resolves.toBeUndefined();
  });

  it('rejects a signed plugin whose manifest.main escapes the plugin dir (path confinement)', async () => {
    const id = 'escape-attempt';
    const dir = join(ROOT, 'plugins', id);
    mkdirSync(dir, { recursive: true });

    // manifest.main points outside the plugin directory
    const escapingMain = '../escape.js';
    const manifest = JSON.stringify({
      id, name: id, version: '1.0.0', targetApiVersion: 1,
      modules: [{ key: `${id}:m`, title: id, glyph: 'x' }],
      capabilities: [], main: escapingMain, renderer: 'renderer.js',
    });
    const rend = `export const x = 1;`;

    // Write renderer and a dummy file at the escaping path so the hash can be computed
    writeFileSync(join(dir, 'renderer.js'), rend);
    const escapeContent = `module.exports.register = () => {};`;
    writeFileSync(join(ROOT, 'plugins', 'escape.js'), escapeContent);

    // Sign with KEYSET — resolveInside throws before the read, so sig is never checked,
    // but we sign correctly to confirm it is path-confinement (not sig failure) that rejects.
    const mainBytes = Buffer.from(escapeContent);
    const rendBytes = Buffer.from(rend);
    const hash = canonicalPluginHash({
      manifest: Buffer.from(manifest),
      main: mainBytes,
      renderer: rendBytes,
      assets: [],
    });
    const ed = ed25519.sign(hash, ED_SEC);
    const pq = ml_dsa65.sign(hash, PQ.secretKey);
    const sig = new Uint8Array(ed.length + pq.length);
    sig.set(ed, 0); sig.set(pq, ed.length);

    writeFileSync(join(dir, 'manifest.json'), manifest);
    writeFileSync(join(dir, 'signature.bin'), Buffer.from(sig));

    // resolveInside must throw for the escaping path
    expect(() => resolveInside(dir, escapingMain)).toThrow(/path escape/);

    await expect(loadPlugins({ isEnabled: () => true, keysets: [KEYSET] })).resolves.toBeUndefined();
    expect(getVerified().map((v) => v.id)).not.toContain(id);
    const st = getStatus().find((s) => s.id === id);
    expect(st?.loaded).toBe(false);
  });
});
