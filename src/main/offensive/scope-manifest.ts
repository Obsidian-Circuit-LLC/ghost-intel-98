import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

export class ScopeManifestError extends Error {
  constructor(m: string) { super(m); this.name = 'ScopeManifestError'; }
}

export type ScopeRule =
  | { kind: 'domain'; value: string }
  | { kind: 'cidr'; value: string };

export interface ScopeManifest {
  manifestId: string;
  mode: 'engagement' | 'bounty' | 'self' | 'lab';
  expiresAt: string;
  notBefore?: string;
  include: ScopeRule[];
  exclude: ScopeRule[];
  attestation?: { operator: string; attestedAt: string };
}

const MODES = new Set(['engagement', 'bounty', 'self', 'lab']);
export const CIDR_RE = /^[0-9a-fA-F:.]+\/\d{1,3}$/;
const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]+\.?$/i;

function rules(raw: unknown, field: string): ScopeRule[] {
  if (!Array.isArray(raw)) throw new ScopeManifestError(`${field} must be an array`);
  return raw.map((r, i) => {
    if (typeof r !== 'object' || r === null) throw new ScopeManifestError(`${field}[${i}] must be an object`);
    const o = r as Record<string, unknown>;
    if (o['kind'] === 'asn') throw new ScopeManifestError('asn scope rules require the IP-intelligence dataset, not yet available');
    if (o['kind'] === 'domain') {
      if (typeof o['value'] !== 'string') throw new ScopeManifestError(`${field}[${i}] bad domain`);
      // Accept either Unicode (münchen.de) or already-punycode (xn--mnchen-3ya.de) authoring;
      // store the punycode form. domainToASCII preserves a leading '*.' wildcard and returns ''
      // on invalid input. Validate the ASCII RESULT against DOMAIN_RE so DOMAIN_RE can keep
      // rejecting raw non-ASCII bytes while still admitting legitimate IDN rules.
      const ascii = domainToASCII(o['value']);
      if (ascii === '' || !DOMAIN_RE.test(ascii)) throw new ScopeManifestError(`${field}[${i}] bad domain`);
      return { kind: 'domain', value: ascii };
    }
    if (o['kind'] === 'cidr') {
      if (typeof o['value'] !== 'string' || !CIDR_RE.test(o['value'])) throw new ScopeManifestError(`${field}[${i}] bad cidr`);
      return { kind: 'cidr', value: o['value'] };
    }
    throw new ScopeManifestError(`${field}[${i}] unknown rule kind`);
  });
}

export function parseScopeManifest(raw: unknown, now: number = Date.now()): ScopeManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ScopeManifestError('manifest must be an object');
  const o = raw as Record<string, unknown>;
  const manifestId = o['manifestId'];
  if (typeof manifestId !== 'string' || manifestId.length === 0) throw new ScopeManifestError('manifestId required');
  if (typeof o['mode'] !== 'string' || !MODES.has(o['mode'])) throw new ScopeManifestError('unknown mode');
  const expiresAt = o['expiresAt'];
  if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) throw new ScopeManifestError('expiresAt invalid');
  if (Date.parse(expiresAt) <= now) throw new ScopeManifestError('manifest already expired');
  let notBefore: string | undefined;
  if (o['notBefore'] !== undefined) {
    if (typeof o['notBefore'] !== 'string' || Number.isNaN(Date.parse(o['notBefore']))) throw new ScopeManifestError('notBefore invalid');
    if (Date.parse(o['notBefore']) > Date.parse(expiresAt)) throw new ScopeManifestError('notBefore after expiresAt');
    notBefore = o['notBefore'];
  }
  const include = rules(o['include'], 'include');
  if (include.length === 0) throw new ScopeManifestError('at least one include rule required');
  const exclude = rules(o['exclude'] ?? [], 'exclude');
  const m: ScopeManifest = { manifestId, mode: o['mode'] as ScopeManifest['mode'], expiresAt, include, exclude };
  if (notBefore) m.notBefore = notBefore;
  if (o['attestation'] !== undefined) {
    const a = o['attestation'] as Record<string, unknown>;
    if (typeof a?.['operator'] === 'string' && typeof a?.['attestedAt'] === 'string') {
      m.attestation = { operator: a['operator'], attestedAt: a['attestedAt'] };
    }
  }
  return m;
}

