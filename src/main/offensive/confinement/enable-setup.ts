import { join } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Main-process wrapper for the one-time elevated "Enable offensive engine" setup. It launches
 * `dcs98-confine.exe install` ELEVATED (UAC) on demand, reads the engine SID the install wrote, and
 * reports enabled/not-enabled status so the engage UX (05d) can require it. The elevation launch and the
 * SID-file read are injected so the logic is unit-tested on Linux; the real wiring binds them to a
 * ShellExecute-runas (PowerShell `Start-Process -Verb RunAs`) and the filesystem.
 */
export interface EngineStatus {
  enabled: boolean;
  engineSid: string | null;
}

export interface EnableSetupDeps {
  platform: NodeJS.Platform | string;
  /** Read %ProgramData%\DCS98\confine\engine.sid; throws if absent. */
  readSidFile(): string;
  /** Launch `exe args` ELEVATED (UAC), resolving when it exits 0, rejecting otherwise. */
  elevate(exe: string, args: string[]): Promise<void>;
}

export function makeEnableSetup(deps: EnableSetupDeps): {
  status(): Promise<EngineStatus>;
  enable(): Promise<EngineStatus>;
  disable(): Promise<EngineStatus>;
} {
  const status = async (): Promise<EngineStatus> => {
    try {
      const sid = deps.readSidFile().trim();
      return sid ? { enabled: true, engineSid: sid } : { enabled: false, engineSid: null };
    } catch {
      return { enabled: false, engineSid: null };
    }
  };
  const enable = async (): Promise<EngineStatus> => {
    if (deps.platform !== 'win32') {
      throw new Error('offensive-engine confinement setup is not supported on this platform');
    }
    await deps.elevate(confineExePath(), ['install']);
    return status();
  };
  const disable = async (): Promise<EngineStatus> => {
    if (deps.platform !== 'win32') {
      throw new Error('offensive-engine confinement setup is not supported on this platform');
    }
    await deps.elevate(confineExePath(), ['uninstall']);
    return status();
  };
  return { status, enable, disable };
}

/** Resolve the bundled helper under resources (mirrors how tor/exiftool resolve extraResources). */
export function confineExePath(): string {
  const base = process.resourcesPath || process.cwd();
  return join(base, 'confine', 'dcs98-confine.exe');
}

/** Path to the engine-SID file the elevated install wrote (DACL: readable by the interactive user). */
export function engineSidPath(): string {
  return join(process.env.ProgramData || 'C:\\ProgramData', 'DCS98', 'confine', 'engine.sid');
}

/** Read the engine SID for win-wfp.ts. Throws if the engine isn't enabled — fail-closed: no SID ⇒ no
 *  confined spawn (spawnConfined surfaces the error rather than running an unconfined child). */
export function readEngineSid(): string {
  const sid = readFileSync(engineSidPath(), 'utf8').trim();
  if (!sid) throw new Error('offensive engine is not enabled (empty engine SID)');
  return sid;
}
