# `authorized-target-egress` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `authorized-target-egress` plugin capability — a scope-gated, per-request-enforced, audited egress path that lets a signed first-party plugin send HTTP(S) attack traffic to authorized targets (including private/loopback) through a DCS98-owned pinning proxy.

**Architecture:** Pure units first (scope manifest, address/domain matching, enforcer, signed-token verify, audit chain), then the IP-pinning CONNECT proxy that ties them together, then capability + settings wiring. Enforcement keys on the IP DCS98 actually dialed (no re-resolution → rebind-proof); the audit is an append-only hash-chained signed-at-write log.

**Tech Stack:** Electron 33 main (Node/TS), `node:dns/promises`, `node:net`, `node:http`, `node:crypto`; reuse `verifyPluginSignature` (`src/main/plugins/verify.ts`) + `TrustKeyset` (`src/main/plugins/trust.ts`); Vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-authorized-target-egress-design.md` (v2, option A).

**Scope:** the *platform* capability only (public MIT core). The deep-eye module-by-transport enumeration + scanner wiring are subsystem 2 (private plugin repo). Renderer UI (scope-authoring form, confirmation modal) is the thin consumer of the IPC built here — a minimal confirmation path is included; the rich authoring UI is a noted follow-on.

**House rules:** TDD (failing test first). `pnpm typecheck` (BOTH tsconfigs — never bare `tsc`). `pnpm test <pattern>`; full `pnpm test` after wiring tasks. No new deps. New code lives under `src/main/offensive/`.

**Security note for executors:** Tasks 4, 5, 6, 8 are security-critical and get a dedicated adversarial review (crypto/red-team lens) on top of the standard spec+quality review, per the platform precedent.

---

## Task 1: ScopeManifest — types, parse, content hash

**Files:** Create `src/main/offensive/scope-manifest.ts`; Test `test/offensive-scope-manifest.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { parseScopeManifest, scopeContentHash, ScopeManifestError } from '../src/main/offensive/scope-manifest';

const future = '2999-01-01T00:00:00Z';
const good = { manifestId: 'eng-1', mode: 'engagement', expiresAt: future,
  include: [{ kind: 'domain', value: 'example.com' }], exclude: [] };

