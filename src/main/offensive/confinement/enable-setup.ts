import { join } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Main-process wrapper for the one-time elevated "Enable offensive engine" setup. It launches
 * dcs98-confine.exe install/uninstall ELEVATED (UAC) on demand and reports enabled/not-enabled status
 * (does the engine.sid file the installer wrote exist?). The elevation launch + the SID-file read are
 * INJECTED so this logic is unit-tested on Linux; the real wiring (register.ts) binds them to a
 * ShellExecute-runas spawn and the filesystem. Fail-closed: no SID file ⇒ not enabled ⇒ win-wfp.ts
 * refuses to spawn a confined child (readEngineSid throws).
 */
export interface EngineStatus { enabled: boolean; engineSid: string | null }
export interface EnableSetupDeps {
  platform: NodeJS.Platform | string;
  /** Read %ProgramData%\DCS98\confine\engine.sid; throws if absent. */
  readSidFile(): string;
  /** Launch `exe args` ELEVATED (UAC), resolving when it exits 0. */
  elevate(exe: string, args: string[]): Promise<void>;
}

export function makeEnableSetup(deps: EnableSetupDeps) {
  const status = async (): Promise<EngineStatus> => {
    try {
      const sid = deps.readSidFile().trim();
      return sid ? { enabled: true, engineSid: sid } : { enabled: false, engineSid: null };
    } catch {
      return { enabled: false, engineSid: null };
    }
  };
  const enable = async (): Promise<EngineStatus> => {
    if (deps.platform !== 'win32') throw new Error('offensive-engine confinement setup is not supported on this platform');
    await deps.elevate(confineExePath(), ['install']);
    return status();
  };
  const disable = async (): Promise<EngineStatus> => {
    if (deps.platform !== 'win32') throw new Error('offensive-engine confinement setup is not supported on this platform');
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

/** Read the engine SID for win-wfp.ts (throws → fail-closed: engine not enabled ⇒ no confined spawn). */
export function readEngineSid(): string {
  const p = join(process.env.ProgramData || 'C:\\ProgramData', 'DCS98', 'confine', 'engine.sid');
  return readFileSync(p, 'utf8').trim();
}
