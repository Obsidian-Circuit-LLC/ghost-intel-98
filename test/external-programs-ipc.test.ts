// @vitest-environment node
/**
 * External Apps IPC — sender-gate, list/refresh/launch/openFolder wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const assertTrustedSender = vi.fn((e: { __untrusted?: boolean }) => {
  if (e?.__untrusted) throw new Error('untrusted sender frame');
});
vi.mock('../src/main/capture/capture-window', () => ({ assertTrustedSender: (e: unknown) => assertTrustedSender(e as never) }));

const scanExternalPrograms = vi.fn();
vi.mock('../src/main/externalPrograms/service', () => ({ scanExternalPrograms: (...a: unknown[]) => scanExternalPrograms(...a) }));

const launchExternalProgram = vi.fn(async () => undefined);
vi.mock('../src/main/externalPrograms/launcher', () => ({ launchExternalProgram: (...a: unknown[]) => launchExternalProgram(...a) }));

const mkdir = vi.fn(async () => undefined);
vi.mock('node:fs/promises', () => ({ mkdir: (...a: unknown[]) => mkdir(...a) }));

const openPath = vi.fn(async () => '');
vi.mock('electron', () => ({ shell: { openPath: (...a: unknown[]) => openPath(...a) } }));

vi.mock('../src/main/storage/paths', () => ({ externalProgramsDir: () => '/fake/Programs' }));

import { registerExternalProgramsIpc } from '../src/main/externalPrograms/ipc';
import { channels } from '../src/shared/ipc-contracts';

type Fn = (e: unknown, ...a: unknown[]) => Promise<unknown>;

function harness() {
  const handlers = new Map<string, Fn>();
  registerExternalProgramsIpc({ handle: (c: string, fn: never) => handlers.set(c, fn) });
  return handlers;
}

const SCAN_ONE = {
  result: { programs: [{ id: 'file:MyTool.exe', name: 'MyTool', executableName: 'MyTool.exe', hasManifest: false }], diagnostics: [] },
  resolved: new Map([['file:MyTool.exe', {
    id: 'file:MyTool.exe', name: 'MyTool', executableName: 'MyTool.exe', hasManifest: false,
    executableAbsPath: '/fake/Programs/MyTool.exe', arguments: [], workingDirectory: '/fake/Programs',
  }]]),
};

beforeEach(() => {
  assertTrustedSender.mockClear();
  scanExternalPrograms.mockReset().mockResolvedValue(SCAN_ONE);
  launchExternalProgram.mockClear();
  mkdir.mockClear();
  openPath.mockClear().mockResolvedValue('');
});

describe('sender gate', () => {
  it('every handler rejects an untrusted sender before doing anything', async () => {
    const handlers = harness();
    for (const ch of Object.values(channels.externalPrograms)) {
      await expect(handlers.get(ch)!({ __untrusted: true }, {})).rejects.toThrow(/untrusted sender/i);
    }
  });
});

describe('list / refresh', () => {
  it('list returns the scan result (never the resolved paths)', async () => {
    const handlers = harness();
    const res = await handlers.get(channels.externalPrograms.list)!({});
    expect(res).toEqual(SCAN_ONE.result);
    expect(JSON.stringify(res)).not.toContain('/fake/Programs');
  });

  it('refresh re-scans rather than serving a stale cache', async () => {
    const handlers = harness();
    await handlers.get(channels.externalPrograms.list)!({});
    scanExternalPrograms.mockResolvedValue({ result: { programs: [], diagnostics: [] }, resolved: new Map() });
    const res = await handlers.get(channels.externalPrograms.refresh)!({});
    expect(res).toEqual({ programs: [], diagnostics: [] });
    expect(scanExternalPrograms).toHaveBeenCalledTimes(2);
  });
});

describe('launch', () => {
  it('launches a program found in the last scan, by id', async () => {
    const handlers = harness();
    await handlers.get(channels.externalPrograms.list)!({});
    const res = await handlers.get(channels.externalPrograms.launch)!({}, { id: 'file:MyTool.exe' });
    expect(res).toEqual({ ok: true });
    expect(launchExternalProgram).toHaveBeenCalledWith(SCAN_ONE.resolved.get('file:MyTool.exe'));
  });

  it('refuses to launch an id that was never scanned, rather than accepting an arbitrary path', async () => {
    const handlers = harness();
    await handlers.get(channels.externalPrograms.list)!({});
    await expect(handlers.get(channels.externalPrograms.launch)!({}, { id: 'file:not-real.exe' }))
      .rejects.toThrow(/no longer in the last scan|not found/i);
    expect(launchExternalProgram).not.toHaveBeenCalled();
  });

  it('refuses to launch before any scan has ever run, rather than trusting an empty cache silently', async () => {
    const handlers = harness();
    await expect(handlers.get(channels.externalPrograms.launch)!({}, { id: 'file:MyTool.exe' }))
      .rejects.toThrow();
    expect(launchExternalProgram).not.toHaveBeenCalled();
  });
});

describe('openFolder', () => {
  it('creates the folder if missing and opens it', async () => {
    const handlers = harness();
    const res = await handlers.get(channels.externalPrograms.openFolder)!({});
    expect(res).toBe('/fake/Programs');
    expect(mkdir).toHaveBeenCalledWith('/fake/Programs', { recursive: true });
    expect(openPath).toHaveBeenCalledWith('/fake/Programs');
  });

  it('throws when the OS reports it could not open the folder', async () => {
    openPath.mockResolvedValue('some OS error');
    const handlers = harness();
    await expect(handlers.get(channels.externalPrograms.openFolder)!({})).rejects.toThrow(/some OS error/);
  });
});
