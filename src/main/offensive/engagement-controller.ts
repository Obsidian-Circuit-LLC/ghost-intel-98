import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { parseScopeManifest, scopeContentHash, withDefaultExcludes } from './scope-manifest';
import { verifyScopeToken } from './scope-token';
import type { ScopeToken } from './scope-token';
import { OffensiveSession } from './session';
import { EngagementAudit } from './engagement-audit';
import { AuthorizedEgressProxy } from './egress-proxy';
import type { TrustKeyset } from '../plugins/trust';

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
        // Corrupt nonce file — start with empty set (fail-safe, not fail-open:
        // a corrupt file means we can't replay-detect prior nonces, but we don't
        // crash on startup; log if needed).
      }
    }
  }

  private persistNonces(): void {
    writeFileSync(this.nonceFilePath, JSON.stringify([...this.seenNonces]), 'utf8');
  }

  loadScope(raw: unknown, token?: ScopeToken): void {
    const { settings } = this.opts;
    const manifest = withDefaultExcludes(parseScopeManifest(raw, this.now()));

    if (settings.requireSignedAuthorization) {
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