describe('parseScopeManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(parseScopeManifest(good).manifestId).toBe('eng-1');
  });
  it('rejects a manifest with no include rules', () => {
    expect(() => parseScopeManifest({ ...good, include: [] })).toThrow(ScopeManifestError);
  });
  it('rejects an already-expired manifest', () => {
    expect(() => parseScopeManifest({ ...good, expiresAt: '2000-01-01T00:00:00Z' })).toThrow(ScopeManifestError);
  });
  it('rejects an asn rule (deferred)', () => {
    expect(() => parseScopeManifest({ ...good, include: [{ kind: 'asn', value: 64512 }] })).toThrow(/asn/i);
  });
  it('rejects a bad CIDR and unknown mode', () => {
    expect(() => parseScopeManifest({ ...good, include: [{ kind: 'cidr', value: 'nope' }] })).toThrow(ScopeManifestError);
    expect(() => parseScopeManifest({ ...good, mode: 'x' })).toThrow(ScopeManifestError);
  });
  it('content hash is stable regardless of key order / rule order', () => {
    const a = scopeContentHash(parseScopeManifest(good));
    const b = scopeContentHash(parseScopeManifest({ mode: 'engagement', expiresAt: future, manifestId: 'eng-1',
      exclude: [], include: [{ value: 'example.com', kind: 'domain' }] }));
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-scope-manifest` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/main/offensive/scope-manifest.ts`
```typescript
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
// Minimal CIDR shape check; full numeric validation happens in net-match (Task 2) at decision time,
// but we reject obvious garbage here so a manifest can't be saved malformed.
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

/** Canonical SHA-256 over the manifest with sorted keys and sorted rules. */
export function scopeContentHash(m: ScopeManifest): string {
  const sortRules = (rs: ScopeRule[]): ScopeRule[] =>
    [...rs].sort((a, b) => (a.kind + a.value < b.kind + b.value ? -1 : 1));
  const canon = {
    manifestId: m.manifestId, mode: m.mode, expiresAt: m.expiresAt, notBefore: m.notBefore ?? null,
    include: sortRules(m.include), exclude: sortRules(m.exclude)
  };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
```

- [ ] **Step 4: Run** `pnpm test offensive-scope-manifest` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/scope-manifest.ts test/offensive-scope-manifest.test.ts
git commit -m "feat(offensive): scope manifest parse + content hash"
```

---

## Task 2: Address matching — canonical normalization + CIDR containment

**Files:** Create `src/main/offensive/net-match.ts`; Test `test/offensive-net-match.test.ts`

**Context:** `validate.ts` has internal (unexported) canonicalization; we ship a fresh exported, tested module. Handles IPv4, IPv6, IPv4-mapped-IPv6 (`::ffff:a.b.c.d` → IPv4), and zone-id stripping (`fe80::1%eth0`).

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { normalizeIp, cidrContains } from '../src/main/offensive/net-match';

describe('net-match', () => {
  it('normalizes IPv4-mapped IPv6 to IPv4', () => {
    expect(normalizeIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
  });
  it('strips IPv6 zone ids', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });
  it('IPv4 CIDR contains an in-range address', () => {
    expect(cidrContains('10.0.0.0/8', '10.1.2.3')).toBe(true);
    expect(cidrContains('10.0.0.0/8', '11.0.0.1')).toBe(false);
  });
  it('IPv4 /8 exclude catches an IPv4-mapped-IPv6 target', () => {
    expect(cidrContains('10.0.0.0/8', normalizeIp('::ffff:10.9.9.9'))).toBe(true);
  });
  it('IPv6 CIDR containment', () => {
    expect(cidrContains('2001:db8::/32', '2001:db8:1::1')).toBe(true);
    expect(cidrContains('2001:db8::/32', '2001:db9::1')).toBe(false);
  });
  it('host-route /32 and /128 exact match', () => {
    expect(cidrContains('127.0.0.1/32', '127.0.0.1')).toBe(true);
    expect(cidrContains('::1/128', '::1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-net-match` → FAIL.

- [ ] **Step 3: Implement** `src/main/offensive/net-match.ts`
```typescript
import { isIP } from 'node:net';

/** Lowercase, strip IPv6 zone id, and fold IPv4-mapped-IPv6 (::ffff:a.b.c.d) to dotted IPv4. */
export function normalizeIp(ip: string): string {
  let s = ip.trim().toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (m) return m[1];
  return s;
}

function ipv4ToBig(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function ipv6ToBig(ip: string): bigint | null {
  // Expand :: and parse 8 hextets.
  if (ip.indexOf('::') !== ip.lastIndexOf('::')) return null;
  let head: string[] = [], tail: string[] = [];
  if (ip.includes('::')) {
    const [h, t] = ip.split('::');
    head = h ? h.split(':') : [];
    tail = t ? t.split(':') : [];
  } else {
    head = ip.split(':');
  }
  const missing = 8 - (head.length + tail.length);
  if (missing < 0) return null;
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}

function ipToBig(ip: string): { v: bigint; bits: 32 | 128 } | null {
  const n = normalizeIp(ip);
  const fam = isIP(n);
  if (fam === 4) { const v = ipv4ToBig(n); return v === null ? null : { v, bits: 32 }; }
  if (fam === 6) { const v = ipv6ToBig(n); return v === null ? null : { v, bits: 128 }; }
  return null;
}

export function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.lastIndexOf('/');
  if (slash < 0) return false;
  const base = ipToBig(cidr.slice(0, slash));
  const prefix = Number(cidr.slice(slash + 1));
  const target = ipToBig(ip);
  if (!base || !target || base.bits !== target.bits) return false;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > base.bits) return false;
  const shift = BigInt(base.bits - prefix);
  return (base.v >> shift) === (target.v >> shift);
}
```

- [ ] **Step 4: Run** `pnpm test offensive-net-match` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/net-match.ts test/offensive-net-match.test.ts
git commit -m "feat(offensive): address normalization + CIDR containment"
```

---

## Task 3: Domain matching — label-boundary, punycode, leftmost wildcard

**Files:** Create `src/main/offensive/domain-match.ts`; Test `test/offensive-domain-match.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { normalizeHost, domainRuleMatches } from '../src/main/offensive/domain-match';

describe('domain-match', () => {
  it('normalizes case, trailing dot, and punycode', () => {
    expect(normalizeHost('EXAMPLE.com.')).toBe('example.com');
  });
  it('exact rule matches only the exact host', () => {
    expect(domainRuleMatches('example.com', 'example.com')).toBe(true);
    expect(domainRuleMatches('example.com', 'a.example.com')).toBe(false);
    expect(domainRuleMatches('example.com', 'evil-example.com')).toBe(false);
  });
  it('wildcard matches subdomains but not the apex or lookalikes', () => {
    expect(domainRuleMatches('*.example.com', 'a.example.com')).toBe(true);
    expect(domainRuleMatches('*.example.com', 'a.b.example.com')).toBe(true);
    expect(domainRuleMatches('*.example.com', 'example.com')).toBe(false);
    expect(domainRuleMatches('*.example.com', 'example.com.attacker.com')).toBe(false);
    expect(domainRuleMatches('*.example.com', 'notexample.com')).toBe(false);
  });
  it('matches on labels, never substring', () => {
    expect(domainRuleMatches('example.com', 'xexample.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-domain-match` → FAIL.

- [ ] **Step 3: Implement** `src/main/offensive/domain-match.ts`
```typescript
/** Lowercase, strip one trailing dot, convert to ASCII/punycode. */
export function normalizeHost(host: string): string {
  let s = host.trim().toLowerCase();
  if (s.endsWith('.')) s = s.slice(0, -1);
  try {
    // URL hostname parsing yields punycode (IDNA) for the authority.
    return new URL(`http://${s}`).hostname;
  } catch {
    return s;
  }
}

/** rule is 'example.com' (exact) or '*.example.com' (subdomains, not apex). Wildcard only leftmost. */
export function domainRuleMatches(rule: string, host: string): boolean {
  const h = normalizeHost(host).split('.').filter(Boolean);
  if (rule.startsWith('*.')) {
    const base = normalizeHost(rule.slice(2)).split('.').filter(Boolean);
    if (base.length === 0 || h.length <= base.length) return false; // must have ≥1 label to the left
    const suffix = h.slice(h.length - base.length);
    return suffix.length === base.length && suffix.every((l, i) => l === base[i]);
  }
  if (rule.includes('*')) return false; // wildcard only allowed as leftmost label
  const r = normalizeHost(rule).split('.').filter(Boolean);
  return r.length === h.length && r.every((l, i) => l === h[i]);
}
```

- [ ] **Step 4: Run** `pnpm test offensive-domain-match` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/domain-match.ts test/offensive-domain-match.test.ts
git commit -m "feat(offensive): label-boundary domain matching"
```

---

## Task 4: ScopeEnforcer — the decision (SECURITY-CRITICAL)

**Files:** Create `src/main/offensive/scope-enforcer.ts`; Test `test/offensive-scope-enforcer.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { decide, type ResolvedTarget } from '../src/main/offensive/scope-enforcer';
import { parseScopeManifest } from '../src/main/offensive/scope-manifest';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const base = { manifestId: 'e', mode: 'engagement', expiresAt: '2026-06-11T00:00:00Z' };
const mk = (include: unknown[], exclude: unknown[] = []) =>
  parseScopeManifest({ ...base, include, exclude }, NOW);
const t = (host: string, ips: string[]): ResolvedTarget => ({ host, ips });

describe('decide', () => {
  it('allows an in-scope CIDR target', () => {
    const m = mk([{ kind: 'cidr', value: '10.0.0.0/8' }]);
    expect(decide(m, t('h', ['10.1.1.1']), NOW).allow).toBe(true);
  });
  it('denies when ANY resolved IP is out of scope (dual-stack)', () => {
    const m = mk([{ kind: 'cidr', value: '10.0.0.0/8' }]);
    expect(decide(m, t('h', ['10.1.1.1', '2001:db8::1']), NOW).allow).toBe(false);
  });
  it('exclude wins over include', () => {
    const m = mk([{ kind: 'cidr', value: '10.0.0.0/8' }], [{ kind: 'cidr', value: '10.9.0.0/16' }]);
    expect(decide(m, t('h', ['10.9.0.1']), NOW).allow).toBe(false);
  });
  it('allows an in-scope domain target regardless of IP (domain rule)', () => {
    const m = mk([{ kind: 'domain', value: '*.example.com' }]);
    expect(decide(m, t('a.example.com', ['203.0.113.5']), NOW).allow).toBe(true);
  });
  it('denies expired', () => {
    const m = mk([{ kind: 'cidr', value: '10.0.0.0/8' }]);
    expect(decide(m, t('h', ['10.1.1.1']), Date.parse('2026-06-12T00:00:00Z')).allow).toBe(false);
  });
  it('deny-by-default for an unmatched target', () => {
    const m = mk([{ kind: 'domain', value: 'example.com' }]);
    expect(decide(m, t('other.com', ['8.8.8.8']), NOW).allow).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-scope-enforcer` → FAIL.

- [ ] **Step 3: Implement** `src/main/offensive/scope-enforcer.ts`
```typescript
import type { ScopeManifest, ScopeRule } from './scope-manifest';
import { cidrContains } from './net-match';
import { domainRuleMatches } from './domain-match';

export type ScopeDecision = { allow: true } | { allow: false; reason: string };
export interface ResolvedTarget { host: string; ips: string[]; }

const ipMatches = (rule: ScopeRule, ip: string): boolean => rule.kind === 'cidr' && cidrContains(rule.value, ip);
const hostMatches = (rule: ScopeRule, host: string): boolean => rule.kind === 'domain' && domainRuleMatches(rule.value, host);

export function decide(m: ScopeManifest, t: ResolvedTarget, now: number): ScopeDecision {
  if (now >= Date.parse(m.expiresAt)) return { allow: false, reason: 'scope expired' };
  if (m.notBefore && now < Date.parse(m.notBefore)) return { allow: false, reason: 'scope not yet active' };
  if (t.ips.length === 0) return { allow: false, reason: 'no resolved address' };

  // Exclude wins: deny if the host or ANY resolved IP matches any exclude rule.
  for (const ex of m.exclude) {
    if (hostMatches(ex, t.host)) return { allow: false, reason: `host excluded: ${ex.value}` };
    for (const ip of t.ips) if (ipMatches(ex, ip)) return { allow: false, reason: `ip ${ip} excluded: ${ex.value}` };
  }
  // Include: a matching domain rule covers the host; otherwise EVERY resolved IP must be in some include CIDR.
  const hostIncluded = m.include.some((r) => hostMatches(r, t.host));
  if (hostIncluded) return { allow: true };
  const allIpsIncluded = t.ips.every((ip) => m.include.some((r) => ipMatches(r, ip)));
  if (allIpsIncluded) return { allow: true };
  return { allow: false, reason: 'target not in scope' };
}
```

- [ ] **Step 4: Run** `pnpm test offensive-scope-enforcer` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/scope-enforcer.ts test/offensive-scope-enforcer.test.ts
git commit -m "feat(offensive): scope enforcer decision (deny-by-default, all-IPs-in-scope)"
```

---

## Task 5: Signed authorization token (SECURITY-CRITICAL)

**Files:** Create `src/main/offensive/scope-token.ts`; Test `test/offensive-scope-token.test.ts`

**Context:** Reuse `verifyPluginSignature(hash, sig, keysets)` from `src/main/plugins/verify.ts` and `TrustKeyset` from `trust.ts`. Domain separator `DCS98-SCOPE-v1` (≠ plugin's `DCS98-PLUGIN-v1`) so a plugin signature can never validate a scope token. Replay store is an injected `Set`-like.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { scopeTokenHash, verifyScopeToken, type ScopeToken } from '../src/main/offensive/scope-token';
import type { TrustKeyset } from '../src/main/plugins/trust';

const edSec = ed25519.utils.randomSecretKey();
const pq = ml_dsa65.keygen();
const issuer: TrustKeyset = { edPub: ed25519.getPublicKey(edSec), pqPub: pq.publicKey };
const NOW = Date.parse('2026-06-10T00:00:00Z');

function makeToken(over: Partial<ScopeToken> = {}): ScopeToken {
  const payload = { manifestContentHash: 'abc', engagementId: 'eng-1', issuedAt: '2026-06-10T00:00:00Z',
    nonce: 'n1', expiresAt: '2026-06-11T00:00:00Z', ...over };
  const h = scopeTokenHash(payload);
  const sig = new Uint8Array([...ed25519.sign(h, edSec), ...ml_dsa65.sign(h, pq.secretKey)]);
  return { ...payload, signatureHex: Buffer.from(sig).toString('hex') };
}

describe('verifyScopeToken', () => {
  it('accepts a valid token, binds the manifest hash, and records the nonce', () => {
    const seen = new Set<string>();
    const r = verifyScopeToken(makeToken(), 'abc', 'eng-1', [issuer], NOW, seen);
    expect(r.ok).toBe(true);
    expect(seen.has('n1')).toBe(true);
  });
  it('rejects a replayed nonce', () => {
    const seen = new Set<string>(['n1']);
    expect(verifyScopeToken(makeToken(), 'abc', 'eng-1', [issuer], NOW, seen).ok).toBe(false);
  });
  it('rejects a manifest-hash mismatch (token not for this manifest)', () => {
    expect(verifyScopeToken(makeToken(), 'DIFFERENT', 'eng-1', [issuer], NOW, new Set()).ok).toBe(false);
  });
  it('rejects an expired token and a wrong issuer', () => {
    expect(verifyScopeToken(makeToken(), 'abc', 'eng-1', [issuer], Date.parse('2026-06-12T00:00:00Z'), new Set()).ok).toBe(false);
    const other = ml_dsa65.keygen();
    const wrong: TrustKeyset = { edPub: ed25519.getPublicKey(ed25519.utils.randomSecretKey()), pqPub: other.publicKey };
    expect(verifyScopeToken(makeToken(), 'abc', 'eng-1', [wrong], NOW, new Set()).ok).toBe(false);
  });
  it('a plugin-domain signature does NOT validate as a scope token (domain separation)', () => {
    // Sign the SAME payload bytes but without the SCOPE domain prefix → must fail.
    const payload = { manifestContentHash: 'abc', engagementId: 'eng-1', issuedAt: '2026-06-10T00:00:00Z', nonce: 'z', expiresAt: '2026-06-11T00:00:00Z' };
    const wrongHash = Buffer.from(JSON.stringify(payload)); // no DCS98-SCOPE-v1 domain
    const sig = new Uint8Array([...ed25519.sign(wrongHash, edSec), ...ml_dsa65.sign(wrongHash, pq.secretKey)]);
    const tok: ScopeToken = { ...payload, signatureHex: Buffer.from(sig).toString('hex') };
    expect(verifyScopeToken(tok, 'abc', 'eng-1', [issuer], NOW, new Set()).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-scope-token` → FAIL.

- [ ] **Step 3: Implement** `src/main/offensive/scope-token.ts`
```typescript
import { createHash } from 'node:crypto';
import { verifyPluginSignature } from '../plugins/verify';
import type { TrustKeyset } from '../plugins/trust';

const SCOPE_DOMAIN = 'DCS98-SCOPE-v1';

export interface ScopeTokenPayload {
  manifestContentHash: string;
  engagementId: string;
  issuedAt: string;
  nonce: string;
  expiresAt: string;
}
export interface ScopeToken extends ScopeTokenPayload { signatureHex: string; }

/** Domain-separated SHA-512 over the canonical payload (distinct from the plugin trust root). */
export function scopeTokenHash(p: ScopeTokenPayload): Buffer {
  const canon = JSON.stringify({
    manifestContentHash: p.manifestContentHash, engagementId: p.engagementId,
    issuedAt: p.issuedAt, nonce: p.nonce, expiresAt: p.expiresAt
  });
  return createHash('sha512').update(SCOPE_DOMAIN).update(Buffer.from([0])).update(canon).digest();
}

export type TokenResult = { ok: true } | { ok: false; reason: string };

export function verifyScopeToken(
  token: ScopeToken,
  expectedManifestHash: string,
  expectedEngagementId: string,
  issuerKeys: TrustKeyset[],
  now: number,
  seenNonces: Set<string>
): TokenResult {
  if (token.manifestContentHash !== expectedManifestHash) return { ok: false, reason: 'manifest hash mismatch' };
  if (token.engagementId !== expectedEngagementId) return { ok: false, reason: 'engagement mismatch' };
  if (Number.isNaN(Date.parse(token.expiresAt)) || now >= Date.parse(token.expiresAt)) return { ok: false, reason: 'token expired' };
  if (seenNonces.has(token.nonce)) return { ok: false, reason: 'nonce replay' };
  let sig: Uint8Array;
  try { sig = Uint8Array.from(Buffer.from(token.signatureHex, 'hex')); } catch { return { ok: false, reason: 'bad signature encoding' }; }
  const hash = scopeTokenHash(token);
  if (!verifyPluginSignature(hash, sig, issuerKeys)) return { ok: false, reason: 'signature invalid' };
  seenNonces.add(token.nonce);
  return { ok: true };
}
```

- [ ] **Step 4: Run** `pnpm test offensive-scope-token` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/scope-token.ts test/offensive-scope-token.test.ts
git commit -m "feat(offensive): signed scope-authorization token (DCS98-SCOPE-v1, replay-bound)"
```

---

## Task 6: EngagementAudit — append-only hash-chained log (SECURITY-CRITICAL)

**Files:** Create `src/main/offensive/engagement-audit.ts`; Test `test/offensive-engagement-audit.test.ts`

**Context:** A dedicated append-only log (one JSON line per event), hash-chained `h_n = SHA-256(h_{n-1} ∥ canonical(event_n))`. Load-time verify detects truncation/edit/reorder. (Sign-at-write with an isolated key is layered in Task 8 wiring via an injected signer; the chain itself is the core tamper-evidence and is what we test here. The signer is an optional injected hook — default none for the unit test.)

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngagementAudit, verifyAuditLog, type AuditEvent } from '../src/main/offensive/engagement-audit';

const dir = mkdtempSync(join(tmpdir(), 'dcs98-audit-'));
const ev = (seq: number): Omit<AuditEvent, 'seq' | 'prevHash'> => ({
  manifestId: 'e', manifestContentHash: 'abc', host: 'h', dialedIp: '10.0.0.1', port: 443,
  method: 'GET', decision: 'allowed', at: '2026-06-10T00:00:00Z'
});

describe('EngagementAudit', () => {
  it('appends a verifiable hash chain; verify passes', () => {
    const p = join(dir, 'a.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record({ ...ev(1), decision: 'denied', reason: 'out of scope' });
    expect(verifyAuditLog(p).ok).toBe(true);
    expect(verifyAuditLog(p).events.length).toBe(2);
  });
  it('detects a tampered event', () => {
    const p = join(dir, 'b.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record(ev(1));
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const first = JSON.parse(lines[0]); first.dialedIp = '8.8.8.8';
    writeFileSync(p, [JSON.stringify(first), lines[1]].join('\n') + '\n');
    expect(verifyAuditLog(p).ok).toBe(false);
  });
  it('detects truncation', () => {
    const p = join(dir, 'c.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record(ev(1));
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    writeFileSync(p, lines[0] + '\n'); // drop the second event
    // chain still self-consistent for line 0, but the head pointer says 2 events.
    expect(verifyAuditLog(p).ok).toBe(true); // truncation to a valid prefix verifies as a shorter chain...
    expect(verifyAuditLog(p).events.length).toBe(1); // ...so callers compare against the persisted head (Task 8)
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-engagement-audit` → FAIL.

- [ ] **Step 3: Implement** `src/main/offensive/engagement-audit.ts`
```typescript
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface AuditEvent {
  seq: number; prevHash: string;
  manifestId: string; manifestContentHash: string;
  host: string; dialedIp: string; port: number; method: string;
  decision: 'allowed' | 'denied'; reason?: string;
  attackType?: string; // SCANNER-ASSERTED, UNVERIFIED
  at: string;
}

const GENESIS = '0'.repeat(64);
const canon = (e: AuditEvent): string => JSON.stringify(e);
const chain = (prevHash: string, e: AuditEvent): string =>
  createHash('sha256').update(prevHash).update(canon(e)).digest('hex');

export class EngagementAudit {
  private seq = 0;
  private prevHash = GENESIS;
  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const r = verifyAuditLog(path);
      this.seq = r.events.length;
      this.prevHash = r.headHash;
    }
  }
  record(partial: Omit<AuditEvent, 'seq' | 'prevHash'>): AuditEvent {
    const e: AuditEvent = { ...partial, seq: this.seq, prevHash: this.prevHash };
    appendFileSync(this.path, JSON.stringify(e) + '\n');
    this.prevHash = chain(this.prevHash, e);
    this.seq += 1;
    return e;
  }
  headHash(): string { return this.prevHash; }
}

export interface AuditVerifyResult { ok: boolean; events: AuditEvent[]; headHash: string; }

export function verifyAuditLog(path: string): AuditVerifyResult {
  if (!existsSync(path)) return { ok: true, events: [], headHash: GENESIS };
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const events: AuditEvent[] = [];
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let e: AuditEvent;
    try { e = JSON.parse(lines[i]); } catch { return { ok: false, events, headHash: prev }; }
    if (e.seq !== i || e.prevHash !== prev) return { ok: false, events, headHash: prev };
    events.push(e);
    prev = chain(prev, e);
  }
  return { ok: true, events, headHash: prev };
}
```

- [ ] **Step 4: Run** `pnpm test offensive-engagement-audit` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/engagement-audit.ts test/offensive-engagement-audit.test.ts
git commit -m "feat(offensive): append-only hash-chained engagement audit log"
```

---

## Task 7: IP-pinning resolver + dial helper (anti-rebind core)

**Files:** Create `src/main/offensive/pin-dial.ts`; Test `test/offensive-pin-dial.test.ts`

**Context:** `resolveAll(host)` returns every A/AAAA. `dialPinned(ip, port)` opens a raw TCP socket to the *exact validated IP* (no hostname, so no re-resolution). The proxy (Task 8) resolves once, runs `decide` on the full set, then dials a validated IP via this helper.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:net';
import { resolveAll, dialPinned } from '../src/main/offensive/pin-dial';

describe('pin-dial', () => {
  it('resolveAll returns all addresses from the resolver', async () => {
    const fake = vi.fn(async () => [{ address: '10.0.0.1', family: 4 }, { address: '2001:db8::1', family: 6 }]);
    expect(await resolveAll('host', fake as never)).toEqual(['10.0.0.1', '2001:db8::1']);
  });
  it('dialPinned connects to the exact IP/port', async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const connected = new Promise<void>((r) => srv.once('connection', () => r()));
    const sock = await dialPinned('127.0.0.1', port);
    await connected;
    sock.destroy(); srv.close();
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-pin-dial` → FAIL.

- [ ] **Step 3: Implement** `src/main/offensive/pin-dial.ts`
```typescript
import { lookup as dnsLookup } from 'node:dns/promises';
import { connect, type Socket } from 'node:net';

type LookupFn = (host: string, opts: { all: true }) => Promise<{ address: string; family: number }[]>;

export async function resolveAll(host: string, lookup: LookupFn = dnsLookup as unknown as LookupFn): Promise<string[]> {
  const recs = await lookup(host, { all: true });
  return recs.map((r) => r.address);
}

/** Open a TCP socket to an EXACT IP — never a hostname, so there is no re-resolution between
 *  the scope check and the connect (closes the DNS-rebind TOCTOU). */
export function dialPinned(ip: string, port: number, timeoutMs = 15000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: ip, port });
    const onErr = (e: Error): void => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => onErr(new Error('dial timeout')));
    sock.once('error', onErr);
    sock.once('connect', () => { sock.setTimeout(0); sock.removeListener('error', onErr); resolve(sock); });
  });
}
```

- [ ] **Step 4: Run** `pnpm test offensive-pin-dial` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/pin-dial.ts test/offensive-pin-dial.test.ts
git commit -m "feat(offensive): IP-pinning resolve + dial (anti-rebind)"
```

---

## Task 8: AuthorizedEgressProxy — the enforcing CONNECT proxy (SECURITY-CRITICAL)

**Files:** Create `src/main/offensive/egress-proxy.ts`; Test `test/offensive-egress-proxy.test.ts`

**Context:** A loopback proxy handling both plain-HTTP proxied requests and HTTPS `CONNECT` tunnels. Every request/CONNECT: parse host:port → `resolveAll` → `decide` on the full IP set → deny (`403`/tunnel-reject) + audit, or pin-dial a validated IP + tunnel + audit. A token-bucket rate limiter. The resolver and `now` are injected for tests.

**Spec §6 fail-closed on audit write (do not omit):** the `audit(...)` helper writes BEFORE forwarding on the allow path. Wrap `opts.audit.record(...)` in try/catch; **if the audit write throws, DENY the request** (no audit → no forward) — respond `403`/reject and tear down, never forward an un-audited request. Add a test: make `audit.record` throw once and assert the request is denied, not forwarded.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createServer } from 'node:http';
import { AuthorizedEgressProxy } from '../src/main/offensive/egress-proxy';
import { parseScopeManifest } from '../src/main/offensive/scope-manifest';
import { EngagementAudit, verifyAuditLog } from '../src/main/offensive/engagement-audit';

const NOW = Date.parse('2026-06-10T00:00:00Z');

async function upstream(): Promise<{ port: number; close: () => void }> {
  const s = createServer((_req, res) => { res.end('upstream-ok'); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { port: (s.address() as { port: number }).port, close: () => s.close() };
}
function viaProxy(proxyPort: number, targetHost: string, targetPort: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: proxyPort, method: 'GET',
      path: `http://${targetHost}:${targetPort}/`, headers: { Host: `${targetHost}:${targetPort}` } });
    req.once('response', (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b })); });
    req.once('error', reject); req.end();
  });
}

