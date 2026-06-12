import { readFileSync, existsSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { parseScopeManifest, scopeContentHash, withDefaultExcludes } from './scope-manifest';
import type { ScopeManifest } from './scope-manifest';
import { verifyScopeToken } from './scope-token';
import type { ScopeToken } from './scope-token';
import { cidrContains } from './net-match';
import { OffensiveSession } from './session';
import { EngagementAudit } from './engagement-audit';
import { AuthorizedEgressProxy } from './egress-proxy';
import type { TrustKeyset } from '../plugins/trust';

/** Non-public ranges: RFC1918 + loopback + link-local + CGNAT + "this network" + the IPv6
 *  loopback/link-local/unique-local blocks. A scope include that falls inside any of these
 *  must never be routed through a downstream (e.g. Tor) proxy — see C3 guard below. */
const NON_PUBLIC_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '0.0.0.0/8',
  '::1/128',
  'fe80::/10',
  'fc00::/7'
];

/** True iff `cidr` (an "addr/prefix" string) names a network whose base address falls inside any
 *  NON_PUBLIC_CIDRS block. Checks membership of the CIDR's network address (the part before '/'). */
function cidrIsNonPublic(cidr: string): boolean {
  const slash = cidr.lastIndexOf('/');
  const network = slash < 0 ? cidr : cidr.slice(0, slash);
  return NON_PUBLIC_CIDRS.some((block) => cidrContains(block, network));
}

/** True iff the manifest's `include` rules contain any non-public CIDR target. */
function manifestHasNonPublicTarget(m: ScopeManifest): boolean {
  return m.include.some((r) => r.kind === 'cidr' && cidrIsNonPublic(r.value));
}

const hexToBytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));

interface IssuerKeyConfig {
  keyId: string;
  edPubHex: string;
  pqPubHex: string;
}

interface EngagementSettings {
  confirmMode: 'per-scan' | 'per-session';
  rateLimitPerSec: number;
  requireSignedAuthorization: boolean;
  issuerKeys: IssuerKeyConfig[];
  downstreamProxy?: string | null;
}

export interface EngagementControllerOpts {
  auditDir: string;
  settings: EngagementSettings;
  now?: () => number;
  onAnchorPublicKey?: (pubHex: string, manifestId: string) => void;
}

export class EngagementController {
  private readonly session: OffensiveSession;
  private readonly now: () => number;
  private readonly opts: EngagementControllerOpts;
  private seenNonces: Set<string>;
  private nonceStoreCorrupt = false;
  private readonly nonceFilePath: string;
  private proxy: AuthorizedEgressProxy | null = null;
  private proxyPort: number | null = null;

  constructor(opts: EngagementControllerOpts) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.session = new OffensiveSession(this.now);

    // Ensure auditDir exists
    if (!existsSync(opts.auditDir)) {
      mkdirSync(opts.auditDir, { recursive: true });
    }

