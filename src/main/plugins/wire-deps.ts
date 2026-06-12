/**
 * wire-deps.ts — builds a real ContextDeps object wired to the app's production stores.
 *
 * Design decisions:
 *
 * isNetworkEnabled MUST be synchronous (the PluginContext calls it inside a sync capability
 * check before every egress.fetch). We satisfy this by caching a snapshot of
 * settings.plugins at load time. The snapshot is populated once when buildContextDeps() is
 * called; callers should call refreshPluginNetSnapshot() after reading settings so the
 * snapshot is current. Runtime settings changes that happen AFTER startup will NOT be
 * reflected until a reload; this is acceptable for v1 — gate defaults to false (closed),
 * so nothing leaks from a stale snapshot.
 *
 * rawFetch routes through a dedicated compartmented Tor instance by default (ensurePluginTor +
 * torFetch); init.direct===true keeps the legacy direct path (directFetch, SSRF + credential-strip
 * + redirect handling unchanged). Egress discipline is enforced by the capability layer in
 * context.ts, which calls isNetworkEnabled(id) and validateUrl(url) BEFORE rawFetch is reached.
 * rawFetch is therefore only invoked when the plugin has the 'egress' capability, the per-plugin
 * networkEnabled flag is true, and the URL passes the SSRF validator.
 */

import { app } from 'electron';
import { join } from 'node:path';
import type { ContextDeps, PluginFetchInit, PluginFetchResponse } from './context';
import { resolveInside } from './paths';
import { isPublicHttpUrl, assertResolvedPublic } from '../security/validate';
import { secretStore } from '../secrets/index';
import * as entities from '../storage/entities';
import { caseStore } from '../storage/json-fs';
import { caseDir } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import { getEngagementController } from '../offensive/controller';
import { getBgConnManager } from '../bgconn/singleton';
import { makeBgConnSecrets } from '../bgconn/secrets';
import { ensurePluginTor, torFetch } from './tor-egress';

/**
 * Strip credential-bearing headers from a header map. Used when a plugin egress redirect
 * crosses to a different origin, so the original request's secrets are never forwarded to a
 * host they were not intended for (Authorization/Cookie/Proxy-Authorization + any X-*auth* /
 * X-*api-key* header, case-insensitive).
 */
function stripCredentialHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const n = k.toLowerCase();
    const isCred =
      n === 'authorization' ||
      n === 'cookie' ||
      n === 'proxy-authorization' ||
      (n.startsWith('x-') && (n.includes('auth') || /api-?key/.test(n)));
    if (!isCred) out[k] = v;
  }
  return out;
}

/** Per-plugin network-enable snapshot. Populated by refreshPluginNetSnapshot at startup. */
let _pluginNetSnapshot: Record<string, { networkEnabled?: boolean }> = {};

/**
 * Populate the synchronous isNetworkEnabled snapshot from a settings.plugins record.
 * Call this once after reading settings at startup (and whenever settings are refreshed).
 */
export function refreshPluginNetSnapshot(
  plugins: Record<string, { enabled?: boolean; networkEnabled?: boolean; settings?: Record<string, unknown> }> | undefined
): void {
  _pluginNetSnapshot = plugins ?? {};
}

/**
 * Direct (non-Tor) fetch path. This is the original rawFetch implementation, factored out
 * unchanged so it can be called when `init.direct === true`. All SSRF and credential-strip
 * invariants are preserved verbatim.
 *
 * Defense-in-depth stack:
 *   1. isPublicHttpUrl (textual host check) — also enforced upstream by validateUrl.
 *   2. assertResolvedPublic (DNS-resolve check) — rejects DNS rebinding / CNAME-to-private.
 *   3. redirect: 'manual' — each Location re-validated before following.
 *   4. Hop limit (max 5) — prevents redirect-loop DoS.
 *   5. Cross-origin credential strip + RFC 7231 method downgrade.
 */
async function directFetch(url: string, init: PluginFetchInit): Promise<PluginFetchResponse> {
  const MAX_HOPS = 5;
  const originalOrigin = new URL(url).origin;
  let method = init.method ?? 'GET';
  let headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body = init.body;
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    // Textual SSRF guard (defense in depth — also checked upstream by validateUrl).
    if (!isPublicHttpUrl(current)) {
      throw new Error(`plugin egress: URL rejected by SSRF validator (hop ${hop}) — ${current}`);
    }
    // DNS-resolve guard: rejects any hostname whose resolved addresses include private/loopback/metadata IPs.
    await assertResolvedPublic(new URL(current).hostname);
    const res = await fetch(current, { method, headers, body, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        // No Location header — return this redirect response as-is.
        const text = await res.text();
        return { status: res.status, body: text, finalUrl: current };
      }
      const next = new URL(loc, current).toString();
      // RFC 7231: 301/302/303 downgrade a non-GET/HEAD method to GET and drop the body;
      // only 307/308 preserve method + body.
      const m = method.toUpperCase();
      if (res.status !== 307 && res.status !== 308 && m !== 'GET' && m !== 'HEAD') {
        method = 'GET';
        body = undefined;
      }
      // Credential-leak guard: a redirect that crosses to a different origin must not carry
      // the original request's credential headers to the new host.
      if (new URL(next).origin !== originalOrigin) {
        headers = stripCredentialHeaders(headers);
      }
      current = next;
      continue;
    }
    const text = await res.text();
    return { status: res.status, body: text, finalUrl: current };
  }
  throw new Error('plugin egress: too many redirects');
}

