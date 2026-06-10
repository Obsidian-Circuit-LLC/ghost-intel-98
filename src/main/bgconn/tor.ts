import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { writeFile as fsWriteFile, mkdir as fsMkdir } from 'node:fs/promises';
import { buildBgconnTorrc } from './torrc';

export interface BgconnTorOptions {
  torExe: string; dataDir: string; socksPort: number; controlPort: number;
  spawn?: typeof nodeSpawn;
  writeFile?: (path: string, data: string) => Promise<void>;
  mkdir?: (path: string, opts: { recursive: boolean }) => Promise<unknown>;
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
    const mkdir = this.o.mkdir ?? fsMkdir;
    const torrcPath = join(this.o.dataDir, 'torrc');
    // STRICT ORDER: the dir must exist and the torrc (with the isolation flags) must be fully written
    // BEFORE tor is spawned — tor reads -f <torrcPath> at process start. Parallelizing these races the
    // OS write against tor's open() and can start tor without IsolateSOCKSAuth (compartmentation loss).
    await mkdir(this.o.dataDir, { recursive: true });
    await writeFile(torrcPath, buildBgconnTorrc({ socksPort: this.o.socksPort, controlPort: this.o.controlPort, dataDir: this.o.dataDir }));
    const proc = spawn(this.o.torExe, ['-f', torrcPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('bgconn tor bootstrap timed out')), 120_000);
        const onData = (b: Buffer): void => { if (b.toString().includes('Bootstrapped 100%')) { clearTimeout(timer); this.bootstrapped = true; resolve(); } };
        proc.stdout?.on('data', onData);
        proc.once('error', (e) => { clearTimeout(timer); reject(e); });
        proc.once('exit', () => { clearTimeout(timer); if (!this.bootstrapped) reject(new Error('bgconn tor exited before bootstrap')); });
      });
    } catch (e) {
      this.proc = null; // make the instance reusable after a failed start
      try { proc.kill(); } catch { /* */ }
      throw e;
    }
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
