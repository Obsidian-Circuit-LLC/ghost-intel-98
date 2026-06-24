// Regenerates resources/searchlight/favicons.json — a committed snapshot of per-site
// favicons (data:image base64, raster only — SVG is excluded to match the loader's
// trust-boundary filter in src/main/searchlight/site-db.ts). Run manually and review the
// diff before commit. Network: fetches favicons from the listed sites' origins. Run from a
// context where that egress is acceptable (NOT part of the build — the build consumes the
// snapshot). Bounded-concurrency pool; origin results are cached so shared origins fetch once.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CONCURRENCY = 48;
const TIMEOUT_MS = 6000;
const db = JSON.parse(readFileSync(join(ROOT, 'resources/searchlight/maigret_sites.json'), 'utf8'));
const sites = db.sites ?? db;
const engines = db.engines ?? {};

// site -> origin (urlMain or url origin), resolving engine fields if needed
function originFor(info) {
  const merged = info.engine && engines[info.engine]?.site ? { ...engines[info.engine].site, ...info } : info;
  const u = merged.urlMain || merged.url;
  try { return new URL(u).origin; } catch { return null; }
}

const originCache = new Map(); // origin -> dataUri | null (in-flight promise or resolved)
async function fetchIcon(origin) {
  if (originCache.has(origin)) return originCache.get(origin);
  const p = (async () => {
    try {
      const res = await fetch(origin + '/favicon.ico', { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\//i.test(ct) || /svg/i.test(ct)) return null; // raster only; exclude SVG
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > 64 * 1024) return null; // skip empties / oversize
      return `data:${ct};base64,${buf.toString('base64')}`;
    } catch { return null; }
  })();
  originCache.set(origin, p);
  return p;
}

const out = {};
const entries = Object.entries(sites)
  .filter(([, v]) => v && typeof v === 'object' && !v.disabled)
  .map(([name, info]) => [name, originFor(info)])
  .filter(([, origin]) => origin);

let done = 0;
async function worker(queue) {
  for (;;) {
    const item = queue.pop();
    if (!item) return;
    const [name, origin] = item;
    const icon = await fetchIcon(origin);
    if (icon && icon.startsWith('data:image/')) out[name] = icon;
    if (++done % 250 === 0) console.error(`${done}/${entries.length}…`);
  }
}

const queue = entries.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(join(ROOT, 'resources/searchlight/favicons.json'), JSON.stringify(sorted));
console.error(`wrote ${Object.keys(sorted).length} favicons (from ${entries.length} sites, ${originCache.size} distinct origins)`);
