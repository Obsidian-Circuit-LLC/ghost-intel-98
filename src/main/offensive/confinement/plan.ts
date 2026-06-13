import { isIP } from 'node:net';
import { CIDR_RE } from '../scope-manifest';
import type { ScopeManifest } from '../scope-manifest';

/**
 * Whether a CIDR string is SEMANTICALLY well-formed (not merely CIDR_RE-shaped).
 *
 * CIDR_RE (the manifest parser's screen) is deliberately permissive: `999.999.999.999/99`
 * and `203.0.113.0/300` both pass it. That is acceptable upstream because the proxy's
 * runtime `cidrContains` rejects garbage at decision time. But this allow-set is punched
 * into an OS firewall (nftables / WFP), where a malformed range must fail LOUD at the
 * boundary, not error deep inside rule construction. So we additionally require the base to
 * be a real IP literal and the prefix to be within the family's bit-width.
 */
function isWellFormedCidr(cidr: string): boolean {
  if (!CIDR_RE.test(cidr)) return false;
  const slash = cidr.lastIndexOf('/');
  const base = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  const fam = isIP(base); // 4, 6, or 0 (invalid)
  if (fam === 0) return false;
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= (fam === 4 ? 32 : 128);
}

/**
 * An OS-jail allow-set derived from an authorized engagement's ScopeManifest.
 *
 * The jail is an L3/L4 confinement: it can permit egress to literal IP ranges
 * (CIDRs) and to the loopback proxy, and nothing else. It cannot reason about
 * domain names — name resolution happens above the jail.
 */
export interface ConfinementPlan {
  /** The jail always allows 127.0.0.1:proxyPort. */
  proxyPort: number;
  /** Manifest `kind:'cidr'` includes, CIDR_RE-validated, in manifest order. */
  allowCidrs: string[];
  /**
   * Manifest `kind:'domain'` includes. These are NOT punched into the OS jail.
   *
   * An OS CIDR-jail pins IP ranges, not names: a domain has no stable address to
   * allow, and resolving it here would (a) leak DNS outside the proxy and (b) bind
   * to a snapshot of addresses that can rotate underneath us. Domain-scoped HTTP
   * traffic is instead expected to route through the loopback proxy, which performs
   * DoH resolution and applies its own scope check. We surface the dropped domains
   * here so the UI can warn the operator that these includes are proxy-only and
   * unreachable for any non-proxied (raw socket) tooling.
   */
  domainOnlyIncludes: string[];
}

/**
 * Pure, deterministic, order-preserving derivation of a ConfinementPlan from a
 * ScopeManifest. No I/O, no clock, no global state.
 */
export function buildConfinementPlan(manifest: ScopeManifest, proxyPort: number): ConfinementPlan {
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    throw new Error(`confinement requires a valid loopback proxy port, got ${proxyPort}`);
  }

  const allowCidrs: string[] = [];
  const domainOnlyIncludes: string[] = [];

  for (const rule of manifest.include) {
    if (rule.kind === 'cidr') {
      // Semantic well-formedness, not just CIDR_RE shape — this range becomes an OS
      // firewall rule, so a bad base IP / out-of-range prefix must be rejected here, not
      // deep in nft/WFP construction. (cidrContains is NOT a validator: it returns false,
      // never throws, on malformed input.)
      if (!isWellFormedCidr(rule.value)) {
        throw new Error(`invalid CIDR in scope include: ${rule.value}`);
      }
      allowCidrs.push(rule.value);
    } else {
      domainOnlyIncludes.push(rule.value);
    }
  }

  return { proxyPort, allowCidrs, domainOnlyIncludes };
}
