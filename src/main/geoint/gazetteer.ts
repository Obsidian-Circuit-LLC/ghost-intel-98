/**
 * Loads the bundled gazetteer (resources/geoint/gazetteer.json) and exposes a cached
 * geocoder. Dev reads from the repo's resources/; production from process.resourcesPath
 * (electron-builder extraResources). A missing gazetteer disables geocoding rather than
 * crashing (items just stay list-only).
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { app } from 'electron';
import { makeGeocoder, type GazEntry, type Geocoder } from './geocode';

let cached: Geocoder | null = null;

function gazPath(): string {
  const dev = join(app.getAppPath(), 'resources', 'geoint', 'gazetteer.json');
  try { readFileSync(dev); return dev; } catch { return join(process.resourcesPath, 'geoint', 'gazetteer.json'); }
}

export function geocoder(): Geocoder {
  if (!cached) {
    try {
      cached = makeGeocoder(JSON.parse(readFileSync(gazPath(), 'utf8')) as GazEntry[]);
    } catch {
      cached = () => null; // gazetteer unavailable → geocoding disabled, not fatal
    }
  }
  return cached;
}
