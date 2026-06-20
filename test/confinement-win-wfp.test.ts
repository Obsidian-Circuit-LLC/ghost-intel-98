import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { makeSpawnWin32Wfp } from '../src/main/offensive/confinement/win-wfp';
import { encodeFrame, FrameDecoder, FRAME } from '../src/main/offensive/confinement/win-pipe';
import type { ConfinementPlan } from '../src/main/offensive/confinement/plan';

const plan: ConfinementPlan = { proxyPort: 54321, allowCidrs: ['203.0.113.0/24'], domainOnlyIncludes: [] };

function fakeService() {
  // app->service and service->app channels
  const toSvc = new PassThrough(); const toApp = new PassThrough();
  const dec = new FrameDecoder();
  const seen: any[] = [];
  toSvc.on('data', (c: Buffer) => {
    for (const f of dec.push(c)) {
      if (f.type !== FRAME.REQUEST) continue;
      const req = JSON.parse(f.body.toString()); seen.push(req);
      if (req.op === 'applyScope') toApp.write(encodeFrame(FRAME.RESPONSE, Buffer.from(JSON.stringify({ ok: true, scopeId: 'sc1' }))));
      else if (req.op === 'spawn') {
        toApp.write(encodeFrame(FRAME.RESPONSE, Buffer.from(JSON.stringify({ ok: true, pid: 4242 }))));
        toApp.write(encodeFrame(FRAME.STDOUT, Buffer.from('scan line\n')));
        toApp.write(encodeFrame(FRAME.EXIT, Buffer.from(JSON.stringify({ code: 0 }))));
      } else toApp.write(encodeFrame(FRAME.RESPONSE, Buffer.from(JSON.stringify({ ok: true }))));
    }
  });
  return { seen, connect: async () => ({ write: (b: Buffer) => toSvc.write(b), onData: (cb: (b: Buffer) => void) => toApp.on('data', cb), end: () => { toSvc.end(); toApp.end(); } }) };
}

describe('spawnWin32Wfp', () => {
  it('applies scope then spawns, demuxes stdout + exit, and returns the pid', async () => {
    const svc = fakeService();
    const spawnWin32Wfp = makeSpawnWin32Wfp({ connect: svc.connect, engineSid: () => 'S-1-5-21-1-2-3-1001' });
    const lines: string[] = []; let exited: number | null | undefined;
    const h = await spawnWin32Wfp('engine.exe', ['-u', 't'], plan, {
      onStdout: (b) => lines.push(b.toString()), onExit: (c) => { exited = c; },
    });
    expect(h.pid).toBe(4242);
    await new Promise((r) => setTimeout(r, 5));
    expect(lines.join('')).toContain('scan line');
    expect(exited).toBe(0);
    expect(svc.seen.map((r) => r.op)).toEqual(['applyScope', 'spawn']);
    // applyScope carried the engine SID + the filter spec
    expect(svc.seen[0].sid).toBe('S-1-5-21-1-2-3-1001');
    expect(Array.isArray(svc.seen[0].filters)).toBe(true);
  });

  it('stop() sends kill + clearScope and is idempotent', async () => {
    const svc = fakeService();
    const spawnWin32Wfp = makeSpawnWin32Wfp({ connect: svc.connect, engineSid: () => 'S-1-5-21-1-2-3-1001' });
    const h = await spawnWin32Wfp('engine.exe', [], plan, {});
    await h.stop(); await h.stop(); // second call must be a no-op
    const ops = svc.seen.map((r) => r.op);
    expect(ops.filter((o) => o === 'kill')).toHaveLength(1);
    expect(ops.filter((o) => o === 'clearScope')).toHaveLength(1);
  });

  it('rejects if applyScope fails (fail-closed: never spawn unconfined)', async () => {
    const toSvc = new PassThrough(); const toApp = new PassThrough(); const dec = new FrameDecoder();
    toSvc.on('data', (c: Buffer) => { for (const f of dec.push(c)) if (f.type === FRAME.REQUEST)
      toApp.write(encodeFrame(FRAME.RESPONSE, Buffer.from(JSON.stringify({ ok: false, error: 'WFP add denied' })))); });
    const connect = async () => ({ write: (b: Buffer) => toSvc.write(b), onData: (cb: any) => toApp.on('data', cb), end: () => {} });
    const spawnWin32Wfp = makeSpawnWin32Wfp({ connect, engineSid: () => 'S-1-5-21-1-2-3-1001' });
    await expect(spawnWin32Wfp('engine.exe', [], plan, {})).rejects.toThrow(/applyScope|WFP add denied/);
  });
});