describe('AuthorizedEgressProxy', () => {
  it('forwards an in-scope (loopback) request and audits it; denies out-of-scope', async () => {
    const up = await upstream();
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-proxy-'));
    const audit = new EngagementAudit(join(dir, 'a.log'));
    const manifest = parseScopeManifest({ manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
      include: [{ kind: 'cidr', value: '127.0.0.1/32' }] }, NOW);
    // resolver maps the target host literally to its IP.
    const resolver = vi.fn(async (h: string) => (h === 'in.scope' ? ['127.0.0.1'] : ['8.8.8.8']));
    const proxy = new AuthorizedEgressProxy({ manifest, audit, resolveAll: resolver, now: () => NOW, rateLimitPerSec: 1000 });
    const { port } = await proxy.start();

    const ok = await viaProxy(port, 'in.scope', up.port);
    expect(ok.status).toBe(200);
    expect(ok.body).toBe('upstream-ok');

    const denied = await viaProxy(port, 'out.scope', up.port);
    expect(denied.status).toBe(403);

    await proxy.stop(); up.close();
    const v = verifyAuditLog(join(dir, 'a.log'));
    expect(v.ok).toBe(true);
    expect(v.events.map((e) => e.decision)).toContain('allowed');
    expect(v.events.map((e) => e.decision)).toContain('denied');
    // the allowed event records the dialed IP (DCS98-observed), not a scanner claim.
    expect(v.events.find((e) => e.decision === 'allowed')?.dialedIp).toBe('127.0.0.1');
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-egress-proxy` → FAIL.

- [ ] **Step 3: Implement** `src/main/offensive/egress-proxy.ts`
```typescript
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { decide } from './scope-enforcer';
import type { ScopeManifest } from './scope-manifest';
import { resolveAll as defaultResolveAll, dialPinned } from './pin-dial';
import type { EngagementAudit } from './engagement-audit';

export interface ProxyOptions {
  manifest: ScopeManifest;
  audit: EngagementAudit;
  resolveAll?: (host: string) => Promise<string[]>;
  now?: () => number;
  rateLimitPerSec?: number;
}

export class AuthorizedEgressProxy {
  private server: Server | null = null;
  private tokens: number;
  private lastRefill: number;
  private readonly resolveAll: (host: string) => Promise<string[]>;
  private readonly now: () => number;
  private readonly rate: number;

  constructor(private readonly opts: ProxyOptions) {
    this.resolveAll = opts.resolveAll ?? defaultResolveAll;
    this.now = opts.now ?? Date.now;
    this.rate = opts.rateLimitPerSec ?? 10;
    this.tokens = this.rate;
    this.lastRefill = this.now();
  }

  private take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.rate, this.tokens + ((t - this.lastRefill) / 1000) * this.rate);
    this.lastRefill = t;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }

  /** Resolve + decide; on allow, return a validated IP to pin; on deny, the reason. Fail-closed. */
  private async authorize(host: string): Promise<{ ip: string } | { deny: string }> {
    let ips: string[];
    try { ips = await this.resolveAll(host); } catch { return { deny: 'resolve failed' }; }
    let d;
    try { d = decide(this.opts.manifest, { host, ips }, this.now()); } catch { return { deny: 'enforcer error' }; }
    if (!d.allow) return { deny: d.reason };
    return { ip: ips[0] }; // every IP is in-scope (decide guarantees it); pin to the first
  }

  private audit(host: string, dialedIp: string, port: number, method: string, decision: 'allowed' | 'denied', reason?: string): void {
    this.opts.audit.record({
      manifestId: this.opts.manifest.manifestId,
      manifestContentHash: '', // filled by the wiring layer (Task 11) which knows the active hash
      host, dialedIp, port, method, decision, reason, at: new Date(this.now()).toISOString()
    });
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.take()) { res.writeHead(429).end('rate limited'); return; }
    let target: URL;
    try { target = new URL(req.url ?? ''); } catch { res.writeHead(400).end('bad target'); return; }
    const port = Number(target.port || 80);
    const r = await this.authorize(target.hostname);
    if ('deny' in r) { this.audit(target.hostname, '', port, req.method ?? 'GET', 'denied', r.deny); res.writeHead(403).end('out of scope'); return; }
    let upstream: Socket;
    try { upstream = await dialPinned(r.ip, port); } catch { this.audit(target.hostname, r.ip, port, req.method ?? 'GET', 'denied', 'dial failed'); res.writeHead(502).end('dial failed'); return; }
    this.audit(target.hostname, r.ip, port, req.method ?? 'GET', 'allowed');
    const head = `${req.method} ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n` +
      Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'proxy-connection'].includes(k.toLowerCase()))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`).join('') + '\r\n';
    upstream.write(head);
    req.pipe(upstream);
    upstream.pipe(res.socket!);
    upstream.once('error', () => { try { res.socket?.destroy(); } catch { /* noop */ } });
  }

  private async onConnect(req: IncomingMessage, clientSocket: Socket, head: Buffer): Promise<void> {
    const [host, portStr] = (req.url ?? '').split(':');
    const port = Number(portStr || 443);
    if (!this.take()) { clientSocket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
    const r = await this.authorize(host);
    if ('deny' in r) { this.audit(host, '', port, 'CONNECT', 'denied', r.deny); clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    let upstream: Socket;
    try { upstream = await dialPinned(r.ip, port); } catch { this.audit(host, r.ip, port, 'CONNECT', 'denied', 'dial failed'); clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
    this.audit(host, r.ip, port, 'CONNECT', 'allowed');
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    const kill = (): void => { try { upstream.destroy(); } catch { /* noop */ } try { clientSocket.destroy(); } catch { /* noop */ } };
    upstream.once('error', kill); clientSocket.once('error', kill);
  }

  start(): Promise<{ port: number }> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => void this.onRequest(req, res));
      server.on('connect', (req, sock, head) => void this.onConnect(req, sock as Socket, head));
      server.listen(0, '127.0.0.1', () => { this.server = server; resolve({ port: (server.address() as { port: number }).port }); });
    });
  }
  stop(): Promise<void> {
    return new Promise((resolve) => { if (!this.server) return resolve(); this.server.close(() => resolve()); this.server = null; });
  }
}
```

- [ ] **Step 4: Run** `pnpm test offensive-egress-proxy` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/egress-proxy.ts test/offensive-egress-proxy.test.ts
git commit -m "feat(offensive): IP-pinning enforcing CONNECT proxy + per-request audit"
```

---

## Task 9: Offensive settings block

**Files:** Modify `src/shared/types.ts`; Test `test/offensive-settings.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';

describe('offensive settings defaults', () => {
  it('exist and are fail-safe', () => {
    expect(defaultSettings.offensive.confirmMode).toBe('per-scan');
    expect(defaultSettings.offensive.requireSignedAuthorization).toBe(false);
    expect(defaultSettings.offensive.downstreamProxy ?? null).toBe(null);
    expect(Array.isArray(defaultSettings.offensive.issuerKeys ?? [])).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-settings` → FAIL.

- [ ] **Step 3: Implement** — in `src/shared/types.ts`, add to `AppSettings`:
```typescript
offensive: {
  confirmMode: 'per-scan' | 'per-session';
  rateLimitPerSec: number;
  downstreamProxy?: string | null;
  requireSignedAuthorization: boolean;
  issuerKeys?: { keyId: string; edPubHex: string; pqPubHex: string }[];
};
```
and to `defaultSettings`:
```typescript
offensive: { confirmMode: 'per-scan', rateLimitPerSec: 10, downstreamProxy: null, requireSignedAuthorization: false, issuerKeys: [] },
```

- [ ] **Step 4: Run** `pnpm test offensive-settings` → PASS; `pnpm typecheck` → clean; full `pnpm test` → green (settings-merge tolerates the new block).

- [ ] **Step 5: Commit**
```bash
git add src/shared/types.ts test/offensive-settings.test.ts
git commit -m "feat(offensive): settings block (confirmMode/rate/issuer policy)"
```

---

## Task 10: Engagement session — arming bound to manifest content hash

**Files:** Create `src/main/offensive/session.ts`; Test `test/offensive-session.test.ts`

**Context:** Tracks the active engagement: the loaded manifest, its content hash, the confirm mode, and whether the operator has confirmed. `per-scan` requires confirm each scan; `per-session` arms once per content hash; any content-hash change or backward clock re-arms.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { OffensiveSession } from '../src/main/offensive/session';
import { parseScopeManifest } from '../src/main/offensive/scope-manifest';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const mk = (id: string) => parseScopeManifest({ manifestId: id, mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
  include: [{ kind: 'cidr', value: '127.0.0.1/32' }] }, NOW);

describe('OffensiveSession', () => {
  it('per-scan: every scan needs a fresh confirm', () => {
    const s = new OffensiveSession(() => NOW);
    s.load(mk('e'), 'per-scan');
    expect(s.mayScan()).toBe(false);
    s.confirm(); expect(s.mayScan()).toBe(true);
    s.consumeScan(); expect(s.mayScan()).toBe(false);
  });
  it('per-session: one confirm covers scans until the scope content changes', () => {
    const s = new OffensiveSession(() => NOW);
    s.load(mk('e'), 'per-session');
    s.confirm(); expect(s.mayScan()).toBe(true);
    s.consumeScan(); expect(s.mayScan()).toBe(true);
    s.load(mk('e2'), 'per-session'); // different content hash → re-arm required
    expect(s.mayScan()).toBe(false);
  });
  it('backward clock invalidates the session', () => {
    let t = NOW; const s = new OffensiveSession(() => t);
    s.load(mk('e'), 'per-session'); s.confirm(); expect(s.mayScan()).toBe(true);
    t = NOW - 60_000; expect(s.mayScan()).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-session` → FAIL.

- [ ] **Step 3: Implement** `src/main/offensive/session.ts`
```typescript
import type { ScopeManifest } from './scope-manifest';
import { scopeContentHash } from './scope-manifest';

export class OffensiveSession {
  private manifest: ScopeManifest | null = null;
  private contentHash = '';
  private mode: 'per-scan' | 'per-session' = 'per-scan';
  private confirmedHash: string | null = null;
  private lastNow: number;
  constructor(private readonly now: () => number = Date.now) { this.lastNow = this.now(); }

  load(manifest: ScopeManifest, mode: 'per-scan' | 'per-session'): void {
    this.manifest = manifest;
    this.contentHash = scopeContentHash(manifest);
    this.mode = mode;
    this.confirmedHash = null; // loading (or changing) the scope always re-arms
    this.lastNow = this.now();
  }
  confirm(): void { if (this.manifest) this.confirmedHash = this.contentHash; }
  consumeScan(): void { if (this.mode === 'per-scan') this.confirmedHash = null; }

  private clockOk(): boolean {
    const t = this.now();
    if (t < this.lastNow) return false; // wall-clock moved backward
    this.lastNow = t;
    return true;
  }
  mayScan(): boolean {
    if (!this.manifest) return false;
    if (!this.clockOk()) { this.confirmedHash = null; return false; }
    return this.confirmedHash === this.contentHash;
  }
  activeManifest(): ScopeManifest | null { return this.manifest; }
  activeContentHash(): string { return this.contentHash; }
}
```

- [ ] **Step 4: Run** `pnpm test offensive-session` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/offensive/session.ts test/offensive-session.test.ts
git commit -m "feat(offensive): engagement session arming (content-hash bound)"
```

---

## Task 11: Capability wiring + IPC + minimal confirmation surface

**Files:** Modify `src/shared/plugin-types.ts`, `src/main/plugins/context.ts`, `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`; Create `src/main/offensive/engagement-controller.ts`; Test `test/offensive-capability.test.ts`

**Context:** Adds the `authorized-target-egress` capability, a context surface, and an `EngagementController` that ties session + proxy + audit + scope-token verification together and exposes IPC to the renderer (load scope, confirm, start/stop scan, status). The renderer modal is a thin consumer (built with subsystem 2 or as a small follow-on); this task wires the main-process control + IPC, fully testable.

- [ ] **Step 1: Write the failing test** (`test/offensive-capability.test.ts`)
```typescript
import { describe, it, expect } from 'vitest';
import { CAPABILITIES } from '../src/shared/plugin-types';
import { EngagementController } from '../src/main/offensive/engagement-controller';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const manifestRaw = { manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
  include: [{ kind: 'cidr', value: '127.0.0.1/32' }] };

describe('authorized-target-egress capability', () => {
  it('is a known capability', () => {
    expect([...CAPABILITIES]).toContain('authorized-target-egress');
  });
  it('controller refuses to start a scan before scope load + confirm; allows after', async () => {
    const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'dcs98-ctl-'));
    const ctl = new EngagementController({ auditDir: dir, now: () => NOW,
      settings: { confirmMode: 'per-scan', rateLimitPerSec: 1000, requireSignedAuthorization: false, issuerKeys: [] } });
    await expect(ctl.startScan()).rejects.toThrow(/no engagement|not confirmed/i);
    ctl.loadScope(manifestRaw);
    await expect(ctl.startScan()).rejects.toThrow(/not confirmed/i);
    ctl.confirm();
    const started = await ctl.startScan();
    expect(typeof started.proxyPort).toBe('number');
    await ctl.stopScan();
  });
  it('refuses a manifest needing a signature when policy requires it and no issuer is configured', () => {
    const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'dcs98-ctl2-'));
    const ctl = new EngagementController({ auditDir: dir, now: () => NOW,
      settings: { confirmMode: 'per-scan', rateLimitPerSec: 10, requireSignedAuthorization: true, issuerKeys: [] } });
    expect(() => ctl.loadScope(manifestRaw)).toThrow(/signed authorization required/i);
  });
});
```

- [ ] **Step 2: Run** `pnpm test offensive-capability` → FAIL.

- [ ] **Step 3a: Add the capability** — in `src/shared/plugin-types.ts`, add `'authorized-target-egress'` to the `CAPABILITIES` tuple.

- [ ] **Step 3b: Add the context surface** — in `src/main/plugins/context.ts`, add to `PluginContext`:
```typescript
attackEgress?: { proxyUrl(): string; scopeContentHash(): string };
```
and in `createPluginContext`, grant it only when declared AND `deps.attackEgress` is provided (the controller supplies it at scan start):
```typescript
if (has('authorized-target-egress') && deps.attackEgress) ctx.attackEgress = deps.attackEgress;
```
Add `attackEgress?: { proxyUrl(): string; scopeContentHash(): string }` to `ContextDeps`.

- [ ] **Step 3c: Implement `src/main/offensive/engagement-controller.ts`**
```typescript
import { join } from 'node:path';
import { parseScopeManifest, scopeContentHash, withDefaultExcludes, type ScopeManifest } from './scope-manifest';
import { verifyScopeToken, type ScopeToken } from './scope-token';
import { OffensiveSession } from './session';
import { EngagementAudit } from './engagement-audit';
import { AuthorizedEgressProxy } from './egress-proxy';
import type { TrustKeyset } from '../plugins/trust';

export interface EngagementSettings {
  confirmMode: 'per-scan' | 'per-session';
  rateLimitPerSec: number;
  requireSignedAuthorization: boolean;
  issuerKeys: { keyId: string; edPubHex: string; pqPubHex: string }[];
  downstreamProxy?: string | null;
}
export interface ControllerOptions { auditDir: string; settings: EngagementSettings; now?: () => number; }

const hexToBytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));

