/**
 * Generates resources/geoint/gazetteer.json for GeoINT offline geocoding.
 *
 * Provenance (two license-clean sources, NO coordinates hand-written or fabricated):
 *   - Cities: GeoNames `cities5000` (all cities with population > 5000), CC-BY 4.0.
 *     https://download.geonames.org/export/dump/cities5000.zip — SHA-256-pinned below,
 *     fail-closed on mismatch (mirrors the fetch-* scripts' integrity discipline).
 *   - Country centroids: the `world-countries` npm package (MIT) — country common name +
 *     the country `latlng` centroid.
 *
 * Cities give CITY-level resolution so RSS articles that name a city geocode to a map pin.
 * The dataset is ~tens of thousands of entries; the geocoder (src/main/geoint/geocode.ts)
 * is a phrase-index lookup that scales to it. Short/ambiguous names are dropped (see STOPLIST
 * and the min-length rule) to avoid false geocodes; country names are exempt.
 *
 * Run: node scripts/gen-gazetteer.cjs
 */
const { createHash } = require('node:crypto');
const { writeFileSync, mkdirSync } = require('node:fs');
const AdmZip = require('adm-zip');
const countries = require('world-countries');

const CITIES_URL = 'https://download.geonames.org/export/dump/cities5000.zip';
// SHA-256 of cities5000.zip, pinned 2026-06-13. Bump deliberately when GeoNames republishes,
// re-verifying the new archive. Empty string = capture mode (print the hash, do not enforce).
const CITIES_SHA256 = '58da751f67748b4d40545058591a9b7c463cbcf45f0188c5376e1fd2bbd18650';

// Same normalization the geocoder uses: lowercase Unicode letter-runs joined by single spaces.
function norm(s) {
  return (String(s).toLowerCase().match(/\p{L}+/gu) ?? []).join(' ');
}

// Common short English words whose normalized form collides with real place names and would
// produce false geocodes in ordinary prose. Countries are exempt from this filter.
const STOPLIST = new Set(
  'as is of or and the you eu us no so to in it be at am we he an on by my up do go'.split(' ')
);

async function downloadBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  console.log(`[gen-gazetteer] downloading ${CITIES_URL}`);
  const zipBuf = await downloadBuffer(CITIES_URL);

  const got = createHash('sha256').update(zipBuf).digest('hex');
  if (CITIES_SHA256) {
    if (got !== CITIES_SHA256) {
      console.error(
        `[gen-gazetteer] SHA-256 MISMATCH for cities5000.zip\n  want ${CITIES_SHA256}\n  got  ${got}\n  aborting (fail-closed)`
      );
      process.exit(1);
    }
    console.log(`[gen-gazetteer] cities5000.zip SHA-256 verified ✓ (${got})`);
  } else {
    console.log(`[gen-gazetteer] cities5000.zip SHA-256 = ${got} (capture mode — pin this in CITIES_SHA256)`);
  }

  // cities5000.zip contains a single TSV "cities5000.txt": tab-separated, no header.
  // Columns (0-indexed): 1 = name, 4 = latitude, 5 = longitude, 14 = population.
  const zip = new AdmZip(zipBuf);
  const tsvEntry = zip.getEntries().find((e) => e.entryName.endsWith('.txt'));
  if (!tsvEntry) {
    console.error('[gen-gazetteer] cities5000.zip did not contain a .txt TSV — aborting');
    process.exit(1);
  }
  const tsv = zip.readAsText(tsvEntry);

  // key (norm name) -> { name, lat, lon, pop }. Highest population wins on a normalized collision.
  const byKey = new Map();
  let cityRows = 0;
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const col = line.split('\t');
    const name = col[1];
    const lat = Number(col[4]);
    const lon = Number(col[5]);
    const pop = Number(col[14]) || 0;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = norm(name);
    if (!key) continue;
    // Drop false-positive names: too short, or a common English stopword.
    if (key.length < 4 || STOPLIST.has(key)) continue;
    cityRows += 1;
    const prev = byKey.get(key);
    if (!prev || pop > prev.pop) byKey.set(key, { name, lat, lon, pop });
  }
  console.log(`[gen-gazetteer] parsed ${cityRows} qualifying city rows → ${byKey.size} unique names`);

  // Merge country centroids. On an exact normalized collision, the COUNTRY wins (overwrites the city).
  let countryCount = 0;
  for (const c of countries) {
    if (!Array.isArray(c.latlng) || c.latlng.length !== 2) continue;
    const lat = Number(c.latlng[0]);
    const lon = Number(c.latlng[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = c.name.common;
    const key = norm(name);
    if (!key) continue;
    // Countries are exempt from the stoplist / min-length filter.
    byKey.set(key, { name, lat, lon, pop: Number.POSITIVE_INFINITY });
    countryCount += 1;
  }

  // Emit { name, lat, lon } only (drop the population helper field). Deterministic order: by key.
  const entries = [...byKey.keys()]
    .sort()
    .map((k) => {
      const v = byKey.get(k);
      return { name: v.name, lat: v.lat, lon: v.lon };
    });

  mkdirSync('resources/geoint', { recursive: true });
  writeFileSync('resources/geoint/gazetteer.json', JSON.stringify(entries));
  console.log(
    `[gen-gazetteer] wrote ${entries.length} gazetteer entries ` +
      `(${countryCount} countries [world-countries MIT] + cities [GeoNames cities5000 CC-BY 4.0])`
  );
})().catch((e) => {
  console.error(`[gen-gazetteer] failed: ${e.message}`);
  process.exit(1);
});
