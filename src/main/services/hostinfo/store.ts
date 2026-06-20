// Vault-backed cache of resolutions, one file hostinfo/index.json → Record<host, HostInfo>. Reads are
// fail-soft: a missing (ENOENT) or corrupt index is a cache miss (return null / treat as {}), never a
// throw. Freshness gated by TTL so stale hosting info re-resolves. fs deps + now() injected for tests;
// the real wiring passes secureReadText/secureWriteFile + Date.now.
import type { HostInfo } from './types';

export const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// `indexPath` is injected as a THUNK (resolved per-call, not at module load) so the real wiring's
// join(dataRoot(), …) — which needs the Electron app — is never evaluated at import time (that would
// break test collection). It returns an absolute path under dataRoot so the cache lands in the vault
// tree, not process.cwd(); tests pass a thunk returning a relative key for their in-memory fs.
export function makeHostInfoStore(deps: { indexPath(): string; readText(path: string): Promise<string>; writeFile(path: string, data: string): Promise<void>; now(): number }) {
  async function readIndex(): Promise<Record<string, HostInfo>> {
    let raw: string;
    try { raw = await deps.readText(deps.indexPath()); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw e; }
    try { return JSON.parse(raw) as Record<string, HostInfo>; }
    catch { return {}; } // corrupt → cache miss
  }
  return {
    async load(host: string): Promise<HostInfo | null> {
      const idx = await readIndex();
      const hit = idx[host];
      if (!hit) return null;
      const age = deps.now() - Date.parse(hit.resolvedAt);
      return Number.isFinite(age) && age >= 0 && age < TTL_MS ? hit : null;
    },
    async save(info: HostInfo): Promise<void> {
      const idx = await readIndex();
      idx[info.host] = info;
      await deps.writeFile(deps.indexPath(), JSON.stringify(idx, null, 2));
    }
  };
}

export type HostInfoStore = ReturnType<typeof makeHostInfoStore>;
