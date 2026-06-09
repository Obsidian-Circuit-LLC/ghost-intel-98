import { app } from 'electron';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest } from './manifest';
import { canonicalPluginHash, verifyPluginSignature, type PluginAsset } from './verify';
import { getPinnedKeysets, isApiCompatible, type TrustKeyset } from './trust';
import { createPluginContext, type ContextDeps } from './context';
import type { VerifiedPluginInfo, PluginStatus } from '../../shared/plugin-types';

const MAX_SIG_BYTES = 8192; // ML-DSA-65 sig ~3309 + Ed25519 64; generous cap, bound before verify

const verified: VerifiedPluginInfo[] = [];
const status: PluginStatus[] = [];
const handlers = new Map<string, (...args: unknown[]) => unknown>();

export function getVerified(): VerifiedPluginInfo[] { return [...verified]; }
export function getStatus(): PluginStatus[] { return [...status]; }
export function getHandlers(): Map<string, (...args: unknown[]) => unknown> { return handlers; }
export function _resetLoaderForTest(): void { verified.length = 0; status.length = 0; handlers.clear(); }

export interface LoaderOptions {
  isEnabled(id: string): boolean;
  keysets?: TrustKeyset[];          // defaults to getPinnedKeysets()
  contextDeps?: Partial<ContextDeps>;
}

function readAssets(dir: string): PluginAsset[] {
  const adir = join(dir, 'assets');
  if (!existsSync(adir)) return [];
  const out: PluginAsset[] = [];
  const seen = new Set<string>();
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(adir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const full = join(adir, r);
      if (statSync(full).isDirectory()) walk(r);
      else {
        if (seen.has(r)) throw new Error(`duplicate asset path: ${r}`);
        seen.add(r);
        out.push({ path: r, bytes: readFileSync(full) });
      }
    }
  };
  walk('');
  return out;
}

export async function loadPlugins(opts: LoaderOptions): Promise<void> {
  const keysets = opts.keysets ?? getPinnedKeysets();
  const root = join(app.getPath('userData'), 'plugins');
  if (!existsSync(root)) return;
  for (const id of readdirSync(root)) {
    const dir = join(root, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const manifestBuf = readFileSync(join(dir, 'manifest.json'));
      const manifest = parseManifest(JSON.parse(manifestBuf.toString('utf8')));
      if (manifest.id !== id) throw new Error(`manifest.id "${manifest.id}" != dir "${id}"`);
      if (!isApiCompatible(manifest.targetApiVersion)) throw new Error('incompatible API version');

      const mainBuf = readFileSync(join(dir, manifest.main));
      const rendBuf = readFileSync(join(dir, manifest.renderer));
      const sig = readFileSync(join(dir, 'signature.bin'));
      if (sig.length > MAX_SIG_BYTES) throw new Error('signature too large');
      const hash = canonicalPluginHash({ manifest: manifestBuf, main: mainBuf, renderer: rendBuf, assets: readAssets(dir) });
      if (!verifyPluginSignature(hash, sig, keysets)) throw new Error('signature verification failed');

      if (!opts.isEnabled(id)) { status.push({ id, loaded: false }); continue; }

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(join(dir, manifest.main)) as { register?: (ctx: unknown) => void };
      if (typeof mod.register !== 'function') throw new Error('main entry has no register(ctx)');
      const ctx = createPluginContext(manifest.id, manifest.capabilities, fullDeps(opts.contextDeps), handlers);
      mod.register(ctx);

      verified.push({ id, name: manifest.name, version: manifest.version, modules: manifest.modules, renderer: manifest.renderer });
      status.push({ id, loaded: true });
    } catch (err) {
      const e = err as Error;
      console.error(`[plugin:${id}]`, e.name, e.message);
      status.push({ id, loaded: false, error: e.message });
    }
  }
}

function fullDeps(partial?: Partial<ContextDeps>): ContextDeps {
  return {
    isNetworkEnabled: () => false,
    rawFetch: async () => { throw new Error('egress not wired'); },
    validateUrl: (u) => u,
    secretBackend: { get: async () => null, set: async () => {}, delete: async () => {} },
    entities: {},
    timelineAppend: async () => {},
    caseSidecar: { read: async () => null, write: async () => {} },
    pluginStore: { read: async () => null, write: async () => {}, list: async () => [], delete: async () => {} },
    ...partial
  };
}
