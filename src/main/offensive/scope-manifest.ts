import { createHash } from 'node:crypto';

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
const CIDR_RE = /^[0-9a-fA-F:.]+\/\d{1,3}$/;
const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]+\.?$/i;

function rules(raw: unknown, field: string): ScopeRule[] {
  if (!Array.isArray(raw)) throw new ScopeManifestError(`${field} must be an array`);
  return raw.map((r, i) => {
    if (typeof r !== 'object' || r === null) throw new ScopeManifestError(`${field}[${i}] must be an object`);
    const o = r as Record<string, unknown>;
    if (o['kind'] === 'asn') throw new ScopeManifestError('asn scope rules require the IP-intelligence dataset, not yet available');
    if (o['kind'] === 'domain') {
      if (typeof o['value'] !== 'string' || !DOMAIN_RE.test(o['value'])) throw new ScopeManifestError(`${field}[${i}] bad domain`);
      return { kind: 'domain', value: o['value'] };
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

export function scopeContentHash(m: ScopeManifest): string {
  const sortRules = (rs: ScopeRule[]): ScopeRule[] =>
    [...rs].sort((a, b) => (a.kind + a.value < b.kind + b.value ? -1 : 1));
  const canon = {
    manifestId: m.manifestId, mode: m.mode, expiresAt: m.expiresAt, notBefore: m.notBefore ?? null,
    include: sortRules(m.include), exclude: sortRules(m.exclude)
  };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
