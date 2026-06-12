import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { EngagementController } from '../src/main/offensive/engagement-controller';
import {
  parseScopeManifest,
  withDefaultExcludes,
  scopeContentHash
} from '../src/main/offensive/scope-manifest';
import { scopeTokenHash, type ScopeToken } from '../src/main/offensive/scope-token';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const now = () => NOW;

// Issuer keys (hybrid ed25519 ∥ ML-DSA-65), reused across tests.
const edSec = ed25519.utils.randomSecretKey();
const pq = ml_dsa65.keygen();
const edPubHex = Buffer.from(ed25519.getPublicKey(edSec)).toString('hex');
const pqPubHex = Buffer.from(pq.publicKey).toString('hex');
const issuerKeys = [{ keyId: 'k1', edPubHex, pqPubHex }];

const dirs: string[] = [];
function mkAuditDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'dcs98-engctl-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function manifest(include: Array<{ kind: 'cidr' | 'domain'; value: string }>): unknown {
  return {
    manifestId: 'eng-1',
    mode: 'engagement',
    expiresAt: '2026-12-31T00:00:00Z',
    include
  };
}

// Build a valid signed scope token for `rawManifest` so requireSignedAuthorization passes.
function signToken(rawManifest: unknown, nonce: string): ScopeToken {
  const m = withDefaultExcludes(parseScopeManifest(rawManifest, NOW));
  const payload = {
    manifestContentHash: scopeContentHash(m),
    engagementId: m.manifestId,
    issuedAt: '2026-06-10T00:00:00Z',
    nonce,
    expiresAt: '2026-06-11T00:00:00Z'
  };
  const h = scopeTokenHash(payload);
  const sig = new Uint8Array([...ed25519.sign(h, edSec), ...ml_dsa65.sign(h, pq.secretKey)]);
  return { ...payload, signatureHex: Buffer.from(sig).toString('hex') };
}

describe('EngagementController — M4 nonce store fail-closed + fsync', () => {
  it('throws (fail-closed) on a corrupt nonce store when signed authorization is required', () => {
    const auditDir = mkAuditDir();
    writeFileSync(join(auditDir, 'seen-nonces.json'), '{ this is not valid json', 'utf8');

    const ctl = new EngagementController({
      auditDir,
      now,
      settings: {
        confirmMode: 'per-session',
        rateLimitPerSec: 10,
        requireSignedAuthorization: true,
        issuerKeys
      }
    });

    const raw = manifest([{ kind: 'cidr', value: '93.184.216.0/24' }]);
    // Throws BEFORE token verification — corrupt store means we cannot trust replay
    // protection, so a signed load is refused outright.
    expect(() => ctl.loadScope(raw, signToken(raw, 'n-corrupt'))).toThrow(/replay-protection store is corrupt/);
  });

  it('a corrupt nonce store does NOT throw when signed authorization is not required', () => {
    const auditDir = mkAuditDir();
    writeFileSync(join(auditDir, 'seen-nonces.json'), 'not json at all', 'utf8');

    const ctl = new EngagementController({
      auditDir,
      now,
      settings: {
        confirmMode: 'per-session',
        rateLimitPerSec: 10,
        requireSignedAuthorization: false,
        issuerKeys: []
      }
    });

    const raw = manifest([{ kind: 'cidr', value: '93.184.216.0/24' }]);
    expect(() => ctl.loadScope(raw)).not.toThrow();
  });

  it('loads with a valid nonce store and persists the consumed nonce (fsynced array file)', () => {
    const auditDir = mkAuditDir();
    writeFileSync(join(auditDir, 'seen-nonces.json'), JSON.stringify(['old-nonce']), 'utf8');

    const ctl = new EngagementController({
      auditDir,
      now,
      settings: {
        confirmMode: 'per-session',
        rateLimitPerSec: 10,
        requireSignedAuthorization: true,
        issuerKeys
      }
    });

    const raw = manifest([{ kind: 'cidr', value: '93.184.216.0/24' }]);
    expect(() => ctl.loadScope(raw, signToken(raw, 'fresh-nonce'))).not.toThrow();

    const file = join(auditDir, 'seen-nonces.json');
    expect(existsSync(file)).toBe(true);
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as string[];
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted).toContain('fresh-nonce');
    expect(persisted).toContain('old-nonce');
  });
});

describe('EngagementController — C3 downstream-proxy + private-target guard', () => {
  it('refuses loadScope when downstreamProxy is set and the scope includes a private CIDR', () => {
    const auditDir = mkAuditDir();
    const ctl = new EngagementController({
      auditDir,
      now,
      settings: {
        confirmMode: 'per-session',
        rateLimitPerSec: 10,
        requireSignedAuthorization: false,
        issuerKeys: [],
        downstreamProxy: 'socks5://127.0.0.1:9050'
      }
    });

    const raw = manifest([{ kind: 'cidr', value: '192.168.0.0/16' }]);
    expect(() => ctl.loadScope(raw)).toThrow(/downstream proxy is configured but the scope includes private/);
  });

  it('does NOT refuse on the C3 ground when downstreamProxy is set but all includes are public', () => {
    const auditDir = mkAuditDir();
    const ctl = new EngagementController({
      auditDir,
      now,
      settings: {
        confirmMode: 'per-session',
        rateLimitPerSec: 10,
        requireSignedAuthorization: false,
        issuerKeys: [],
        downstreamProxy: 'socks5://127.0.0.1:9050'
      }
    });

    const raw = manifest([{ kind: 'cidr', value: '93.184.216.0/24' }]);
    expect(() => ctl.loadScope(raw)).not.toThrow();
  });

  it('allows a private-CIDR scope when no downstreamProxy is configured', () => {
    const auditDir = mkAuditDir();
    const ctl = new EngagementController({
      auditDir,
      now,
      settings: {
        confirmMode: 'per-session',
        rateLimitPerSec: 10,
        requireSignedAuthorization: false,
        issuerKeys: []
      }
    });

    const raw = manifest([{ kind: 'cidr', value: '10.1.2.0/24' }]);
    expect(() => ctl.loadScope(raw)).not.toThrow();
  });

  it('detects an IPv6 loopback include as non-public under a downstream proxy', () => {
    const auditDir = mkAuditDir();
    const ctl = new EngagementController({
      auditDir,
      now,
      settings: {
        confirmMode: 'per-session',
        rateLimitPerSec: 10,
        requireSignedAuthorization: false,
        issuerKeys: [],
        downstreamProxy: 'socks5://127.0.0.1:9050'
      }
    });

    const raw = manifest([{ kind: 'cidr', value: '::1/128' }]);
    expect(() => ctl.loadScope(raw)).toThrow(/private/);
  });
});
