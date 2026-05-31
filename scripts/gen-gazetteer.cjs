/**
 * Generates resources/geoint/gazetteer.json for GeoINT offline geocoding.
 *
 * Provenance: the `world-countries` npm package (MIT) — country common names + the
 * country `latlng` centroid. NO coordinates are hand-written or fabricated.
 *
 * v1 is COUNTRY-LEVEL only: world-countries 5.1.0 does not provide capital-city
 * coordinates, and the 2-letter cca2 codes collide with common English words
 * (IN, IT, IS, BE, AT, OR, AM, US...) so they are deliberately excluded to avoid
 * false geocodes. Major cities can be added later from a license-clean cities dataset.
 *
 * Run: node scripts/gen-gazetteer.cjs
 */
const countries = require('world-countries');
const { writeFileSync, mkdirSync } = require('node:fs');

const entries = [];
for (const c of countries) {
  if (Array.isArray(c.latlng) && c.latlng.length === 2) {
    const lat = Number(c.latlng[0]);
    const lon = Number(c.latlng[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      entries.push({ name: c.name.common, lat, lon });
    }
  }
}
mkdirSync('resources/geoint', { recursive: true });
writeFileSync('resources/geoint/gazetteer.json', JSON.stringify(entries));
console.log('wrote ' + entries.length + ' gazetteer entries (country-level, world-countries MIT)');
