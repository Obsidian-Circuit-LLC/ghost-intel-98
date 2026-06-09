import { protocol, net, app } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveInside } from './paths';
import { getVerified } from './loader';

export const PLUGIN_SCHEME = 'dcs98-plugin';

/** Pure mapping: dcs98-plugin://<id>/<path> -> absolute file path, or null if unverified / escapes. */
export function mapPluginUrl(url: string, pluginsRoot: string, verifiedIds: Set<string>): string | null {
  const u = new URL(url);
  const id = u.hostname;
  if (!verifiedIds.has(id)) return null;
  // Extract the raw (pre-normalisation) path from the URL string so that traversal sequences
  // like ../../ are caught before the URL parser silently collapses them.
  const prefix = `${PLUGIN_SCHEME}://${id}/`;
  const rawAfterHost = url.startsWith(prefix) ? url.slice(prefix.length) : u.pathname.replace(/^\/+/, '');
  const rawPathOnly = rawAfterHost.split('?')[0].split('#')[0];
  const rawRel = decodeURIComponent(rawPathOnly);
  if (rawRel.split('/').some((seg) => seg === '..')) return null;
  const rel = rawRel.replace(/^\/+/, '');
  try {
    return resolveInside(join(pluginsRoot, id), rel);
  } catch {
    return null;
  }
}

export function registerPluginProtocol(): void {
  const pluginsRoot = join(app.getPath('userData'), 'plugins');
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const verifiedIds = new Set(getVerified().map((v) => v.id));
    const file = mapPluginUrl(request.url, pluginsRoot, verifiedIds);
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
