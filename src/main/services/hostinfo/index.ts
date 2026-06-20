import { join } from 'node:path';
import { ensurePluginTor, torFetch } from '../../plugins/tor-egress';
import { secureReadText, secureWriteFile } from '../../storage/secure-fs';
import { dataRoot } from '../../storage/paths';
import { hostFromStreamUrl } from './extract';
import { resolveHost as resolveHostImpl } from './resolve';
import { makeHostInfoStore } from './store';
import type { HostInfo } from './types';

export interface HostInfoServiceDeps {
  resolveHost(streamUrl: string): Promise<HostInfo>;
  store: { load(host: string): Promise<HostInfo | null>; save(info: HostInfo): Promise<void> };
  hostOf(streamUrl: string): string;
}

/** Cache-first facade. Pure over injected deps for testing; the real singleton (hostInfoService)
 *  wires the Tor fetch + vault store below. */
export function makeHostInfoService(deps: HostInfoServiceDeps) {
  return {
    async resolve(streamUrl: string, opts: { force?: boolean } = {}): Promise<HostInfo> {
      const host = deps.hostOf(streamUrl);
      if (!opts.force && host) {
        const cached = await deps.store.load(host);
        if (cached) return cached;
      }
      const info = await deps.resolveHost(streamUrl);
      if (info.host) await deps.store.save(info);
      return info;
    }
  };
}

/** Tor JSON GET — the recon egress path. Throws on blocked / non-200 / parse failure so the resolver
 *  records a per-lookup error and continues. */
async function torFetchJson(url: string): Promise<unknown> {
  await ensurePluginTor();
  const resp = await torFetch(url, { headers: { Accept: 'application/dns-json' } });
  if (resp.blocked || resp.status !== 200) throw new Error(`hostinfo lookup ${resp.status}${resp.blocked ? ' blocked' : ''}`);
  return JSON.parse(resp.body);
}

const store = makeHostInfoStore({ indexPath: () => join(dataRoot(), 'hostinfo', 'index.json'), readText: secureReadText, writeFile: (p, d) => secureWriteFile(p, d), now: () => Date.now() });

export const hostInfoService = makeHostInfoService({
  resolveHost: (streamUrl) => resolveHostImpl(streamUrl, { fetchJson: torFetchJson, now: () => new Date().toISOString() }),
  store,
  hostOf: (streamUrl) => hostFromStreamUrl(streamUrl)?.host ?? ''
});

export type { HostInfo } from './types';