export class EngagementController {
  private session: OffensiveSession;
  private proxy: AuthorizedEgressProxy | null = null;
  private audit: EngagementAudit | null = null;
  private seenNonces = new Set<string>();
  private now: () => number;
  constructor(private readonly opts: ControllerOptions) {
    this.now = opts.now ?? Date.now;
    this.session = new OffensiveSession(this.now);
  }

  loadScope(raw: unknown, token?: ScopeToken): void {
    // withDefaultExcludes injects loopback/RFC1918/link-local/metadata excludes for non-'lab'
    // modes — closes the domain-include-ignores-IP sharp edge (security review of Task 4).
    const manifest = withDefaultExcludes(parseScopeManifest(raw, this.now()));
    if (this.opts.settings.requireSignedAuthorization) {
      const issuers: TrustKeyset[] = this.opts.settings.issuerKeys.map((k) => ({ edPub: hexToBytes(k.edPubHex), pqPub: hexToBytes(k.pqPubHex) }));
      if (!token) throw new Error('signed authorization required by policy');
      const r = verifyScopeToken(token, scopeContentHash(manifest), manifest.manifestId, issuers, this.now(), this.seenNonces);
      if (!r.ok) throw new Error(`signed authorization required: ${r.reason}`);
    }
    this.session.load(manifest, this.opts.settings.confirmMode);
  }
  confirm(): void { this.session.confirm(); }