/** Private/loopback/link-local/metadata ranges that must NOT be attacked unless the operator is in
 *  'lab' mode or explicitly scopes them. Injected into `exclude` for all non-lab modes so a domain
 *  include rule can't authorize a host that (via DNS) resolves to internal infrastructure. */
export const DEFAULT_PRIVATE_EXCLUDES: ScopeRule[] = [
  { kind: 'cidr', value: '127.0.0.0/8' },
  { kind: 'cidr', value: '10.0.0.0/8' },
  { kind: 'cidr', value: '172.16.0.0/12' },
  { kind: 'cidr', value: '192.168.0.0/16' },
  { kind: 'cidr', value: '169.254.0.0/16' },   // link-local incl. 169.254.169.254 cloud metadata
  { kind: 'cidr', value: '100.64.0.0/10' },     // CGNAT
  { kind: 'cidr', value: '0.0.0.0/8' },         // "this network"
  { kind: 'cidr', value: '::1/128' },           // v6 loopback
  { kind: 'cidr', value: 'fe80::/10' },         // v6 link-local
  { kind: 'cidr', value: 'fc00::/7' }           // v6 unique-local
];

/** Cloud-metadata excludes that are NON-NEGOTIABLE in every mode, including 'lab'. A 'lab' manifest
 *  reused against a cloud host must never be able to reach the instance metadata service (IMDS):
 *  the v4 link-local 169.254.169.254 and the AWS IPv6 IMDS endpoint fd00:ec2::254. DEFAULT_PRIVATE_EXCLUDES
 *  already covers these for non-lab modes via 169.254.0.0/16, but lab mode skips those broad ranges so
 *  loopback/RFC1918 labs work — hence the exact metadata addresses are pinned here independently. */
export const ALWAYS_EXCLUDE: ScopeRule[] = [
  { kind: 'cidr', value: '169.254.169.254/32' },
  { kind: 'cidr', value: 'fd00:ec2::254/128' }
];

/** Returns a manifest with default excludes prepended to `exclude`, idempotently (skips CIDRs already
 *  present). Non-'lab' modes get ALWAYS_EXCLUDE ∪ DEFAULT_PRIVATE_EXCLUDES. 'lab' mode keeps its broad
 *  reachability (loopback/RFC1918 labs) but STILL gets ALWAYS_EXCLUDE so a reused lab manifest can never
 *  hit cloud metadata. */
export function withDefaultExcludes(m: ScopeManifest): ScopeManifest {
  const defaults = m.mode === 'lab' ? ALWAYS_EXCLUDE : [...ALWAYS_EXCLUDE, ...DEFAULT_PRIVATE_EXCLUDES];
  const have = new Set(m.exclude.filter((r) => r.kind === 'cidr').map((r) => r.value));
  const seen = new Set<string>();
  const extra = defaults.filter((r) => {
    if (have.has(r.value) || seen.has(r.value)) return false;
    seen.add(r.value);
    return true;
  });
  if (extra.length === 0) return m;
  return { ...m, exclude: [...extra, ...m.exclude] };
}

export function scopeContentHash(m: ScopeManifest): string {
  const sortRules = (rs: ScopeRule[]): ScopeRule[] =>
    [...rs].sort((a, b) => (a.kind + a.value < b.kind + b.value ? -1 : 1));
  const canon = {
    manifestId: m.manifestId, mode: m.mode, expiresAt: m.expiresAt, notBefore: m.notBefore ?? null,
    include: sortRules(m.include), exclude: sortRules(m.exclude)
  };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
