/**
 * CISA Known Exploited Vulnerabilities (KEV) catalog — an advisory list, NOT a map layer.
 * KEV entries have ZERO geographic fields, so this module never produces GeoItems / pins; it
 * yields a trimmed KevEntry[] consumed by the GeoINT left-pane "CISA KEV / Alerts" panel.
 *
 * parseKev is pure + defensive (tolerates missing fields, caps and sorts). fetchKev routes through
 * the shared egress-gated safeFetch (SSRF re-validation on every redirect hop) + readTextCapped.
 * The IPC handler gates the network on settings.geoint.networkEnabled before calling fetchKev.
 */

import type { KevEntry } from '@shared/post-mvp-types';
import { safeFetch } from '../net/safe-fetch';
import { readTextCapped } from '../net/limits';

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
// The catalog is large (>1 MB and growing); allow more headroom than the default feed cap.
const KEV_MAX_BYTES = 16 * 1024 * 1024;
// Bound the entry count so a (hypothetically) bloated catalog can't drive an unbounded render list.
const MAX_KEV = 2000;
const MAX_FIELD = 4000;

const str = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s;
};

/** Map a CISA KEV catalog JSON object to a trimmed KevEntry[]. Pure + defensive: tolerates a
 *  missing/garbage `vulnerabilities` array (→ []) and missing per-entry fields (→ ''), drops
 *  entries with no cveID, caps at MAX_KEV, and sorts by dateAdded descending (newest first).
 *  Never emits coordinates — KEV has none. */
export function parseKev(json: unknown): KevEntry[] {
  const vulns = (json as { vulnerabilities?: unknown })?.vulnerabilities;
  if (!Array.isArray(vulns)) return [];
  const out: KevEntry[] = [];
  for (const raw of vulns) {
    const v = (raw ?? {}) as Record<string, unknown>;
    const cveID = str(v['cveID']).trim();
    if (!cveID) continue; // an entry with no CVE id is unusable for the advisory list
    out.push({
      cveID,
      vendorProject: str(v['vendorProject']),
      product: str(v['product']),
      vulnerabilityName: str(v['vulnerabilityName']),
      dateAdded: str(v['dateAdded']),
      shortDescription: str(v['shortDescription']),
      knownRansomwareCampaignUse: str(v['knownRansomwareCampaignUse'])
    });
  }
  // Newest first. ISO dates (YYYY-MM-DD) sort correctly as strings; localeCompare keeps it
  // deterministic and tolerates the odd malformed/empty date (which sorts to the bottom).
  out.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
  return out.slice(0, MAX_KEV);
}

/** Fetch + parse the CISA KEV catalog. Egress-gated by the caller (the IPC handler checks
 *  settings.geoint.networkEnabled first); safeFetch re-guards SSRF as defense in depth. Throws
 *  on a network/HTTP failure. Returns a trimmed, sorted KevEntry[] — never GeoItems / coordinates. */
export async function fetchKev(): Promise<KevEntry[]> {
  const res = await safeFetch(KEV_URL, 4, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`KEV HTTP ${res.status}`);
  const body = await readTextCapped(res, KEV_MAX_BYTES);
  return parseKev(JSON.parse(body));
}
