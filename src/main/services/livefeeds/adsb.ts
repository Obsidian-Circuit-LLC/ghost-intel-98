/** ADS-B aircraft positions from adsb.lol (free, no key, ODbL). On-demand REST, gated by
 *  settings.geoint.networkEnabled; host hard-pinned; through safeFetch (SSRF-gated).
 *  Retries up to 3 times with exponential back-off; throws AdsbError on final failure. */
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';
import { settingsStore } from '../../storage/json-fs';
import { boundsToRadius } from '@shared/livefeeds/bbox';
import { parseAdsb } from '@shared/livefeeds/adsbParse';
import { backoffDelaysMs, classifyAdsbError, AdsbError } from '@shared/livefeeds/adsbBackoff';
import type { Bounds, AircraftPos } from '@shared/livefeeds/types';

export async function fetchAdsb(bounds: Bounds): Promise<AircraftPos[]> {
  if (!(await settingsStore.read()).geoint?.networkEnabled) return [];
  const { lat, lon, radiusNm } = boundsToRadius(bounds);
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`;

  const delays = backoffDelaysMs();
  let lastStatus = 0;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await safeFetch(url, 4, { Accept: 'application/json' });
      if (res.ok) {
        return parseAdsb(JSON.parse(await readTextCapped(res)));
      }
      lastStatus = res.status;
      const isRetryable = res.status === 429 || res.status >= 500;
      if (!isRetryable || attempt === delays.length) break;
    } catch {
      // Network-level failure (timeout / DNS / connection refused) — the common "feed down"
      // case. safeFetch throws here rather than returning a status; treat it as retryable and
      // (on exhaustion) classify it as 'unavailable' (lastStatus 0) rather than letting a raw
      // error escape unwrapped — that's the readable-status guarantee this loop exists to give.
      lastStatus = 0;
      if (attempt === delays.length) break;
    }
    await new Promise<void>((r) => setTimeout(r, delays[attempt]));
  }

  throw new AdsbError(classifyAdsbError(lastStatus), lastStatus);
}
