/**
 * External Apps — IPC registration (`registerExternalProgramsIpc`). Every handler
 * `assertTrustedSender(e)` first, mirroring `spectre/ipc.ts`.
 *
 * `launch` takes only an opaque `id` — never a path. The id must have come from THIS process's own
 * most recent scan (held in `lastScan`, main-process memory only); an id from a stale or nonexistent
 * scan is refused rather than trusted, so the renderer can never smuggle an arbitrary filesystem
 * path into a spawn call.
 */
import { mkdir } from 'node:fs/promises';
import { shell } from 'electron';
import { channels } from '@shared/ipc-contracts';
import type { ExternalProgramsScanResult } from '@shared/external-programs/types';
import { assertTrustedSender } from '../capture/capture-window';
import { scanExternalPrograms, type ScannedProgram } from './service';
import { launchExternalProgram } from './launcher';
import { externalProgramsDir } from '../storage/paths';

export type ExternalProgramsHandle = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

export function registerExternalProgramsIpc(opts: { handle: ExternalProgramsHandle }): void {
  const h = opts.handle;
  let lastScan = new Map<string, ScannedProgram>();

  async function rescan(): Promise<ExternalProgramsScanResult> {
    const { result, resolved } = await scanExternalPrograms();
    lastScan = resolved;
    return result;
  }

  h(channels.externalPrograms.list, async (e) => {
    assertTrustedSender(e);
    return rescan();
  });

  h(channels.externalPrograms.refresh, async (e) => {
    assertTrustedSender(e);
    return rescan();
  });

  h(channels.externalPrograms.launch, async (e, arg) => {
    assertTrustedSender(e);
    const o = (arg && typeof arg === 'object' ? arg : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const program = lastScan.get(id);
    if (!program) {
      throw new Error('externalPrograms: that program is no longer in the last scan — click Refresh Programs and try again');
    }
    await launchExternalProgram(program);
    return { ok: true as const };
  });

  h(channels.externalPrograms.openFolder, async (e) => {
    assertTrustedSender(e);
    const dir = externalProgramsDir();
    await mkdir(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
    return dir;
  });
}
