import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchExternalProgram } from '../src/main/externalPrograms/launcher';
import type { ScannedProgram } from '../src/main/externalPrograms/service';

let root: string;

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ga98-external-programs-launch-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function program(overrides: Partial<ScannedProgram> = {}): ScannedProgram {
  return {
    id: 'file:test.sh', name: 'test', executableName: 'test.sh', hasManifest: false,
    executableAbsPath: join(root, 'test.sh'), arguments: [], workingDirectory: root,
    ...overrides,
  };
}

describe('External Apps — launching', () => {
  it('spawns the resolved executable as a separate, detached OS process and resolves on spawn', async () => {
    const script = join(root, 'test.sh');
    await writeFile(script, '#!/bin/sh\nexit 0\n');
    await chmod(script, 0o755);
    await expect(launchExternalProgram(program({ executableAbsPath: script }))).resolves.toBeUndefined();
  });

  it('passes the manifest arguments through to the child process', async () => {
    const script = join(root, 'echo-args.sh');
    const outFile = join(root, 'out.txt');
    await writeFile(script, `#!/bin/sh\necho "$@" > "${outFile}"\n`);
    await chmod(script, 0o755);
    await launchExternalProgram(program({ executableAbsPath: script, arguments: ['--flag', 'value'] }));
    await new Promise((r) => setTimeout(r, 200));
    const { readFile } = await import('node:fs/promises');
    expect((await readFile(outFile, 'utf8')).trim()).toBe('--flag value');
  });

  it('rejects when the executable does not exist, rather than hanging', async () => {
    await expect(launchExternalProgram(program({ executableAbsPath: join(root, 'does-not-exist.sh') })))
      .rejects.toThrow();
  });
});
