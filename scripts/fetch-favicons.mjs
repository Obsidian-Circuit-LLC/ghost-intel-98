// Regenerates resources/searchlight/favicons.json — a committed snapshot of per-site
// favicons (data:image/png base64). Run manually and review the diff before commit.
// Network: fetches favicons from the listed sites' origins. Run from a context where
// that egress is acceptable (NOT part of the build — the build consumes the snapshot).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const db = JSON.parse(readFileSync(join(ROOT, 'resources/searchlight/maigret_sites.json'), 'utf8'));
const sites = db.sites ?? db;
const engines = db.engines ?? {};

// site -> origin (urlMain or url origin), resolving engine fields if needed
function originFor(info) {
  const merged = info.engine && engines[info.engine]?.site ? { ...engines[info.engine].site, ...info } : info;
  const u = merged.urlMain || merged.url;
  try { return new URL(u).origin; } catch { return null; }
}

async function fetchIcon(origin) {
  try {
    const res = await fetch(origin + '/favicon.ico', { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/image\//i.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 64 * 1024) return null; // skip empties / oversize
    const mime = ct.split(';')[0].trim();
    return `data:${mime.startsWith('image/') ? mime : 'image/png'};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

const out = {};
const entries = Object.entries(sites).filter(([, v]) => v && typeof v === 'object' && !v.disabled);
let done = 0;
for (const [name, info] of entries) {
  const origin = originFor(info);
  if (!origin) { continue; }
  const icon = await fetchIcon(origin);
  if (icon && icon.startsWith('data:image/')) out[name] = icon;
  if (++done % 100 === 0) console.error(`${done}/${entries.length}…`);
}
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(join(ROOT, 'resources/searchlight/favicons.json'), JSON.stringify(sorted));
console.error(`wrote ${Object.keys(sorted).length} favicons`);
