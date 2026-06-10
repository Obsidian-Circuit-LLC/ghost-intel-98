import { app } from 'electron';
import { readdirSync, readFileSync, existsSync, statSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Module } from 'node:module';
import { parseManifest } from './manifest';
import { canonicalPluginHash, verifyPluginSignature, type PluginAsset } from './verify';
import { getPinnedKeysets, isApiCompatible, type TrustKeyset } from './trust';
import { createPluginContext, type ContextDeps } from './context';
import { resolveInside } from './paths';
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
      const lst = lstatSync(full);
      if (lst.isSymbolicLink()) throw new Error('symlink asset rejected: ' + r);
      if (lst.isDirectory()) walk(r);
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

      const mainBuf = readFileSync(resolveInside(dir, manifest.main));
      const rendBuf = readFileSync(resolveInside(dir, manifest.renderer));
      const sig = readFileSync(join(dir, 'signature.bin'));
      if (sig.length > MAX_SIG_BYTES) throw new Error('signature too large');
      const hash = canonicalPluginHash({ manifest: manifestBuf, main: mainBuf, renderer: rendBuf, assets: readAssets(dir) });
      if (!verifyPluginSignature(hash, sig, keysets)) throw new Error('signature verification failed');

      if (!opts.isEnabled(id)) { status.push({ id, loaded: false }); continue; }

      const mainPath = resolveInside(dir, manifest.main); // path-confinement (FIX 2); also used for compile
      const m = new Module(mainPath, undefined) as Module & {
        _compile(code: string, filename: string): unknown;
      };
      m.filename = mainPath;
      // _nodeModulePaths is internal but stable; allows plugin to require node builtins / its own deps
      (m as unknown as { paths: string[] }).paths =
        (Module as unknown as { _nodeModulePaths(d: string): string[] })._nodeModulePaths(dirname(mainPath));
      m._compile(mainBuf.toString('utf8'), mainPath); // compiles EXACT bytes that were hashed+verified
      const mod = (m as unknown as { exports: { register?: (ctx: unknown) => void } }).exports;
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

const teardowns = new Map<string, Array<() => Promise<void> | void>>();

export function registerTeardown(pluginId: string, fn: () => Promise<void> | void): void {
  const list = teardowns.get(pluginId) ?? [];
  list.push(fn);
  teardowns.set(pluginId, list);
}
export async function disablePlugin(pluginId: string): Promise<void> {
  const list = teardowns.get(pluginId) ?? [];
  teardowns.delete(pluginId);
  for (const fn of list) { try { await fn(); } catch (e) { console.error(`[plugin:${pluginId}] teardown`, e); } }
}
export async function disableAllPlugins(): Promise<void> {
  for (const id of [...teardowns.keys()]) await disablePlugin(id);
}
export function _resetTeardownsForTest(): void { teardowns.clear(); }
