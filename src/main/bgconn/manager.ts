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
}
