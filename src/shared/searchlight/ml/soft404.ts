/**
 * Soft-404 site classifier.
 *
 * Determines whether a site is "soft-404-prone" by probing it with a known-fake
 * handle and checking whether the response looks like a genuine profile page.
 *
 * Pure function of its inputs — NO Date.now / Math.random.
 */

import { extractSignals } from '../signals';
import type { MaigretSiteEntry, RawCheckResult } from '../types';

/**
 * Returns true iff the probe result suggests the site is soft-404-prone:
 * - statusCode === 200 (site claims the fake handle "exists"), AND
 * - No profile markers found (og_type_profile=0, has_json_ld_person=0, title_has_username=0).
 *
 * A genuine 404, redirect, or non-200 status means the site handles unknown handles
 * correctly — NOT soft-404-prone → returns false.
 * A 200 with profile markers for a fake handle is anomalous (some sites do this) —
 * treated as non-soft-404 so we do not incorrectly suppress future real-user results.
 */
export function isSoft404Site(
  raw: RawCheckResult,
  site: MaigretSiteEntry,
  fakeUrl: string,
): boolean {
  if (raw.statusCode !== 200) return false;

  const v = extractSignals(site, raw, fakeUrl);

  const hasProfileMarker =
    (v.og_type_profile ?? 0) !== 0 ||
    (v.has_json_ld_person ?? 0) !== 0 ||
    (v.title_has_username ?? 0) !== 0;

  return !hasProfileMarker;
}
