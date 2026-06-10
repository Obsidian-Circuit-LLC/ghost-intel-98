import { describe, it, expect } from 'vitest';
import { spawnWithSecretStdin } from '../src/main/bgconn/spawn-secret';

describe('spawnWithSecretStdin', () => {
  it('passes the secret on stdin, never in argv or env', async () => {
    // A node child that echoes back: its argv, whether SECRET appears in env, and the stdin it read.
    const code = `let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{` +
      `process.stdout.write(JSON.stringify({argv:process.argv.slice(2),envHasSecret:Object.values(process.env).some(v=>v&&v.includes('SationS3cret')),stdin:d}))});`;
    const child = spawnWithSecretStdin(process.execPath, ['-e', code], 'SationS3cret', {});
    let out = ''; child.stdout!.on('data', (c) => (out += c));
    await new Promise<void>((r) => child.on('close', () => r()));
    const got = JSON.parse(out);
    expect(got.stdin).toBe('SationS3cret');             // secret arrived via stdin
    expect(got.argv.join(' ')).not.toContain('SationS3cret'); // not in argv
    expect(got.envHasSecret).toBe(false);               // not in env
  });
});
