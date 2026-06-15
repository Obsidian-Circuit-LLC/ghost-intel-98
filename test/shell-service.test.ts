import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable fake PTY, injected by mocking node-pty.
const ptyInstances: any[] = [];
vi.mock('node-pty', () => ({
  spawn: vi.fn((file: string, args: string[], opts: any) => {
    const handlers: Record<string, ((arg: any) => void)[]> = { data: [], exit: [] };
    const inst = {
      file, args, opts, written: [] as string[], resized: null as any, killed: false,
      onData: (cb: (d: string) => void) => { handlers.data.push(cb); },
      onExit: (cb: (e: any) => void) => { handlers.exit.push(cb); },
      write: (d: string) => inst.written.push(d),
      resize: (c: number, r: number) => { inst.resized = { c, r }; },
      kill: () => { inst.killed = true; },
      _emitData: (d: string) => handlers.data.forEach((h) => h(d)),
      _emitExit: () => handlers.exit.forEach((h) => h({ exitCode: 0 }))
    };
    ptyInstances.push(inst);
    return inst;
  })
}));

import * as shellSvc from '../src/main/services/shell';
import { channels } from '../src/shared/ipc-contracts';

function fakeWindow() {
  const sent: { ch: string; payload: any }[] = [];
  return { win: { webContents: { send: (ch: string, payload: any) => sent.push({ ch, payload }) } }, sent };
}

beforeEach(() => { ptyInstances.length = 0; });

describe('shell service', () => {
  it('connects, wires data → onData IPC, and returns a sessionId', async () => {
    const { win, sent } = fakeWindow();
    const { sessionId } = await shellSvc.connect('cmd', () => win as any);
    expect(sessionId).toBeTruthy();
    expect(ptyInstances.length).toBe(1);
    ptyInstances[0]._emitData('hello');
    expect(sent.find((s) => s.ch === channels.shell.onData)?.payload).toEqual({ sessionId, data: 'hello' });
  });

  it('write/resize/disconnect reach the pty', async () => {
    const { win } = fakeWindow();
    const { sessionId } = await shellSvc.connect('cmd', () => win as any);
    await shellSvc.write(sessionId, 'dir\r');
    expect(ptyInstances[0].written).toContain('dir\r');
    await shellSvc.resize(sessionId, 120, 40);
    expect(ptyInstances[0].resized).toEqual({ c: 120, r: 40 });
    await shellSvc.disconnect(sessionId);
    expect(ptyInstances[0].killed).toBe(true);
  });

  it('pty exit emits onClose and drops the session', async () => {
    const { win, sent } = fakeWindow();
    const { sessionId } = await shellSvc.connect('cmd', () => win as any);
    ptyInstances[0]._emitExit();
    expect(sent.find((s) => s.ch === channels.shell.onClose)?.payload.sessionId).toBe(sessionId);
    await expect(shellSvc.write(sessionId, 'x')).rejects.toThrow();
  });

  it('write to an unknown session rejects', async () => {
    await expect(shellSvc.write('sh-nope', 'x')).rejects.toThrow();
  });
});
