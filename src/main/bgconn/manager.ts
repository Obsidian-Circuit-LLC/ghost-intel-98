import { newSocksCreds, laneFor, type Lane, type Routing } from './lane';

export interface StartParams { phone: string; routing: Routing; channelSetHash: string; }
export interface BgWorker {
  connId: string; routing: Routing; channelSetHash: string;
  start(lane: Lane): Promise<{ pid: number; kill: () => void }>;
  stop(): Promise<void>;
}
export interface ManagerDeps {
  isTorBootstrapped(): boolean;
  now(): number;
  isVaultUnlocked(): boolean;
  socksHost: string; socksPort: number;
  idleTeardownAfterMs: number | null;
  maxReconnects: number;
  maxSessionAgeMs: number;
}
interface Live { worker: BgWorker; params: StartParams; startedAt: number; kill: () => void; consentKey: string; }

const consentKey = (p: StartParams): string => `${p.phone}|${p.routing}|${p.channelSetHash}`;

export class BackgroundConnectionManager {
  private workers = new Map<string, BgWorker>();
  private live = new Map<string, Live>();
  private lockedSince: number | null = null;
  private reconnects = new Map<string, number>();
  constructor(private readonly deps: ManagerDeps) {}

  register(w: BgWorker): void { this.workers.set(w.connId, w); }

  async start(connId: string, params: StartParams, opts: { confirmed: boolean }): Promise<void> {
    const worker = this.workers.get(connId);
    if (!worker) throw new Error(`no worker registered: ${connId}`);
    if (!opts.confirmed) throw new Error('connection not confirmed');
    if (params.routing === 'tor' && !this.deps.isTorBootstrapped()) throw new Error('tor not bootstrapped');
    const lane: Lane = params.routing === 'tor'
      ? laneFor({ routing: 'tor', socksHost: this.deps.socksHost, socksPort: this.deps.socksPort, creds: newSocksCreds() })
      : laneFor({ routing: 'direct' });
    const { kill } = await worker.start(lane);
    this.live.set(connId, { worker, params, startedAt: this.deps.now(), kill, consentKey: consentKey(params) });
  }

  async stop(connId: string): Promise<void> {
    const l = this.live.get(connId);
    if (!l) return;
    this.live.delete(connId);
    try { await l.worker.stop(); } finally { try { l.kill(); } catch { /* */ } }
  }

  async stopAll(_reason: string): Promise<void> {
    for (const connId of [...this.live.keys()]) await this.stop(connId);
  }

  list(): Array<{ connId: string; routing: Routing; startedAt: number }> {
    return [...this.live.values()].map((l) => ({ connId: l.worker.connId, routing: l.params.routing, startedAt: l.startedAt }));
  }

  /** Drive from a production interval (e.g. every 30s). Tracks the vault lock + fires idle-teardown,
   *  AND enforces max-session-age so a session can never silently run forever (red-team Finding 6). */
  tick(): void {
    const now = this.deps.now();
    // max-session-age: the ENFORCED bound (no worker cooperation needed).
    for (const l of [...this.live.values()]) {
      if (now - l.startedAt >= this.deps.maxSessionAgeMs) void this.stop(l.worker.connId);
    }
    const unlocked = this.deps.isVaultUnlocked();
    if (unlocked) { this.lockedSince = null; return; }
    if (this.lockedSince === null) this.lockedSince = now;
    if (this.deps.idleTeardownAfterMs !== null && now - this.lockedSince >= this.deps.idleTeardownAfterMs) {
      void this.stopAll('idle-teardown');
      this.lockedSince = null;
    }
  }

  /** A worker MAY call this on each reconnect; exceeding maxReconnects tears the connection down
   *  (so a reconnect storm can't keep a session alive indefinitely between max-age checks). */
  noteReconnect(connId: string): void {
    if (!this.live.has(connId)) return;
    const n = (this.reconnects.get(connId) ?? 0) + 1;
    this.reconnects.set(connId, n);
    if (n > this.deps.maxReconnects) { this.reconnects.delete(connId); void this.stop(connId); }
  }

  isVaultLocked(): boolean { return !this.deps.isVaultUnlocked(); }
}
