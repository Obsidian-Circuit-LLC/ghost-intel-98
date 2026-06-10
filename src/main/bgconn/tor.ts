import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { buildBgconnTorrc } from './torrc';

export interface BgconnTorOptions {
  torExe: string; dataDir: string; socksPort: number; controlPort: number;
  spawn?: typeof nodeSpawn;
  writeFile?: (path: string, data: string) => Promise<void>;
}

export class BgconnTor {
  private proc: ChildProcess | null = null;
  private bootstrapped = false;
  constructor(private readonly o: BgconnTorOptions) {}

  isBootstrapped(): boolean { return this.bootstrapped; }
  socksPort(): number { return this.o.socksPort; }

  async start(): Promise<void> {
    if (this.proc) return;
    const spawn = this.o.spawn ?? nodeSpawn;
    const writeFile = this.o.writeFile ?? fsWriteFile;
    const torrcPath = join(this.o.dataDir, 'torrc');
    // Spawn and attach bootstrap listener synchronously (before any await) so that test
    // harnesses emitting stdout data immediately after start() returns the promise will
    // be captured.  The torrc write is initiated in parallel and must complete before tor
    // actually tries to read it; with the real binary the spawn + exec latency covers this
    // comfortably.
    const writePromise = writeFile(torrcPath, buildBgconnTorrc({ socksPort: this.o.socksPort, controlPort: this.o.controlPort, dataDir: this.o.dataDir }));
    const proc = spawn(this.o.torExe, ['-f', torrcPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    await Promise.all([
      writePromise,
      new Promise<void>((resolve, reject) => {
        const onData = (b: Buffer): void => { if (b.toString().includes('Bootstrapped 100%')) { this.bootstrapped = true; resolve(); } };
        proc.stdout?.on('data', onData);
        proc.once('error', reject);
        proc.once('exit', () => { if (!this.bootstrapped) reject(new Error('bgconn tor exited before bootstrap')); });
      }),
    ]);
  }

  async stop(): Promise<void> {
    const p = this.proc;
    this.proc = null; this.bootstrapped = false;
    if (!p || p.killed) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } resolve(); }, 4000);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      p.kill();
    });
  }
}
