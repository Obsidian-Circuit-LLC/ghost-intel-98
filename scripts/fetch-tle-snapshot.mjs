// scripts/fetch-tle-snapshot.mjs
// Build-time: download the CelesTrak "active" group as 3-line TLE text and stage it as the bundled
// offline snapshot. Data, not an executable — if the network is unavailable, keep the existing file.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'resources', 'satellites');
const out = join(outDir, 'active-snapshot.tle');
const URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { get(res.headers.location).then(resolve, reject); return; }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let buf = ''; res.setEncoding('utf8'); res.on('data', (c) => (buf += c)); res.on('end', () => resolve(buf));
    }).on('error', reject);
  });
}

mkdirSync(outDir, { recursive: true });
try {
  console.log(`[fetch-tle-snapshot] downloading ${URL}`);
  const text = await get(URL);
  if (!/^1 /m.test(text)) throw new Error('response did not look like TLE text');
  writeFileSync(out, text, 'utf8');
  console.log(`[fetch-tle-snapshot] wrote ${out} (${text.length} bytes)`);
} catch (e) {
  if (existsSync(out)) { console.warn(`[fetch-tle-snapshot] fetch failed (${e.message}); keeping existing snapshot`); }
  else { console.warn(`[fetch-tle-snapshot] fetch failed and no snapshot present (${e.message}); shipping without offline data`); }
}
