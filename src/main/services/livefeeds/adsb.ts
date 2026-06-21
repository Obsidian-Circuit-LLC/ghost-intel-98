/** ADS-B aircraft positions from adsb.lol (free, no key, ODbL). On-demand REST, gated by
 *  settings.geoint.networkEnabled; host hard-pinned; through safeFetch (SSRF-gated). */
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';
import { settingsStore } from '../../storage/json-fs';
import { boundsToRadius } from '@shared/livefeeds/bbox';
import { parseAdsb } from '@shared/livefeeds/adsbParse';
import type { Bounds, AircraftPos } from '@shared/livefeeds/types';

export async function fetchAdsb(bounds: Bounds): Promise<AircraftPos[]> {
  if (!(await settingsStore.read()).geoint?.networkEnabled) return [];
  const { lat, lon, radiusNm } = boundsToRadius(bounds);
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`;
  const res = await safeFetch(url, 4, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`adsb.lol HTTP ${res.status}`);
  return parseAdsb(JSON.parse(await readTextCapped(res)));
}
