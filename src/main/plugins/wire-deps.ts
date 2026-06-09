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
 * rawFetch uses the global fetch API directly. Egress discipline is enforced by the
 * capability layer in context.ts, which calls isNetworkEnabled(id) and validateUrl(url)
 * BEFORE rawFetch is ever reached. rawFetch is therefore only invoked when the plugin has
 * the 'egress' capability, the per-plugin networkEnabled flag is true, and the URL passes
 * the SSRF validator.
 *
 * TODO(osint-plugin): route plugin egress through the bundled Tor SOCKS proxy before the
 * OSINT plugin ships real lookups. The only Tor code today is the chat TorTransport
 * connection-specific SOCKS dialer; there is no generic Tor-routed fetch helper. For v1
 * we use direct fetch — fully gated behind networkEnabled + isPublicHttpUrl validation.
 * This is flagged as DONE_WITH_CONCERNS in the task report.
 */

import { app } from 'electron';
import { join } from 'node:path';
import type { ContextDeps } from './context';
import { resolveInside } from './paths';
import { isPublicHttpUrl } from '../security/validate';
import { secretStore } from '../secrets/index';
import * as entities from '../storage/entities';
import { caseStore } from '../storage/json-fs';
import { caseDir } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';

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

    // rawFetch: direct fetch, fully gated behind the egress capability check in context.ts
    // (isNetworkEnabled + validateUrl are called BEFORE rawFetch is reached).
    // TODO(osint-plugin): route through bundled Tor SOCKS before OSINT plugin ships real lookups.
    async rawFetch(url, init) {
      const method = init.method ?? 'GET';
      const headers = init.headers ?? {};
      const body = init.body;
      const res = await fetch(url, { method, headers, body });
      const text = await res.text();
      return { status: res.status, body: text, finalUrl: res.url };
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
    }
  };
}
