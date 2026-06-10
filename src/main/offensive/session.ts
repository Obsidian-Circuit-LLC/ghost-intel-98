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
    this.confirmedHash = null;
    this.lastNow = this.now();
  }
  confirm(): void { if (this.manifest) this.confirmedHash = this.contentHash; }
  consumeScan(): void { if (this.mode === 'per-scan') this.confirmedHash = null; }

  private clockOk(): boolean {
    const t = this.now();
    if (t < this.lastNow) return false;
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
