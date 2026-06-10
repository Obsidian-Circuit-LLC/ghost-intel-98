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