/**
 * Build the real ContextDeps object. The caller is responsible for calling
 * refreshPluginNetSnapshot before (or as part of) app startup so that
 * isNetworkEnabled reflects the persisted settings.
 */
export function buildContextDeps(): ContextDeps {
  return {
    // SYNCHRONOUS — reads from the module-level snapshot populated at startup.
    isNetworkEnabled(id: string): boolean {
      return _pluginNetSnapshot[id]?.networkEnabled === true;
    },

    // URL SSRF validator: isPublicHttpUrl requires http(s) AND rejects loopback/private/
    // metadata IPs (textual check; a pre-flight DNS resolve via assertResolvedPublic is
    // performed by the geoint fetch path; plugin egress uses the same static check here).
    validateUrl(url: string): string {
      if (!isPublicHttpUrl(url)) {
        throw new Error(`plugin egress: URL rejected by SSRF validator — ${url}`);
      }
      return url;
    },

    // rawFetch: Tor by default; init.direct===true keeps the existing direct-fetch path.
    // Both paths are gated upstream by isPublicHttpUrl (validateUrl) + the egress cap check.
    // The direct path applies full SSRF + redirect + credential-strip (see directFetch above).
    // The Tor path (torFetch) does NOT follow redirects — wire-deps owns redirect policy and
    // can add it in a follow-up; v1 Tor path returns the first response (no auto-redirect).
    // Tor-down / SOCKS / exit failures surface as { blocked:true }, never silently fall through
    // to the direct path — ensurePluginTor rejects and torFetch rejects if Tor is not available.
    async rawFetch(url, init) {
      if (init.direct === true) return directFetch(url, init);
      await ensurePluginTor();
      return torFetch(url, init);
    },

    // Secrets backend: scoped by the context layer to plugin:${id}:${name} keys.
    secretBackend: {
      get: (k) => secretStore.get(k),
      set: (k, v) => secretStore.set(k, v),
      delete: (k) => secretStore.delete(k)
    },

    // Entity registry: passed through directly; the platform does not reshape it.
    entities,

    // Timeline: delegates to caseStore.addTimeline which stamps id + at.
    async timelineAppend(caseId, event) {
      const ev = event as { kind?: string; message?: string };
      await caseStore.addTimeline(caseId, {
        kind: (ev.kind as import('@shared/types').TimelineKind) ?? 'note',
        message: typeof ev.message === 'string' ? ev.message : ''
      });
    },

    // Case sidecar: arbitrary plugin-named JSON files stored inside the case dir,
    // encrypted at rest via secureReadText/secureWriteFile.
    caseSidecar: {
      async read(caseId, name) {
        const path = join(caseDir(caseId), `plugin-sidecar-${name}.json`);
        try {
          return await secureReadText(path);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw err;
        }
      },
      async write(caseId, name, data) {
        const path = join(caseDir(caseId), `plugin-sidecar-${name}.json`);
        await secureWriteFile(path, data);
      }
    },

    // Plugin-local storage: paths confined via resolveInside to userData/plugins/<id>/data/.
    // Files are encrypted at rest via secureReadFile/secureWriteFile.
    pluginStore: {
      async read(id, rel) {
        const base = join(app.getPath('userData'), 'plugins', id, 'data');
        const path = resolveInside(base, rel);
        const { readFile } = await import('node:fs/promises');
        try {
          const buf = await readFile(path);
          return new Uint8Array(buf);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw err;
        }
      },
      async write(id, rel, data) {
        const base = join(app.getPath('userData'), 'plugins', id, 'data');
        const path = resolveInside(base, rel);
        const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
        await secureWriteFile(path, buf);
      },
      async list(id, rel?) {
        const base = join(app.getPath('userData'), 'plugins', id, 'data');
        const dir = rel ? resolveInside(base, rel) : base;
        const { readdir } = await import('node:fs/promises');
        try {
          return await readdir(dir);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
          throw err;
        }
      },
      async delete(id, rel) {
        const base = join(app.getPath('userData'), 'plugins', id, 'data');
        const path = resolveInside(base, rel);
        const { rm } = await import('node:fs/promises');
        await rm(path, { force: true });
      }
    },

    // attackEgress: reads the LIVE controller each call so the proxy URL reflects the
    // current scan state (empty when no scan is running, live URL during an active scan).
    // The controller singleton is always set before any plugin can call ctx.attackEgress
    // (initEngagementController runs in registerIpc which runs before plugins load — see
    // index.ts whenReady; the singleton is set during that same tick even though the IIFE
    // is async, because initEngagementController is called synchronously within the IIFE
    // before any await that matters to the ordering guarantee).
    attackEgress: {
      proxyUrl: () => getEngagementController()?.attackEgressSurface()?.proxyUrl() ?? '',
      scopeContentHash: () => getEngagementController()?.attackEgressSurface()?.scopeContentHash() ?? ''
    },

    // bgConn: reads the LIVE manager each call (mirrors the attackEgress lazy pattern). The manager
    // singleton is set in index.ts whenReady BEFORE loadPlugins, so it is live from first plugin load.
    // isVaultLocked fails closed (true) when the manager is somehow not yet constructed.
    bgConn: {
      registerWorker: (w) => { getBgConnManager()?.register(w); },
      secrets: makeBgConnSecrets({
        get: (k) => secretStore.get(k),
        set: (k, v) => secretStore.set(k, v),
        delete: (k) => secretStore.delete(k)
      }),
      isVaultLocked: () => getBgConnManager()?.isVaultLocked() ?? true,
      noteReconnect: (connId) => { getBgConnManager()?.noteReconnect(connId); }
    }
  };
}
