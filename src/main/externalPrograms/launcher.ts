/**
 * External Apps — launching a discovered program as a genuinely separate OS process. Mirrors
 * `services/firefox.ts`'s spawn pattern: `shell: false` (no shell-interpolation surface — the
 * executable and each argument are separate argv elements, never concatenated into a command
 * string), `detached: true` + `child.unref()` so the launched program outlives Ghost Intel 98,
 * and the promise only resolves once the child has actually spawned, never optimistically.
 *
 * `program.executableAbsPath` is always a path THIS process resolved during a scan (see
 * `service.ts` / `manifestParser.ts`), never a string handed to us by the renderer — the renderer
 * only ever holds an opaque id.
 */
import { spawn } from 'node:child_process';
import type { ScannedProgram } from './service';

export function launchExternalProgram(program: ScannedProgram): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program.executableAbsPath, program.arguments, {
      cwd: program.workingDirectory,
      detached: true,
      stdio: 'ignore',
    });
    let settled = false;
    child.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
    child.on('spawn', () => { if (!settled) { settled = true; child.unref(); resolve(); } });
  });
}
