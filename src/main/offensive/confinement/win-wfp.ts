import type { ConfinedHandle, ConfinedIO, PlatformImpl } from './index';
import type { ConfinementPlan } from './plan';
import { __registerWin32Impl } from './index';
import { buildWfpFilterSpec } from './win-wfp-spec';
import { encodeFrame, FrameDecoder, FRAME, type ControlRequest, type ControlResponse } from './win-pipe';

/**
 * The win32 arm of spawnConfined. It drives the dcs98-confine SYSTEM service over a named pipe:
 * applyScope (push the buildWfpFilterSpec output) → spawn (CreateProcessAsUser as the engine user, so the
 * WFP filters bind by SID) → demux child stdout/stderr/exit frames into ConfinedIO. stop() sends
 * kill + clearScope and is idempotent + crash-safe (will-quit backstop, mirroring linux-netns.ts).
 *
 * The pipe connector + engine-SID reader are injected so the whole lifecycle is unit-tested on Linux
 * against an injected duplex; the real wiring (bottom of file, win32-only) uses node:net + readEngineSid.
 */
export interface PipeConn {
  write(b: Buffer): void;
  onData(cb: (b: Buffer) => void): void;
  end(): void;
}
export interface WinWfpDeps {
  connect(): Promise<PipeConn>;
  /** The dedicated engine user's SID, discovered at enable-setup time. Throwing ⇒ engine not enabled. */
  engineSid(): string;
}

/** Live jails, for a will-quit backstop mirroring linux-netns.ts. */
interface LiveWin {
  conn: PipeConn;
  scopeId: string;
  pid: number;
}
const live = new Set<LiveWin>();

export function makeSpawnWin32Wfp(deps: WinWfpDeps): PlatformImpl {
  return async (cmd: string, args: string[], plan: ConfinementPlan, io: ConfinedIO): Promise<ConfinedHandle> => {
    const conn = await deps.connect();
    const dec = new FrameDecoder();
    const pending: ((r: ControlResponse) => void)[] = [];
    let scopeId = '';
    let pid = -1;
    let torn = false;

    const call = (req: ControlRequest): Promise<ControlResponse> =>
      new Promise((resolve) => {
        pending.push(resolve);
        conn.write(encodeFrame(FRAME.REQUEST, Buffer.from(JSON.stringify(req))));
      });

    // Defined BEFORE the demux so an EXIT frame can trigger it; idempotent via `torn`. No mutation of
    // io.onExit (which would race frame-coalescing) — the demux calls io.onExit then stop() directly.
    const stop = async (): Promise<void> => {
      if (torn) return;
      torn = true;
      if (pid >= 0) { try { await call({ op: 'kill', pid }); } catch { /* best effort */ } }
      if (scopeId) { try { await call({ op: 'clearScope', scopeId }); } catch { /* best effort */ } }
      for (const j of live) if (j.conn === conn) live.delete(j);
      try { conn.end(); } catch { /* already closed */ }
    };

    conn.onData((chunk) => {
      for (const f of dec.push(chunk)) {
        if (f.type === FRAME.RESPONSE) pending.shift()?.(JSON.parse(f.body.toString()) as ControlResponse);
        else if (f.type === FRAME.STDOUT) io.onStdout?.(f.body);
        else if (f.type === FRAME.STDERR) io.onStderr?.(f.body);
        else if (f.type === FRAME.EXIT) {
          io.onExit?.((JSON.parse(f.body.toString()) as { code: number | null }).code);
          void stop(); // tear the jail down when the child exits on its own (mirrors linux-netns)
        }
      }
    });

    const sid = deps.engineSid();
    const spec = buildWfpFilterSpec(plan, sid);
    const applied = await call({ op: 'applyScope', proxyPort: plan.proxyPort, allowCidrs: plan.allowCidrs, sid, filters: spec.filters });
    if (!applied.ok || !applied.scopeId) {
      try { conn.end(); } catch { /* */ }
      throw new Error(`confinement applyScope failed: ${applied.ok ? 'no scopeId returned' : applied.error}`);
    }
    scopeId = applied.scopeId;

    const spawned = await call({ op: 'spawn', scopeId, cmd, args });
    if (!spawned.ok || spawned.pid == null) {
      try { await call({ op: 'clearScope', scopeId }); } catch { /* */ }
      try { conn.end(); } catch { /* */ }
      throw new Error(`confinement spawn failed: ${spawned.ok ? 'no pid returned' : spawned.error}`);
    }
    pid = spawned.pid;
    live.add({ conn, scopeId, pid });

    return { pid, stop };
  };
}

let willQuitWired = false;
function ensureWillQuitBackstop(): void {
  if (willQuitWired) return;
  willQuitWired = true;
  let app: { on?: (e: string, cb: () => void) => void } | undefined;
  try {
    app = (require('electron') as { app?: typeof app }).app;
  } catch {
    app = undefined;
  }
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
// Self-register only on win32 (mirrors linux-netns.ts's guarded self-register).
if (process.platform === 'win32') {
  ensureWillQuitBackstop();
  const net = require('node:net') as typeof import('node:net');
  const { readEngineSid } = require('./enable-setup') as typeof import('./enable-setup');
  __registerWin32Impl(
    makeSpawnWin32Wfp({
      engineSid: () => readEngineSid(), // throws if not enabled — fail-closed
      connect: () =>
        new Promise<PipeConn>((resolve, reject) => {
          const sock = net.connect('\\\\.\\pipe\\dcs98-confine');
          sock.once('connect', () =>
            resolve({
              write: (b) => { sock.write(b); },
              onData: (cb) => { sock.on('data', cb); },
              end: () => { sock.end(); },
            }),
          );
          sock.once('error', reject);
        }),
    }),
  );
}
