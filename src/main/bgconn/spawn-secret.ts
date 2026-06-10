import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface SecretSpawnOptions extends SpawnOptions { spawn?: typeof nodeSpawn; }

/** Spawn a subprocess and hand it `secret` via stdin (write then end). The secret is NEVER placed
 *  in argv or env. Core dumps disabled where supported (the child should also opt out). */
export function spawnWithSecretStdin(cmd: string, args: string[], secret: string, opts: SecretSpawnOptions): ChildProcess {
  const spawn = opts.spawn ?? nodeSpawn;
  const { spawn: _omit, ...rest } = opts;
  void _omit; // intentionally excluded from child spawn call
  const child = spawn(cmd, args, { ...rest, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin!.write(secret);
  child.stdin!.end();
  return child;
}
