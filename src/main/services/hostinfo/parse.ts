// Pure parsers for the resolver. RFC 8484 DoH JSON (cloudflare-dns) + RDAP-IP JSON (rdap.org). Each is
// defensive: malformed input yields empty/undefined, never throws. RDAP-IP field shapes vary by RIR;
// we target the common fields and omit what we can't find (see [speculative] in the spec).
import type { RdapInfo } from './types';

interface DohAnswer { type?: number; data?: string }
function answers(json: unknown): DohAnswer[] {
  const a = (json as { Answer?: unknown })?.Answer;
  return Array.isArray(a) ? (a as DohAnswer[]) : [];
}

export function parseDohA(json: unknown): string[] {
  return answers(json).filter((r) => r?.type === 1 && typeof r.data === 'string').map((r) => r.data as string);
}

export function parseDohPtr(json: unknown): string | undefined {
  const ptr = answers(json).find((r) => r?.type === 12 && typeof r.data === 'string')?.data;
  return ptr ? ptr.replace(/\.$/, '') : undefined;
}

/** Extract a vCard 'fn' (full name / org) from an RDAP entity's vcardArray. */
function vcardFn(entity: unknown): string | undefined {
  const arr = (entity as { vcardArray?: unknown }).vcardArray;
  if (!Array.isArray(arr) || !Array.isArray(arr[1])) return undefined;
  for (const field of arr[1] as unknown[]) {
    if (Array.isArray(field) && field[0] === 'fn' && typeof field[3] === 'string') return field[3];
  }
  return undefined;
}

export function parseIpRdap(json: unknown): RdapInfo {
  const out: RdapInfo = {};
  if (!json || typeof json !== 'object') return out;
  const o = json as Record<string, unknown>;
  // range: prefer handle, else start–end
  if (typeof o['handle'] === 'string' && (o['handle'] as string).includes('-')) out.range = (o['handle'] as string).trim();
  else if (typeof o['startAddress'] === 'string' && typeof o['endAddress'] === 'string') out.range = `${o['startAddress']} - ${o['endAddress']}`;
  if (typeof o['country'] === 'string') out.country = o['country'] as string;
  // asn: ARIN-style originas0 autnums
  const autnums = o['arin_originas0_originautnums'];
  if (Array.isArray(autnums) && typeof autnums[0] === 'number') out.asn = `AS${autnums[0]}`;
  // org: first entity vcard fn
  const entities = o['entities'];
  if (Array.isArray(entities)) {
    for (const e of entities) { const fn = vcardFn(e); if (fn) { out.org = fn; break; } }
  }
  return out;
}
