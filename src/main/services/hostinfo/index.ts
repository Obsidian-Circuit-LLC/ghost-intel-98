import { join } from 'node:path';
import { ensurePluginTor, getPluginTor, torFetch } from '../../plugins/tor-egress';
import { secureReadText, secureWriteFile } from '../../storage/secure-fs';
import { dataRoot } from '../../storage/paths';
import { hostFromStreamUrl } from './extract';
import { resolveHost as resolveHostImpl, TorNotReadyError } from './resolve';
import { makeHostInfoStore } from './store';
import type { HostInfo } from './types';

export interface HostInfoServiceDeps {
  resolveHost(streamUrl: string, via: 'tor' | 'clearnet'): Promise<HostInfo>;
  store: { load(host: string): Promise<HostInfo | null>; save(info: HostInfo): Promise<void> };
  hostOf(streamUrl: string): string;
}

/** Cache-first facade. Pure over injected deps for testing; the real singleton (hostInfoService)
 *  wires the Tor fetch + vault store below. */
export function makeHostInfoService(deps: HostInfoServiceDeps) {
  return {
    async resolve(streamUrl: string, opts: { force?: boolean; via?: 'tor' | 'clearnet' } = {}): Promise<HostInfo> {
      const host = deps.hostOf(streamUrl);
      if (!opts.force && host) {
        const cached = await deps.store.load(host);
        if (cached) return cached;
      }
      const via = opts.via ?? 'tor';
      // via is stamped HERE, on a freshly-resolved result only — a cache hit above returns the
      // ALREADY-stamped cached info as-is, and the resolve-disabled path never reaches this service
      // at all (the gate short-circuits before calling resolve()).
      const info: HostInfo = { ...(await deps.resolveHost(streamUrl, via)), via };
      // Never persist a transient tor-not-ready partial: it would poison the 30-day cache so every
      // later non-force lookup keeps returning "Tor not ready" even after Tor bootstraps. Cache only
      // a result that actually ran against Tor (the background ensurePluginTor() warms it meanwhile).
      if (info.host && !info.errors.includes('tor-not-ready')) await deps.store.save(info);
      return info;
    }
  };
}

/** Tor JSON GET — the recon egress path. Throws on blocked / non-200 / parse failure so the resolver
 *  records a per-lookup error and continues.
 *
 *  Bootstrap fast-fail: if the dedicated plugin-egress Tor isn't bootstrapped yet, awaiting
 *  ensurePluginTor() would block this lookup on a Tor start that can take tens of seconds — the
 *  standalone Host Info panel and the stream-driven resolve would both hang. Instead we kick the
 *  start off in the BACKGROUND (fire-and-forget, so Tor warms for the next lookup) and immediately
 *  throw TorNotReadyError; resolveHost catches it per-lookup and returns a partial with a
 *  `tor-not-ready` marker. TOR-ONLY — there is no clearnet fallback (it would leak the real IP). */
export async function torFetchJson(url: string): Promise<unknown> {
  if (!getPluginTor()?.isBootstrapped()) {
    void ensurePluginTor().catch(() => { /* warm best-effort; a later lookup retries */ });
    throw new TorNotReadyError();
  }
  const resp = await torFetch(url, { headers: { Accept: 'application/dns-json' } });
  if (resp.blocked || resp.status !== 200) throw new Error(`hostinfo lookup ${resp.status}${resp.blocked ? ' blocked' : ''}`);
  return JSON.parse(resp.body);
}

/** Fail-fast bound matching torFetchJson's Tor-path TIMEOUT_MS (tor-egress.ts) — a stalled
 *  clearnet socket must not hang the resolve promise (and the Host Info UI) any longer than the
 *  Tor path would. */
const CLEARNET_TIMEOUT_MS = 30_000;

/** Clearnet JSON GET — the OPT-IN recon egress (settings.geoint.cctvResolveClearnet). Leaks the
 *  real IP by design; only selected when the user enabled + acknowledged clearnet resolution.
 *  Aborts at CLEARNET_TIMEOUT_MS for fail-fast parity with the Tor path. */
export async function clearnetFetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLEARNET_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/dns-json' }, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`hostinfo clearnet lookup ${resp.status}`);
    return await resp.json();
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('hostinfo clearnet lookup timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const store = makeHostInfoStore({ indexPath: () => join(dataRoot(), 'hostinfo', 'index.json'), readText: secureReadText, writeFile: (p, d) => secureWriteFile(p, d), now: () => Date.now() });

/** CHARTER decision point ("clearnet-off = no clearnet fetch"): maps the resolved egress route to
 *  its fetcher. Only via='clearnet' (the opt-in, acknowledged path) binds the real-IP-leaking
 *  clearnetFetchJson; every other value stays Tor-only. Extracted so this binding is unit-testable —
 *  an inverted ternary here would send default Tor-mode lookups out over clearnet and pass every
 *  behavioural test otherwise. */
export function fetchJsonForVia(via: 'tor' | 'clearnet'): (url: string) => Promise<unknown> {
  return via === 'clearnet' ? clearnetFetchJson : torFetchJson;
}

export const hostInfoService = makeHostInfoService({
  resolveHost: (streamUrl, via) => resolveHostImpl(streamUrl, { fetchJson: fetchJsonForVia(via), now: () => new Date().toISOString() }),
  store,
  hostOf: (streamUrl) => hostFromStreamUrl(streamUrl)?.host ?? ''
});

export type { HostInfo } from './types';