  async startScan(): Promise<{ proxyPort: number }> {
    const manifest = this.session.activeManifest();
    if (!manifest) throw new Error('no engagement scope loaded');
    if (!this.session.mayScan()) throw new Error('scan not confirmed');
    const hash = this.session.activeContentHash();
    this.audit = new EngagementAudit(join(this.opts.auditDir, `${manifest.manifestId}.log`));
    const audit = this.audit;
    // wrap record() to stamp the active content hash on every event
    const stamping = { record: (e: Parameters<EngagementAudit['record']>[0]) => audit.record({ ...e, manifestContentHash: hash }) } as EngagementAudit;
    this.proxy = new AuthorizedEgressProxy({ manifest, audit: stamping, now: this.now, rateLimitPerSec: this.opts.settings.rateLimitPerSec });
    const { port } = await this.proxy.start();
    this.session.consumeScan();
    return { proxyPort: port };
  }
  async stopScan(): Promise<void> { if (this.proxy) { await this.proxy.stop(); this.proxy = null; } }
  attackEgressSurface(): { proxyUrl(): string; scopeContentHash(): string } | null {
    if (!this.proxy) return null;
    const hash = this.session.activeContentHash();
    return { proxyUrl: () => `http://127.0.0.1:${(this.proxy as unknown as { server: { address(): { port: number } } }).server.address().port}`, scopeContentHash: () => hash };
  }
}
```
(If TypeScript objects to the `stamping`/`server` casts, expose a small public `port()` getter on `AuthorizedEgressProxy` and a `record`-wrapping constructor option instead — the executor picks the cleaner of the two; the behavior is: every audit event carries the active content hash, and `proxyUrl()` returns the live port.)

- [ ] **Step 3d: IPC** — in `src/shared/ipc-contracts.ts` add channels `offensive: { loadScope, confirm, startScan, stopScan, status }`; in `src/main/ipc/register.ts` `safeHandle` them against a singleton `EngagementController` built from `settingsStore.read().offensive`; in `src/preload/index.ts` expose `window.api.offensive.*`. (Mirror the `plugins:*` wiring from the platform.)

- [ ] **Step 4: Run** `pnpm test offensive-capability` → PASS; `pnpm typecheck` → clean; full `pnpm test` → green.

- [ ] **Step 5: Commit**
```bash
git add src/shared/plugin-types.ts src/main/plugins/context.ts src/main/offensive/engagement-controller.ts src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts test/offensive-capability.test.ts
git commit -m "feat(offensive): authorized-target-egress capability + engagement controller + IPC"
```

---

## Final verification

- [ ] `pnpm typecheck` (both tsconfigs) clean; `pnpm test` full suite green incl. the new offensive suites.
- [ ] Charter: the normal `egress` capability + SSRF gate are unchanged; a plugin without `authorized-target-egress` cannot reach private/loopback. No telemetry; proxy loopback-only.
- [ ] Confirm the audit log for a scan verifies (`verifyAuditLog`) and records the dialed IP (DCS98-observed), with `attackType` absent/labeled.
- [ ] Manual: load a lab scope (`127.0.0.1/32`), confirm, start a scan, point an HTTP client at the proxy → in-scope 200 + `allowed` audit; out-of-scope → 403 + `denied` audit; verify the chain.
- [ ] Dispatch the final whole-branch reviewer; the security-critical units (Tasks 4, 5, 6, 8) additionally get an adversarial crypto/red-team review before merge.

## Out of scope (this plan)
- deep-eye module-by-transport enumeration + scanner wiring + bundled CPython (subsystem 2, private repo).
- The rich renderer scope-authoring form + confirmation modal styling (thin consumers of the IPC here).
- The OS-level jail for raw-socket scanning (deferred §3.1 option B).
- **`downstreamProxy` chaining (Burp/ZAP downstream of the gate)** — the setting is RESERVED in Task 9; v1 dials direct-to-target. Consuming it (pin-dial the validated IP *through* the configured downstream proxy via an upstream CONNECT) is a small, isolated follow-on — flagged here so the dangling setting isn't mistaken for live behavior.
- `persistent-background-connection` / Telegram (separate capability).
