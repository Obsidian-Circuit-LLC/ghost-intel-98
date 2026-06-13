import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { makeSpawnWin32Wfp, type PipeConn } from '../src/main/offensive/confinement/win-wfp';
import { encodeFrame, FrameDecoder, FRAME, type ControlRequest } from '../src/main/offensive/confinement/win-pipe';
import type { ConfinementPlan } from '../src/main/offensive/confinement/plan';

const plan: ConfinementPlan = { proxyPort: 54321, allowCidrs: ['203.0.113.0/24'], domainOnlyIncludes: [] };
const SID = 'S-1-5-21-1-2-3-1001';
const tick = () => new Promise((r) => setTimeout(r, 5));

/** A fake SYSTEM service over PassThroughs. `spawnSendsExit` controls whether 'spawn' streams an EXIT. */
function fakeService(spawnSendsExit = true) {
  const toSvc = new PassThrough();
  const toApp = new PassThrough();
  const dec = new FrameDecoder();
  const seen: ControlRequest[] = [];
  const reply = (obj: unknown) => toApp.write(encodeFrame(FRAME.RESPONSE, Buffer.from(JSON.stringify(obj))));
  toSvc.on('data', (c: Buffer) => {
    for (const f of dec.push(c)) {
      if (f.type !== FRAME.REQUEST) continue;
      const req = JSON.parse(f.body.toString()) as ControlRequest;
      seen.push(req);
      if (req.op === 'applyScope') reply({ ok: true, scopeId: 'sc1' });
      else if (req.op === 'spawn') {
        reply({ ok: true, pid: 4242 });
        // Stream output + exit on a LATER tick — the realistic shape (the child runs, then exits),
        // and it guarantees the app has processed the spawn response (set `pid`) before EXIT.
        setTimeout(() => {
          toApp.write(encodeFrame(FRAME.STDOUT, Buffer.from('scan line\n')));
          if (spawnSendsExit) toApp.write(encodeFrame(FRAME.EXIT, Buffer.from(JSON.stringify({ code: 0 }))));
        }, 1);
      } else reply({ ok: true });
    }
  });
  const connect = async (): Promise<PipeConn> => ({
    write: (b) => { toSvc.write(b); },
    onData: (cb) => { toApp.on('data', cb); },
    end: () => { toSvc.end(); toApp.end(); },
  });
  return { seen, connect };
}

describe('spawnWin32Wfp', () => {
  it('applies scope (carrying SID + filter spec) then spawns, demuxing stdout + exit', async () => {
    const svc = fakeService();
    const spawnWin32Wfp = makeSpawnWin32Wfp({ connect: svc.connect, engineSid: () => SID });
    const lines: string[] = [];
    let exited: number | null | undefined;
    const h = await spawnWin32Wfp('engine.exe', ['-u', 't'], plan, {
      onStdout: (b) => lines.push(b.toString()),
      onExit: (c) => { exited = c; },
    });
    expect(h.pid).toBe(4242);
    await tick();
    expect(lines.join('')).toContain('scan line');
    expect(exited).toBe(0);
    // first two control ops are applyScope then spawn (exit auto-teardown appends kill+clearScope)
    expect(svc.seen.map((r) => r.op).slice(0, 2)).toEqual(['applyScope', 'spawn']);
    const apply = svc.seen[0] as Extract<ControlRequest, { op: 'applyScope' }>;
    expect(apply.sid).toBe(SID);
    expect(Array.isArray(apply.filters)).toBe(true);
    expect(apply.filters.length).toBeGreaterThan(0);
  });

  it('auto-tears-down on child exit (sends kill + clearScope exactly once)', async () => {
    const svc = fakeService(true);
    const spawnWin32Wfp = makeSpawnWin32Wfp({ connect: svc.connect, engineSid: () => SID });
    await spawnWin32Wfp('engine.exe', [], plan, {});
    await tick();
    const ops = svc.seen.map((r) => r.op);
    expect(ops.filter((o) => o === 'kill')).toHaveLength(1);
    expect(ops.filter((o) => o === 'clearScope')).toHaveLength(1);
  });

  it('stop() is idempotent (no duplicate kill/clearScope when called after auto-teardown)', async () => {
    const svc = fakeService(false); // no auto-exit; we drive stop() manually
    const spawnWin32Wfp = makeSpawnWin32Wfp({ connect: svc.connect, engineSid: () => SID });
    const h = await spawnWin32Wfp('engine.exe', [], plan, {});
    await h.stop();
    await h.stop();
    await tick();
    const ops = svc.seen.map((r) => r.op);
    expect(ops.filter((o) => o === 'kill')).toHaveLength(1);
    expect(ops.filter((o) => o === 'clearScope')).toHaveLength(1);
  });

  it('fails closed if applyScope is rejected (never spawns)', async () => {
    const toSvc = new PassThrough();
    const toApp = new PassThrough();
    const dec = new FrameDecoder();
    const seen: string[] = [];
    toSvc.on('data', (c: Buffer) => {
      for (const f of dec.push(c)) {
        if (f.type !== FRAME.REQUEST) continue;
        seen.push((JSON.parse(f.body.toString()) as ControlRequest).op);
        toApp.write(encodeFrame(FRAME.RESPONSE, Buffer.from(JSON.stringify({ ok: false, error: 'WFP add denied' }))));
      }
    });
    const connect = async (): Promise<PipeConn> => ({ write: (b) => { toSvc.write(b); }, onData: (cb) => { toApp.on('data', cb); }, end: () => {} });
    const spawnWin32Wfp = makeSpawnWin32Wfp({ connect, engineSid: () => SID });
    await expect(spawnWin32Wfp('engine.exe', [], plan, {})).rejects.toThrow(/applyScope|WFP add denied/);
    expect(seen).not.toContain('spawn');
  });
});