    // Durable seenNonces: load from JSON file, empty set if absent
    this.nonceFilePath = join(opts.auditDir, 'seen-nonces.json');
    this.seenNonces = new Set<string>();
    if (existsSync(this.nonceFilePath)) {
      try {
        const raw = readFileSync(this.nonceFilePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          for (const n of parsed) {
            if (typeof n === 'string') this.seenNonces.add(n);
          }
        }
      } catch {
        // Corrupt nonce file. An empty set here would be FAIL-OPEN for replay protection:
        // every previously-consumed scope-token nonce would become replayable. We do not
        // crash on startup (an operator must still be able to launch the app), but we record
        // the corruption so loadScope can fail-closed for signed authorization (see M4).
        this.nonceStoreCorrupt = true;
      }
    }
  }

  private persistNonces(): void {
    // Durable write + fsync: the replay set must survive a crash/power-loss right after a
    // token is consumed, otherwise that nonce becomes replayable on restart. writeFileSync
    // alone does not flush the file's data to disk.
    const fd = openSync(this.nonceFilePath, 'w');
    try {
      writeSync(fd, JSON.stringify([...this.seenNonces]), null, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  loadScope(raw: unknown, token?: ScopeToken): void {
    const { settings } = this.opts;
    const manifest = withDefaultExcludes(parseScopeManifest(raw, this.now()));

    // C3 guard: a downstream/Tor proxy must never carry traffic to a private/internal target.
    // Enforced on the unsigned path too — this is a routing invariant independent of attestation.
    if (
      typeof settings.downstreamProxy === 'string' &&
      settings.downstreamProxy.length > 0 &&
      manifestHasNonPublicTarget(manifest)
    ) {
      throw new Error('refusing: a downstream proxy is configured but the scope includes private/internal targets — private CIDRs must not be routed through a downstream/Tor proxy');
    }

    if (settings.requireSignedAuthorization) {
      // M4 fail-closed: if the durable replay store was corrupt at construction, we cannot
      // trust replay detection. Refuse signed authorization rather than admit a replayed token.
      if (this.nonceStoreCorrupt) {
        throw new Error('replay-protection store is corrupt; re-attest the engagement (refusing signed authorization to avoid token replay)');
      }
      if (!token) {
        throw new Error('signed authorization required: no token provided');
      }
      // Build issuers from settings — NEVER from PINNED_KEYSETS
      const issuers: TrustKeyset[] = (settings.issuerKeys ?? []).map((k) => ({
        edPub: hexToBytes(k.edPubHex),
        pqPub: hexToBytes(k.pqPubHex)
      }));
      if (issuers.length === 0) {
        throw new Error('signed authorization required: no issuer keys configured');
      }
      const result = verifyScopeToken(
        token,
        scopeContentHash(manifest),
        manifest.manifestId,
        issuers,
        this.now(),
        this.seenNonces
      );
      if (!result.ok) {
        throw new Error(`signed authorization required: ${result.reason}`);
      }
      // Persist durable nonce set after successful verification
      this.persistNonces();
    }

    this.session.load(manifest, settings.confirmMode);
  }

  confirm(): void {
    this.session.confirm();
  }

  async startScan(): Promise<{ proxyPort: number }> {
    const manifest = this.session.activeManifest();
    if (!manifest) {
      throw new Error('no engagement scope loaded');
    }
    if (!this.session.mayScan()) {
      throw new Error('scan not confirmed');
    }

    // C3 guard (defensive, also enforced in loadScope): never start the enforcing proxy if a
    // downstream proxy is configured against a scope that includes a private/internal target.
    const ds = this.opts.settings.downstreamProxy;
    if (typeof ds === 'string' && ds.length > 0 && manifestHasNonPublicTarget(manifest)) {
      throw new Error('refusing: a downstream proxy is configured but the scope includes private/internal targets — private CIDRs must not be routed through a downstream/Tor proxy');
    }

    const manifestId = manifest.manifestId;

    // Generate EPHEMERAL ed25519 keypair — private key never leaves this object
    const sec = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(sec);
    const pubHex = Buffer.from(pub).toString('hex');

    // Build signer using the ephemeral private key
    const signer = (head: string): string =>
      Buffer.from(ed25519.sign(Buffer.from(head, 'hex'), sec)).toString('hex');

    // Anchor the public key (out-of-band verification anchor)
    this.opts.onAnchorPublicKey?.(pubHex, manifestId);

    const auditPath = join(this.opts.auditDir, `${manifestId}.log`);
    const audit = new EngagementAudit(auditPath, signer);

    this.proxy = new AuthorizedEgressProxy({
      manifest: this.session.activeManifest()!,
      audit,
      now: this.now,
      rateLimitPerSec: this.opts.settings.rateLimitPerSec
    });

    const { port } = await this.proxy.start();
    this.proxyPort = port;
    this.session.consumeScan();

    return { proxyPort: port };
  }

  async stopScan(): Promise<void> {
    if (this.proxy) {
      await this.proxy.stop();
      this.proxy = null;
    }
    this.proxyPort = null;
  }

  attackEgressSurface(): { proxyUrl(): string; scopeContentHash(): string } | null {
    if (!this.proxy || this.proxyPort === null) return null;
    const port = this.proxyPort;
    const session = this.session;
    return {
      proxyUrl: () => `http://127.0.0.1:${port}`,
      scopeContentHash: () => session.activeContentHash()
    };
  }
}
