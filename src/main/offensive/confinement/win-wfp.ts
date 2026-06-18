import type { ConfinedHandle, ConfinedIO, PlatformImpl } from './index';
import type { ConfinementPlan } from './plan';
import { __registerWin32Impl } from './index';
import { buildWfpFilterSpec } from './win-wfp-spec';
import { encodeFrame, FrameDecoder, FRAME, type ControlRequest, type ControlResponse } from './win-pipe';

/** A connected pipe: write bytes, subscribe to bytes, close. Injected so tests use a PassThrough and the
 *  real impl uses node:net's named-pipe client (\\.\pipe\dcs98-confine). */
export interface PipeConn { write(b: Buffer): void; onData(cb: (b: Buffer) => void): void; end(): void; }
export interface WinWfpDeps {
  connect(): Promise<PipeConn>;
  /** The dedicated engine user's SID, discovered once at enable-setup time and read by the app. */
  engineSid(): string;
}

/**
 * The Windows arm of spawnConfined. Connects to the SYSTEM-service pipe, sends applyScope (the verbatim
 * buildWfpFilterSpec output), then spawn, demuxes the returned frames into io callbacks, and returns a
 * ConfinedHandle whose stop() force-terminates (kill + clearScope, once — `torn` guard).
 *
 * Teardown split (mirrors the netns design + satisfies the lifecycle tests deterministically):
 *  - NATURAL child exit → the SYSTEM service removes that scope's WFP filters server-side (it owns them);
 *    the app only propagates io.onExit and drops the `live` entry. It does NOT send kill/clearScope — the
 *    child is already gone and the filters are already cleared.
 *  - EXPLICIT stop() (operator cancel, before exit) → send kill + clearScope, idempotently.
 *  - Crash → the will-quit backstop below force-clears any `live` jails.
 */
export function makeSpawnWin32Wfp(deps: WinWfpDeps): PlatformImpl {
  return async (cmd: string, args: string[], plan: ConfinementPlan, io: ConfinedIO): Promise<ConfinedHandle> => {
    const conn = await deps.connect();
    const dec = new FrameDecoder();
    const pending: ((r: ControlResponse) => void)[] = [];
    let entry: LiveWin | undefined;
    conn.onData((chunk) => {
      for (const f of dec.push(chunk)) {
        if (f.type === FRAME.RESPONSE) pending.shift()?.(JSON.parse(f.body.toString()) as ControlResponse);
        else if (f.type === FRAME.STDOUT) io.onStdout?.(f.body);
        else if (f.type === FRAME.STDERR) io.onStderr?.(f.body);
        else if (f.type === FRAME.EXIT) {
          io.onExit?.((JSON.parse(f.body.toString()) as { code: number | null }).code);
          if (entry) live.delete(entry); // service clears scope server-side on natural exit
        }
      }
    });
    const call = (req: ControlRequest): Promise<ControlResponse> => new Promise((resolve) => {
      pending.push(resolve);
      conn.write(encodeFrame(FRAME.REQUEST, Buffer.from(JSON.stringify(req))));
    });

    const sid = deps.engineSid();
    const spec = buildWfpFilterSpec(plan, sid);
    const applied = await call({ op: 'applyScope', proxyPort: plan.proxyPort, allowCidrs: plan.allowCidrs, sid, filters: spec.filters });
    if (!applied.ok || !applied.scopeId) {
      conn.end();
      throw new Error(`confinement applyScope failed: ${applied.ok ? 'no scopeId' : applied.error}`);
    }
    const scopeId = applied.scopeId;
    const spawned = await call({ op: 'spawn', scopeId, cmd, args });
    if (!spawned.ok || spawned.pid == null) {
      await call({ op: 'clearScope', scopeId }); conn.end();
      throw new Error(`confinement spawn failed: ${spawned.ok ? 'no pid' : spawned.error}`);
    }
    const pid = spawned.pid;
    entry = { conn, scopeId, pid };
    live.add(entry);

    let torn = false;
    const stop = async (): Promise<void> => {
      if (torn) return; torn = true;
      try { await call({ op: 'kill', pid }); } catch { /* best effort */ }
      try { await call({ op: 'clearScope', scopeId }); } catch { /* best effort */ }
      if (entry) live.delete(entry);
      conn.end();
    };
    return { pid, stop };
  };
}

/** Live jails, for a will-quit backstop mirroring linux-netns.ts. */
interface LiveWin { conn: PipeConn; scopeId: string; pid: number; }
const live = new Set<LiveWin>();
let willQuitWired = false;
function ensureWillQuitBackstop(): void {
  if (willQuitWired) return; willQuitWired = true;
  let app: { on?: (e: string, cb: () => void) => void } | undefined;
  try { app = (require('electron') as { app?: typeof app }).app; } catch { app = undefined; }
  app?.on?.('will-quit', () => {
    for (const j of live) {
      try { j.conn.write(encodeFrame(FRAME.REQUEST, Buffer.from(JSON.stringify({ op: 'kill', pid: j.pid })))); } catch { /* */ }
      try { j.conn.write(encodeFrame(FRAME.REQUEST, Buffer.from(JSON.stringify({ op: 'clearScope', scopeId: j.scopeId })))); } catch { /* */ }
      try { j.conn.end(); } catch { /* */ }
    }
    live.clear();
  });
}

// Real wiring: a node:net client to the SYSTEM-service named pipe + the enable-setup-discovered SID.
// Self-register only on win32 (mirrors linux-netns.ts).
if (process.platform === 'win32') {
  ensureWillQuitBackstop();
  const net = require('node:net') as typeof import('node:net');
  const { readEngineSid } = require('./enable-setup') as typeof import('./enable-setup');
  __registerWin32Impl(makeSpawnWin32Wfp({
    engineSid: () => readEngineSid(), // throws if the engine isn't enabled — fail-closed
    connect: () => new Promise<PipeConn>((resolve, reject) => {
      const sock = net.connect('\\\\.\\pipe\\dcs98-confine');
      sock.once('connect', () => resolve({
        write: (b) => sock.write(b),
        onData: (cb) => sock.on('data', cb),
        end: () => sock.end(),
      }));
      sock.once('error', reject);
    }),
  }));
}
